/**
 * Notification Controller
 * Handles notification-related API endpoints for both surveyors and assigners
 */

const firebaseService = require('../../services/firebase.service');
const socketConfig = require('../../config/socket');

/**
 * Register/update FCM device token
 * POST /api/v1/:role/notifications/register-token
 */
const registerToken = async (req, res) => {
    try {
        const { fcm_token, device_type, device_id } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;

        if (!fcm_token) {
            return res.status(400).json({
                success: false,
                message: 'FCM token is required'
            });
        }

        const success = await firebaseService.registerDeviceToken(
            userRole,
            userId,
            fcm_token,
            device_type || 'android',
            device_id
        );

        if (success) {
            res.json({
                success: true,
                message: 'Device token registered successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to register device token'
            });
        }
    } catch (error) {
        console.error('Register token error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Remove FCM device token (logout)
 * POST /api/v1/:role/notifications/remove-token
 */
const removeToken = async (req, res) => {
    try {
        const { fcm_token } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;

        if (!fcm_token) {
            return res.status(400).json({
                success: false,
                message: 'FCM token is required'
            });
        }

        await firebaseService.removeDeviceToken(userRole, userId, fcm_token);

        res.json({
            success: true,
            message: 'Device token removed successfully'
        });
    } catch (error) {
        console.error('Remove token error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Get notifications list
 * GET /api/v1/:role/notifications
 */
const getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const { limit = 50, offset = 0, unread_only } = req.query;

        const notifications = await firebaseService.getNotifications(
            userRole,
            userId,
            {
                limit: parseInt(limit) || 50,
                offset: parseInt(offset) || 0,
                unreadOnly: unread_only === 'true'
            }
        );

        const unreadCount = await firebaseService.getUnreadCount(userRole, userId);

        res.json({
            success: true,
            data: {
                notifications,
                unread_count: unreadCount,
                pagination: {
                    limit: parseInt(limit) || 50,
                    offset: parseInt(offset) || 0,
                }
            }
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Get unread notification count
 * GET /api/v1/:role/notifications/unread-count
 */
const getUnreadCount = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        const count = await firebaseService.getUnreadCount(userRole, userId);

        res.json({
            success: true,
            data: { unread_count: count }
        });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Mark notification as read
 * PUT /api/v1/:role/notifications/:id/read
 */
const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;

        const success = await firebaseService.markAsRead(id, userRole, userId);

        if (success) {
            // Get updated unread count and emit via socket
            const unreadCount = await firebaseService.getUnreadCount(userRole, userId);
            socketConfig.emitUnreadCountUpdate(userRole, userId, unreadCount);

            res.json({
                success: true,
                message: 'Notification marked as read',
                data: { unread_count: unreadCount }
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Mark all notifications as read
 * PUT /api/v1/:role/notifications/read-all
 */
const markAllAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        await firebaseService.markAllAsRead(userRole, userId);

        // Get updated unread count (should be 0) and emit via socket
        const unreadCount = 0; // Optimization: we know it's 0, but could fetch to be safe
        socketConfig.emitUnreadCountUpdate(userRole, userId, unreadCount);

        res.json({
            success: true,
            message: 'All notifications marked as read',
            data: { unread_count: 0 }
        });
    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

module.exports = {
    registerToken,
    removeToken,
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
};
