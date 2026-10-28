const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'claimsmitra'
};

async function checkSchema() {
    let connection;
    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('Connected!');

        console.log('Checking value_type column definition...');
        const [rows] = await connection.query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'claimsmitra' AND TABLE_NAME = 'system_config' AND COLUMN_NAME = 'value_type'");
        console.log('Column Type:', rows[0].COLUMN_TYPE);

    } catch (error) {
        console.error('Schema check failed:', error);
    } finally {
        if (connection) await connection.end();
    }
}

checkSchema();
