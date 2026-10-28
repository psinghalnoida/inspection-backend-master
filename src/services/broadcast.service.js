/**
 * Broadcast Service
 * Handles finding surveyors and initiating the broadcast selection process
 */

const db = require('../config/database');
const { surveyBroadcastQueue } = require('../queues/survey.queue');
const { getIO } = require('../config/socket');
const notificationHelper = require('./notification.helper');
const eligibility = require('./eligibility.service');

// Store active surveyor socket connections (surveyorId -> socketId)
// This is a reference to help emit to specific surveyors

/**
 * Emit notification to a specific surveyor via Socket.IO
 * @param {number} surveyorId 
 * @param {Object} notificationData 
 */
const emitToSurveyor = (surveyorId, notificationData) => {
    try {
        const io = getIO();
        // Emit to the surveyor's personal room (they join on connection)
        io.to(`surveyor:${surveyorId}`).emit('notification:new_request', notificationData);
        console.log(`📡 Socket notification sent to surveyor ${surveyorId}`);
    } catch (err) {
        console.log(`⚠️ Socket not initialized, falling back to polling for surveyor ${surveyorId}`);
    }
};

/**
 * Trigger Survey Broadcast
 * Finds surveyors, updates broadcast time, adds to queue
 * @param {number} surveyId 
 * @param {number} incidentLat 
 * @param {number} incidentLng 
 * @returns {Promise<number>} Count of notified surveyors
 */
/**
 * Trigger Survey Broadcast
 * Finds surveyors, updates broadcast time, adds to queue
 * @param {number} surveyId 
 * @param {number} incidentLat 
 * @param {number} incidentLng 
 * @param {number} attempt - Current broadcast attempt (default 1)
 * @returns {Promise<number>} Count of notified surveyors
 */
const triggerBroadcast = async (surveyId, incidentLat, incidentLng, attempt = 1) => {
    try {
        console.log(`Starting broadcast for survey ${surveyId}, attempt ${attempt}`);

        // Get config
        const configs = await db.query_rows("SELECT config_key, config_value FROM system_config WHERE config_key IN ('max_surveyors_to_notify', 'broadcast_duration_minutes', 'broadcast_stage_1_km', 'broadcast_stage_2_km', 'broadcast_stage_3_km')");
        const configMap = configs.reduce((acc, row) => ({ ...acc, [row.config_key]: row.config_value }), {});

        // Calculate dynamic radius from explicit separate stages
        let stages = [];
        if (configMap.broadcast_stage_1_km) stages.push(parseFloat(configMap.broadcast_stage_1_km));
        if (configMap.broadcast_stage_2_km) stages.push(parseFloat(configMap.broadcast_stage_2_km));
        if (configMap.broadcast_stage_3_km) stages.push(parseFloat(configMap.broadcast_stage_3_km));

        // Filter valid numbers
        stages = stages.filter(n => !isNaN(n));

        // Fallback to defaults if stages are empty
        if (stages.length === 0) {
            // No stage config seeded — fall back to a 3-stage escalation so the
            // broadcast still retries with a growing radius instead of one 15km attempt.
            stages = [15, 30, 45];
        }

        // Get radius for current attempt (1-based index -> 0-based array)
        // If attempt exceeds defined stages, use the last stage
        const stageIndex = Math.min(attempt, stages.length) - 1;
        const radiusKm = stages[Math.max(0, stageIndex)];

        console.log(`📡 Broadcast Attempt ${attempt}: Radius ${radiusKm}km (Stages: ${stages.join(', ')})`);

        const maxSurveyors = parseInt(configMap.max_surveyors_to_notify || 5);
        const durationMins = parseInt(configMap.broadcast_duration_minutes || 5);

        // Fetch survey details up front — survey_type drives the category filter below.
        // (This used to be fetched after the surveyor query, when it was only needed
        // for the notification payload.)
        const surveyDetails = await db.execute_single(
            `SELECT id, survey_type, city, state, case_reference, latitude, longitude, broadcast_ends_at
             FROM surveys WHERE id = ?`,
            [surveyId]
        );

        // v2 §1.3: motor cases go only to surveyors holding the motor category,
        // marine only to marine. Investigation cases are open to all investigators.
        const { sql: categorySql, params: categoryParams } =
            eligibility.categoryClause(surveyDetails?.survey_type, 'sv');

        // Find surveyors within radius
        const surveyors = await db.query_rows(
            `SELECT sv.id, sv.full_name, sv.phone,
              (6371 * ACOS(
                COS(RADIANS(?)) * COS(RADIANS(sv.current_latitude)) *
                COS(RADIANS(sv.current_longitude) - RADIANS(?)) +
                SIN(RADIANS(?)) * SIN(RADIANS(sv.current_latitude))
              )) AS distance_km
       FROM surveyors sv
       WHERE sv.is_active = TRUE
         AND sv.is_available = TRUE
         AND sv.verification_status = 'verified'
         AND sv.current_latitude IS NOT NULL
         AND sv.current_longitude IS NOT NULL
         ${categorySql}
         ${eligibility.openBroadcastEmployeeClause('sv')}
       HAVING distance_km <= ?
       ORDER BY distance_km ASC
       LIMIT ?`,
            [incidentLat, incidentLng, incidentLat, ...categoryParams, radiusKm, maxSurveyors]
        );

        // Update Survey Broadcast Details (Time & Attempt)
        await db.execute_query(
            `UPDATE surveys SET broadcast_ends_at = DATE_ADD(NOW(), INTERVAL ? MINUTE), broadcast_attempt = ? WHERE id = ?`,
            [durationMins, attempt, surveyId]
        );

        if (surveyors.length === 0) {
            const requiredCategory = eligibility.requiredCategoryFor(surveyDetails?.survey_type);
            console.log(
                `⚠️ No surveyors found within ${radiusKm}km for survey ${surveyId} (Attempt ${attempt})` +
                (requiredCategory ? ` — required category: ${requiredCategory}` : '')
            );
            // We still queue the job so retry/escalation stays centralized in the
            // queue processor, which alerts admin once all radius stages are spent.
        }

        // broadcast_ends_at was just updated above — refresh it for the payload.
        if (surveyDetails) {
            const fresh = await db.execute_single(
                'SELECT broadcast_ends_at FROM surveys WHERE id = ?',
                [surveyId]
            );
            surveyDetails.broadcast_ends_at = fresh?.broadcast_ends_at ?? surveyDetails.broadcast_ends_at;
        }

        // Create notifications and emit via Socket.IO
        if (surveyors.length > 0) {
            for (const surveyor of surveyors) {
                // Create Notification in database
                await db.execute_query(
                    `INSERT INTO surveyor_notifications (survey_id, surveyor_id, distance_from_incident_km, response_status)
             VALUES (?, ?, ?, 'pending')
             ON DUPLICATE KEY UPDATE distance_from_incident_km = VALUES(distance_from_incident_km)`,
                    [surveyId, surveyor.id, surveyor.distance_km]
                );

                // Emit real-time Socket.IO notification
                const notificationPayload = {
                    id: `${surveyId}-${surveyor.id}`,
                    survey_id: surveyId,
                    survey_type: surveyDetails?.survey_type || 'general',
                    city: surveyDetails?.city || '',
                    state: surveyDetails?.state || '',
                    case_reference: surveyDetails?.case_reference || null,
                    distance_from_incident_km: surveyor.distance_km,
                    broadcast_ends_at: surveyDetails?.broadcast_ends_at,
                    created_at: new Date().toISOString(),
                    attempt: attempt
                };

                emitToSurveyor(surveyor.id, notificationPayload);

                // Send Push Notification via FCM
                notificationHelper.notifySurveyorNewRequest(surveyor.id, {
                    id: surveyId,
                    survey_type: surveyDetails?.survey_type,
                    city: surveyDetails?.city,
                    distance_km: surveyor.distance_km
                }).catch(err => console.error('Push notification error:', err));

                console.log(`📲 Notification sent to Surveyor ${surveyor.id} (${surveyor.full_name}) for Survey ${surveyId}`);
            }
        }

        // Add to Redis Queue for selection/retry check
        await surveyBroadcastQueue.add('select-surveyor', { surveyId }, {
            delay: durationMins * 60 * 1000,
            jobId: `broadcast-${surveyId}-attempt-${attempt}` // Unique Job ID per attempt
        });

        // Notify Assigner about the broadcast status (Timer and Radius)
        try {
            const io = getIO();
            // Get assigner id for this survey
            const survey = await db.execute_single('SELECT assigner_id FROM surveys WHERE id = ?', [surveyId]);
            if (survey && survey.assigner_id) {
                io.to(`assigner:${survey.assigner_id}`).emit('broadcast:updated', {
                    survey_id: surveyId,
                    radius_km: radiusKm,
                    ends_at: surveyDetails?.broadcast_ends_at,
                    attempt: attempt,
                    duration_mins: durationMins
                });
                console.log(`📡 Broadcast update sent to assigner ${survey.assigner_id} for survey ${surveyId}`);
            }
        } catch (err) {
            console.error('Error notifying assigner about broadcast:', err);
        }

        console.log(`📢 Broadcast initiated for Survey ${surveyId} (Attempt ${attempt}). Ends in ${durationMins} mins.`);
        return surveyors.length;
    } catch (err) {
        console.error('Error triggering broadcast:', err);
        return 0;
    }
};

/**
 * Close out a survey's broadcast notifications.
 * Called whenever a broadcast ends — assigned to a winner, expired with no
 * winner, or max retries reached — so the request stops showing to surveyors.
 *
 * - Marks still-pending surveyor_notifications rows as 'expired'
 * - Marks the general 'broadcast_request' notifications as read so they leave
 *   the surveyor's active/unread list on next fetch
 * - Emits 'notification:expired' to each notified surveyor (except the winner)
 *   so live clients drop the request card in real time
 *
 * @param {number} surveyId
 * @param {number|null} exceptSurveyorId - surveyor to skip (the assigned winner)
 */
const closeBroadcastNotifications = async (surveyId, exceptSurveyorId = null) => {
    try {
        // Collect everyone who was notified before we flip statuses
        const notified = await db.query_rows(
            `SELECT surveyor_id FROM surveyor_notifications WHERE survey_id = ?`,
            [surveyId]
        );

        // Expire any broadcast notifications still awaiting a response
        await db.execute_query(
            `UPDATE surveyor_notifications SET response_status = 'expired'
             WHERE survey_id = ? AND response_status = 'pending'`,
            [surveyId]
        );

        // Mark the general broadcast_request notifications read so they no longer
        // surface as active/unread requests in the surveyor's notification list
        await db.execute_query(
            `UPDATE notifications SET is_read = TRUE, read_at = NOW()
             WHERE notification_type = 'broadcast_request'
               AND reference_type = 'survey'
               AND reference_id = ?
               AND is_read = FALSE`,
            [surveyId]
        );

        // Real-time: tell each notified surveyor to remove the request card
        try {
            const io = getIO();
            notified.forEach(({ surveyor_id }) => {
                if (exceptSurveyorId && Number(surveyor_id) === Number(exceptSurveyorId)) return;
                io.to(`surveyor:${surveyor_id}`).emit('notification:expired', {
                    survey_id: surveyId,
                    message: 'This survey request is no longer available'
                });
            });
        } catch (socketErr) {
            console.log('⚠️ closeBroadcastNotifications socket emit skipped:', socketErr.message);
        }
    } catch (err) {
        console.log('⚠️ closeBroadcastNotifications error:', err.message);
    }
};

module.exports = {
    triggerBroadcast,
    closeBroadcastNotifications
};
