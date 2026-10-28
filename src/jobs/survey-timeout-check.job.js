/**
 * Survey Timeout Check Job
 * Checks for surveys that have been pending for more than 7 days
 * Runs daily at 9:00 AM
 */

const cron = require('node-cron');
const db = require('../config/database');
const notificationHelper = require('../services/notification.helper');

const initTimeoutCheck = () => {
    // Run daily at 9 AM
    // Schedule: Minute Hour DayOfMonth Month DayOfWeek
    cron.schedule('0 9 * * *', async () => {
        console.log('🕐 Running survey timeout check...');

        try {
            // Get surveys that are in report submitted or not resolved state 
            // and haven't had a warning sent yet, and are older than 7 days
            const surveys = await db.execute_query(
                `SELECT s.id, s.assigner_id, s.surveyor_id, s.laid,
                        s.updated_at,
                        DATEDIFF(NOW(), s.updated_at) as days_pending
                 FROM surveys s
                 WHERE s.status IN ('report_submitted', 'not_resolved')
                 AND DATEDIFF(NOW(), s.updated_at) >= 7
                 AND (s.timeout_warning_sent_at IS NULL OR DATEDIFF(NOW(), s.timeout_warning_sent_at) > 7)`
            );

            if (surveys.length === 0) {
                console.log('✅ No pending surveys found for timeout warning');
                return;
            }

            console.log(`⚠️ Found ${surveys.length} surveys pending > 7 days`);

            for (const survey of surveys) {
                // Send notification
                await notificationHelper.notifyAssignerTimeoutWarning(
                    survey.assigner_id,
                    survey
                ).catch(err => console.error(`Error notifying assigner ${survey.assigner_id}:`, err));

                // Mark warning as sent
                await db.execute_query(
                    'UPDATE surveys SET timeout_warning_sent_at = NOW() WHERE id = ?',
                    [survey.id]
                );
            }

            console.log(`✅ Sent timeout warnings for ${surveys.length} surveys`);
        } catch (error) {
            console.error('❌ Error executing survey timeout check:', error);
        }
    });

    console.log('⏰ Survey timeout check job scheduled (Daily at 9:00 AM)');
};

module.exports = initTimeoutCheck;
