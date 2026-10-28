/**
 * Run Migration: Consolidate escalation config
 */
const db = require('../src/config/database');

const runMigration = async () => {
    try {
        console.log('Running migration: Consolidate escalation config...');

        // Delete the duplicate config
        const deleteResult = await db.execute_query(
            `DELETE FROM system_config WHERE config_key = 'unresolved_survey_followup_days'`
        );
        console.log(`Deleted ${deleteResult.affectedRows} row(s) for unresolved_survey_followup_days`);

        // Update the description of the remaining config
        const updateResult = await db.execute_query(
            `UPDATE system_config 
             SET description = 'Days for dispute auto-escalation and unresolved survey follow-up'
             WHERE config_key = 'dispute_escalation_days'`
        );
        console.log(`Updated ${updateResult.affectedRows} row(s) for dispute_escalation_days`);

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    }
};

runMigration();
