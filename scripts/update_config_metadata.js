const db = require('../src/config/database');

const metadata = [
    {
        key: 'surveyor_notification_radius_km',
        category: 'survey',
        description: 'Radius in KM to find surveyors near incident',
        value_type: 'number'
    },
    {
        key: 'broadcast_duration_minutes',
        category: 'survey',
        description: 'Duration in minutes the survey is available for acceptance',
        value_type: 'number'
    },
    {
        key: 'max_surveyors_to_notify',
        category: 'survey',
        description: 'Maximum number of surveyors to send push notifications to',
        value_type: 'number'
    },
    {
        key: 'max_surveyor_acceptors',
        category: 'survey',
        description: 'Number of acceptances required to trigger immediate selection (Early Exit)',
        value_type: 'number'
    }
];

const updateMetadata = async () => {
    try {
        console.log('Updating config metadata...');
        for (const item of metadata) {
            await db.execute_query(
                `UPDATE system_config 
         SET category = ?, description = ?, value_type = ?, is_editable = TRUE
         WHERE config_key = ?`,
                [item.category, item.description, item.value_type, item.key]
            );
            console.log(`Updated metadata for ${item.key}`);
        }
        process.exit(0);
    } catch (error) {
        console.error('Error updating metadata:', error);
        process.exit(1);
    }
};

updateMetadata();
