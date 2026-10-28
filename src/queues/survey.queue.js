const { Queue, Worker } = require('bullmq');
const connection = require('../config/redis');
const db = require('../config/database');
const { getIO } = require('../config/socket');
const notificationHelper = require('../services/notification.helper');

const SURVEY_BROADCAST_QUEUE = 'survey-broadcast';

// Only initialize queue if Redis is available
let surveyBroadcastQueue = null;
if (connection) {
    surveyBroadcastQueue = new Queue(SURVEY_BROADCAST_QUEUE, { connection });
} else {
    console.log('⚠️ Survey broadcast queue disabled (no Redis connection)');
}

/**
 * Notify all surveyors who received the broadcast that it has expired
 * @param {number} surveyId 
 */
const notifyBroadcastExpired = async (surveyId, exceptSurveyorId = null) => {
    // Delegate to the centralized cleanup so the broadcast is closed everywhere:
    // expires pending surveyor_notifications, marks the general broadcast_request
    // notifications read, and emits notification:expired to live clients.
    // Dynamic require avoids the broadcast.service <-> queue circular dependency.
    const broadcastService = require('../services/broadcast.service');
    await broadcastService.closeBroadcastNotifications(surveyId, exceptSurveyorId);
};

const processApplications = async (job) => {
    const { surveyId } = job.data;
    console.log(`Processing broadcast for survey ${surveyId}`);

    try {
        // 0. Idempotency Check: Verify survey is not already assigned
        const survey = await db.execute_single(
            'SELECT status, broadcast_attempt, latitude, longitude FROM surveys WHERE id = ?',
            [surveyId]
        );

        if (!survey || survey.status === 'assigned' || survey.status === 'in_transit') {
            console.log(`Survey ${surveyId} already assigned/processed. Skipping.`);
            // If assigned, we might still want to notify others encoded in notifyBroadcastExpired
            // but usually if assigned, the previous logic handled it.
            // If it was just processed, we return.
            return;
        }

        // 1. Fetch applications
        const applications = await db.execute_query(
            `SELECT * FROM survey_applications WHERE survey_id = ? ORDER BY total_eta_minutes ASC`,
            [surveyId]
        );

        if (applications.length === 0) {
            console.log(`No applications received for survey ${surveyId}`);

            // RETRY LOGIC
            const configs = await db.query_rows("SELECT config_key, config_value FROM system_config WHERE config_key IN ('broadcast_stage_1_km', 'broadcast_stage_2_km', 'broadcast_stage_3_km')");
            const configMap = configs.reduce((acc, row) => ({ ...acc, [row.config_key]: row.config_value }), {});

            let maxRetries = 0;
            if (configMap.broadcast_stage_1_km) maxRetries++;
            if (configMap.broadcast_stage_2_km) maxRetries++;
            if (configMap.broadcast_stage_3_km) maxRetries++;

            // No stage config seeded — default to a 3-attempt escalation
            // (matches the [15, 30, 45] fallback in broadcast.service.js).
            if (maxRetries === 0) maxRetries = 3;

            const currentAttempt = survey.broadcast_attempt || 1;

            if (currentAttempt < maxRetries) {
                console.log(`🔄 Retrying broadcast for survey ${surveyId} (Attempt ${currentAttempt + 1} of ${maxRetries})`);

                // Emit socket event: radius increased
                try {
                    const io = getIO();
                    if (io) {
                        const configs = await db.query_rows("SELECT config_key, config_value FROM system_config WHERE config_key IN ('broadcast_stage_1_km', 'broadcast_stage_2_km', 'broadcast_stage_3_km')");
                        let stages = configs
                            .filter(c => c.config_key?.startsWith('broadcast_stage_'))
                            .map(c => parseFloat(c.config_value))
                            .filter(n => !isNaN(n));
                        // Mirror the service fallback so the reported radius matches the actual broadcast
                        if (stages.length === 0) stages = [15, 30, 45];

                        const newRadius = stages[Math.min(currentAttempt, stages.length) - 1] || 15;
                        
                        io.to(`broadcast:${surveyId}`).emit('broadcast:radius-increased', {
                            survey_id: surveyId,
                            attempt: currentAttempt + 1,
                            radius_km: newRadius,
                            timestamp: new Date().toISOString()
                        });
                        console.log(`📡 Broadcast: Radius increased for survey ${surveyId} to ${newRadius}km (Attempt ${currentAttempt + 1})`);
                    }
                } catch (socketErr) {
                    console.warn('Socket emit error:', socketErr.message);
                }

                // Dynamic import to avoid circular dependency
                const broadcastService = require('../services/broadcast.service');
                await broadcastService.triggerBroadcast(surveyId, survey.latitude, survey.longitude, currentAttempt + 1);
                return;
            }

            // Max retries reached. Close out the broadcast, then alert admin —
            // otherwise the survey sits in `location_detected` forever with nobody
            // watching (v2 §2.3). Category filtering makes this path far more
            // likely than it used to be.
            await notifyBroadcastExpired(surveyId);

            try {
                const eligibility = require('../services/eligibility.service');
                const details = await db.execute_single(
                    'SELECT id, laid, survey_type FROM surveys WHERE id = ?',
                    [surveyId]
                );
                if (details) {
                    await notificationHelper.notifyAdminBroadcastExhausted(
                        details,
                        eligibility.requiredCategoryFor(details.survey_type)
                    );
                }
            } catch (notifyErr) {
                // Never let an alert failure break the queue job.
                console.error('Admin broadcast-exhausted notification failed:', notifyErr.message);
            }
            return;
        }

        // 2. Select Winner (Lowest ETA)
        const winner = applications[0];

        // 3. Update Survey
        await db.execute_query(
            `UPDATE surveys 
       SET surveyor_id = ?, 
           status = 'assigned', 
           surveyor_eta_minutes = ?,
           surveyor_assigned_at = NOW() 
       WHERE id = ?`,
            [winner.surveyor_id, winner.time_to_start_minutes, surveyId]
        );

        // v2 §5.1: record the transition. This write was missing entirely, so the
        // single most important moment in a broadcast survey — the surveyor being
        // selected — never appeared in survey_status_history and therefore never
        // appeared in any timeline.
        await db.execute_query(
            `INSERT INTO survey_status_history
               (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
             VALUES (?, 'location_detected', 'assigned', 'system', NULL, ?)`,
            [surveyId, `Selected from broadcast (lowest ETA: ${winner.total_eta_minutes ?? 'n/a'} mins)`]
        );

        // 4. Update Applications Status
        await db.execute_query(
            `UPDATE survey_applications SET status = 'selected' WHERE id = ?`,
            [winner.id]
        );
        await db.execute_query(
            `UPDATE survey_applications SET status = 'rejected' WHERE survey_id = ? AND id != ?`,
            [surveyId, winner.id]
        );

        console.log(`Assigned survey ${surveyId} to surveyor ${winner.surveyor_id}`);

        // Fetch details (needed by both the socket emit below and the notifications)
        const surveyDetails = await db.execute_single(
            'SELECT id, assigner_id, laid, surveyor_eta_minutes, survey_type FROM surveys WHERE id = ?',
            [surveyId]
        );
        const surveyorDetails = await db.execute_single(
            'SELECT full_name FROM surveyors WHERE id = ?',
            [winner.surveyor_id]
        );
        const assignerDetails = await db.execute_single(
            'SELECT full_name, company_name FROM assigners WHERE id = ?',
            [surveyDetails?.assigner_id]
        );

        // Emit socket event: broadcast completed (surveyor assigned)
        try {
            const io = getIO();
            if (io) {
                io.to(`broadcast:${surveyId}`).emit('broadcast:completed', {
                    survey_id: surveyId,
                    surveyor_id: winner.surveyor_id,
                    surveyor_name: surveyorDetails?.full_name || 'Unknown',
                    eta_minutes: winner.time_to_start_minutes,
                    timestamp: new Date().toISOString()
                });
                console.log(`📡 Broadcast completed for survey ${surveyId}: assigned to surveyor ${winner.surveyor_id}`);
            }
        } catch (socketErr) {
            console.warn('Socket emit error:', socketErr.message);
        }

        // Notify Assigner and Surveyor

        if (surveyDetails && surveyorDetails) {
            // Notify assigner that surveyor has been assigned
            notificationHelper.notifyAssignerSurveyAssigned(
                surveyDetails.assigner_id,
                surveyDetails,
                surveyorDetails
            ).catch(err => console.error('Notification error:', err));

            // Notify surveyor that they have been assigned to the survey
            notificationHelper.notifySurveyorSurveyAssigned(
                winner.surveyor_id,
                surveyDetails,
                assignerDetails
            ).catch(err => console.error('Surveyor notification error:', err));
        }

        // Notify all surveyors that broadcast has ended (winner keeps their assignment notification)
        await notifyBroadcastExpired(surveyId, winner.surveyor_id);

    } catch (error) {
        console.error(`Error processing broadcast for survey ${surveyId}:`, error);
        throw error;
    }
};

// Only initialize worker if Redis is available
if (connection) {
    const worker = new Worker(SURVEY_BROADCAST_QUEUE, processApplications, { connection });
}

module.exports = {
    surveyBroadcastQueue,
};
