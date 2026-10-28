/**
 * MySQL Database Connection Pool (Railway-ready)
 */

const mysql = require('mysql2/promise');

// Use Railway URL if available, otherwise fall back to local config
const dbConfig = process.env.MYSQL_PUBLIC_URL
  ? { uri: process.env.MYSQL_PUBLIC_URL }
  : {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'claimsmitra',
  };

const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: 'local', // Use local timezone instead of force-UTC to avoid 5.5h shift with IST database
});

// Helper function to execute queries with prepared statements
pool.execute_query = async (sql, params = []) => {
  const [rows] = await pool.execute(sql, params);
  return rows;
};

// Helper function using regular query (better for LIMIT/OFFSET)
pool.query_rows = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return rows;
};

// Helper for single row
pool.execute_single = async (sql, params = []) => {
  const rows = await pool.execute_query(sql, params);
  return rows[0] || null;
};

// Helper for single row using query
pool.query_single = async (sql, params = []) => {
  const rows = await pool.query_rows(sql, params);
  return rows[0] || null;
};

module.exports = pool;