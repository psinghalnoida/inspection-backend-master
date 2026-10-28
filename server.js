/**
 * Server Entry Point
 * ClaimsMitra Backend API
 */

require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const db = require('./src/config/database');
const { initializeSocket } = require('./src/config/socket');

const PORT = process.env.PORT || 3000;

// Create HTTP server (required for Socket.IO)
const server = http.createServer(app);

// Initialize Socket.IO
const io = initializeSocket(server);

// Make io available in app for controllers
app.set('io', io);

// Initialize Jobs
const initTimeoutCheck = require('./src/jobs/survey-timeout-check.job.js');
initTimeoutCheck();

// v2 §3.5: billing is mandatory — nag admins about unbilled completed surveys.
const initBillingReminder = require('./src/jobs/billing-reminder.job.js');
initBillingReminder();

// v2 §5: generate the composite survey PDF and drain the main-CM outbox.
// The outbound push stays inert until cm_sync_enabled is turned on.
const initSurveyExport = require('./src/jobs/survey-export.job.js');
initSurveyExport();

// Test database connection
db.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully');
    connection.release();

    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 API URL: http://localhost:${PORT}/api/v1`);
      console.log(`🔌 Socket.IO enabled for real-time location tracking`);
    });
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  });

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...');
  console.error(err);
  process.exit(1);
});
