const db = require('../src/config/database');

const configs = [
    { key: 'surveyor_notification_radius_km', value: '15' },
    { key: 'broadcast_duration_minutes', value: '5' },
    { key: 'max_surveyors_to_notify', value: '20' }, // Limit for push notifications
    { key: 'max_surveyor_acceptors', value: '5' }     // Limit for acceptance early exit
];

const seedConfigs = async () => {
    try {
        console.log('Seeding system configurations...');
        for (const config of configs) {
            await db.execute_query(
                `INSERT INTO system_config (config_key, config_value) 
         VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
                [config.key, config.value]
            );
            console.log(`Set ${config.key} = ${config.value}`);
        }
        console.log('Configuration seeding completed.');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding configs:', error);
        process.exit(1);
    }
};

seedConfigs();
