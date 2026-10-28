/**
 * Firebase Cloud Messaging Service
 * Handles push notification delivery via Firebase Admin SDK
 */

const admin = require('firebase-admin');
const path = require('path');
const db = require('../config/database');

// Initialize Firebase Admin (only once)
let firebaseInitialized = false;

const initializeFirebase = () => {
    if (firebaseInitialized) return;

    try {
        // Check if service account key file exists
        const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

        if (serviceAccountPath) {
            // Resolve path relative to project root (process.cwd()) instead of this file
            const resolvedPath = path.isAbsolute(serviceAccountPath)
                ? serviceAccountPath
                : path.resolve(process.cwd(), serviceAccountPath);
            const serviceAccount = require(resolvedPath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            console.log('✅ Firebase Admin initialized with service account');
        } else if (process.env.FIREBASE_PROJECT_ID) {
            // Use application default credentials (for Google Cloud environments)
            admin.initializeApp({
                projectId: process.env.FIREBASE_PROJECT_ID,
            });
            console.log('✅ Firebase Admin initialized with project ID');
        } else {
            console.warn('⚠️ Firebase not configured - push notifications disabled');
            return;
        }

        firebaseInitialized = true;
    } catch (error) {
        console.error('❌ Firebase initialization error:', error.message);
    }
};

/**
 * Register or update FCM token for a user
 */
const registerDeviceToken = async (userType, userId, fcmToken, deviceType = 'android', deviceId = null) => {
    try {
        // Deactivate old tokens for the same device (same user)
        if (deviceId) {
            await db.execute_query(
                `UPDATE device_tokens 
                 SET is_active = FALSE 
                 WHERE user_type = ? AND user_id = ? AND device_id = ? AND fcm_token != ?`,
                [userType, userId, deviceId, fcmToken]
            );
        }

        // Deactivate THIS token for ANY other user (Token Stealing/Exclusivity)
        // This prevents cross-role notifications if same device logins as different users
        await db.execute_query(
            `UPDATE device_tokens 
             SET is_active = FALSE 
             WHERE fcm_token = ? AND (user_type != ? OR user_id != ?)`,
            [fcmToken, userType, userId]
        );

        // Insert or update the token
        await db.execute_query(
            `INSERT INTO device_tokens (user_type, user_id, fcm_token, device_type, device_id, is_active)
             VALUES (?, ?, ?, ?, ?, TRUE)
             ON DUPLICATE KEY UPDATE 
                fcm_token = VALUES(fcm_token),
                device_type = VALUES(device_type),
                is_active = TRUE,
                last_used_at = NOW()`,
            [userType, userId, fcmToken, deviceType, deviceId]
        );

        console.log(`📱 FCM token registered for ${userType} #${userId}`);
        return true;
    } catch (error) {
        console.error('❌ Error registering device token:', error);
        return false;
    }
};

/**
 * Remove FCM token (on logout)
 */
const removeDeviceToken = async (userType, userId, fcmToken) => {
    try {
        await db.execute_query(
            `UPDATE device_tokens SET is_active = FALSE 
             WHERE user_type = ? AND user_id = ? AND fcm_token = ?`,
            [userType, userId, fcmToken]
        );
        return true;
    } catch (error) {
        console.error('❌ Error removing device token:', error);
        return false;
    }
};

/**
 * Get active FCM tokens for a user
 */
const getUserTokens = async (userType, userId) => {
    try {
        const tokens = await db.execute_query(
            `SELECT fcm_token FROM device_tokens 
             WHERE user_type = ? AND user_id = ? AND is_active = TRUE`,
            [userType, userId]
        );
        return tokens.map(t => t.fcm_token);
    } catch (error) {
        console.error('❌ Error getting user tokens:', error);
        return [];
    }
};

/**
 * Create in-app notification and optionally send push
 */
const createNotification = async ({
    recipientType,
    recipientId,
    title,
    body,
    icon = null,
    notificationType = 'other',
    referenceType = null,
    referenceId = null,
    data = null,
    sendPush = true,
    androidChannelId = null,
    sound = null,
}) => {
    try {
        // Insert notification into database
        const result = await db.execute_query(
            `INSERT INTO app_notifications 
             (recipient_type, recipient_id, title, body, icon, notification_type, 
              reference_type, reference_id, data, push_sent, push_sent_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                recipientType,
                recipientId,
                title,
                body,
                icon,
                notificationType,
                referenceType,
                referenceId,
                data ? JSON.stringify(data) : null,
                false,
                null
            ]
        );

        const notificationId = result.insertId;

        // Send push notification if requested
        if (sendPush) {
            const pushSent = await sendPushNotification(
                recipientType,
                recipientId,
                title,
                body,
                {
                    notificationId: String(notificationId),
                    type: notificationType,
                    referenceType,
                    referenceId: referenceId ? String(referenceId) : null,
                    ...data
                },
                { androidChannelId, sound }
            );

            // Update push sent status
            if (pushSent) {
                await db.execute_query(
                    `UPDATE app_notifications SET push_sent = TRUE, push_sent_at = NOW() WHERE id = ?`,
                    [notificationId]
                );
            }
        }

        return notificationId;
    } catch (error) {
        console.error('❌ Error creating notification:', error);
        return null;
    }
};

/**
 * Send push notification via FCM
 *
 * @param {Object} [options]
 * @param {string} [options.androidChannelId] - Android notification channel id (must already exist on the device)
 * @param {string} [options.sound] - Custom sound name (without extension on Android; with extension on iOS, e.g. "survey_alert.caf"). Falls back to default.
 */
const sendPushNotification = async (userType, userId, title, body, data = {}, options = {}) => {
    if (!firebaseInitialized) {
        initializeFirebase();
    }

    if (!firebaseInitialized) {
        console.log('⚠️ Firebase not initialized, skipping push notification');
        return false;
    }

    try {
        const tokens = await getUserTokens(userType, userId);

        if (tokens.length === 0) {
            console.log(`📱 No active FCM tokens for ${userType} #${userId}`);
            return false;
        }

        const { androidChannelId, sound } = options;
        const channelId = androidChannelId || 'claimsmitra_notifications';

        // Android: when a custom sound is provided we use it explicitly; otherwise use default.
        // The channel itself also has a sound configured client-side — channel sound wins on Android 8+.
        const androidNotification = {
            channelId,
            priority: 'high',
            defaultVibrateTimings: true,
        };
        if (sound) {
            androidNotification.sound = sound; // raw resource name, no extension
        } else {
            androidNotification.defaultSound = true;
        }

        // iOS: sound is a filename in the app bundle. Default falls back to system tone.
        const iosSound = sound ? `${sound}.caf` : 'default';

        // Prepare message for multiple devices
        const message = {
            notification: {
                title,
                body,
            },
            data: Object.fromEntries(
                Object.entries(data).map(([k, v]) => [k, v !== null && v !== undefined ? String(v) : ''])
            ),
            android: {
                priority: 'high',
                notification: androidNotification,
            },
            apns: {
                payload: {
                    aps: {
                        alert: { title, body },
                        sound: iosSound,
                        badge: 1,
                    },
                },
            },
        };

        // Send to all user's devices
        const responses = await Promise.all(
            tokens.map(async (token) => {
                try {
                    await admin.messaging().send({ ...message, token });
                    return { token, success: true };
                } catch (err) {
                    console.error(`❌ FCM send error for token ${token.slice(0, 20)}...:`, err.code);

                    // Mark invalid tokens as inactive
                    if (err.code === 'messaging/invalid-registration-token' ||
                        err.code === 'messaging/registration-token-not-registered') {
                        await db.execute_query(
                            `UPDATE device_tokens SET is_active = FALSE WHERE fcm_token = ?`,
                            [token]
                        );
                    }
                    return { token, success: false, error: err.code };
                }
            })
        );

        const successCount = responses.filter(r => r.success).length;
        console.log(`📤 Push notification sent to ${successCount}/${tokens.length} devices for ${userType} #${userId}`);

        return successCount > 0;
    } catch (error) {
        console.error('❌ Error sending push notification:', error);
        return false;
    }
};

/**
 * Get notifications for a user
 */
const getNotifications = async (userType, userId, { limit = 50, offset = 0, unreadOnly = false } = {}) => {
    try {
        let query = `
            SELECT 
                id, title, body, icon, notification_type, 
                reference_type, reference_id, data,
                is_read, read_at, created_at
            FROM app_notifications 
            WHERE recipient_type = ? AND recipient_id = ?
        `;
        const params = [userType, userId];

        if (unreadOnly) {
            query += ` AND is_read = FALSE`;
        }

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const notifications = await db.query_rows(query, params);

        // Parse JSON data field if it's a string (mysql2 might auto-parse JSON columns)
        return notifications.map(n => ({
            ...n,
            data: (n.data && typeof n.data === 'string') ? JSON.parse(n.data) : n.data
        }));
    } catch (error) {
        console.error('❌ Error getting notifications:', error);
        return [];
    }
};

/**
 * Get unread notification count
 */
const getUnreadCount = async (userType, userId) => {
    try {
        const result = await db.execute_single(
            `SELECT COUNT(*) as count FROM app_notifications 
             WHERE recipient_type = ? AND recipient_id = ? AND is_read = FALSE`,
            [userType, userId]
        );
        return result?.count || 0;
    } catch (error) {
        console.error('❌ Error getting unread count:', error);
        return 0;
    }
};

/**
 * Mark notification as read
 */
const markAsRead = async (notificationId, userType, userId) => {
    try {
        await db.execute_query(
            `UPDATE app_notifications 
             SET is_read = TRUE, read_at = NOW() 
             WHERE id = ? AND recipient_type = ? AND recipient_id = ?`,
            [notificationId, userType, userId]
        );
        return true;
    } catch (error) {
        console.error('❌ Error marking notification as read:', error);
        return false;
    }
};

/**
 * Mark all notifications as read
 */
const markAllAsRead = async (userType, userId) => {
    try {
        await db.execute_query(
            `UPDATE app_notifications 
             SET is_read = TRUE, read_at = NOW() 
             WHERE recipient_type = ? AND recipient_id = ? AND is_read = FALSE`,
            [userType, userId]
        );
        return true;
    } catch (error) {
        console.error('❌ Error marking all as read:', error);
        return false;
    }
};

// Initialize Firebase on module load
initializeFirebase();

module.exports = {
    initializeFirebase,
    registerDeviceToken,
    removeDeviceToken,
    getUserTokens,
    createNotification,
    sendPushNotification,
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
};
