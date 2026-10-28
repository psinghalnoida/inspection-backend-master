/**
 * Environment Configuration
 */

module.exports = {
  // Server
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME || 'claimsmitra'
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '24h'
  },

  // Bcrypt
  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10
  },

  // File Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880, // 5MB
    path: process.env.UPLOAD_PATH || './uploads'
  },

  // SMS (2Factor.in)
  sms: {
    apiKey: process.env.SMS_2FACTOR_API_KEY,
    senderId: process.env.SMS_SENDER_ID || 'ADWITT',
    peId: process.env.SMS_PE_ID,
    ctId: process.env.SMS_CT_ID
  },

  // Email (SMTP)
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.EMAIL_FROM || 'noreply@claimsmitra.com'
  },

  // Firebase
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID
  },

  // URLs
  urls: {
    app: process.env.APP_URL || 'http://localhost:3000',
    frontend: process.env.FRONTEND_URL || 'http://localhost:3001',
    smsLocation: process.env.SMS_LOCATION_BASE_URL || 'http://localhost:3000/api/v1/public/location',
    qrTracking: process.env.QR_TRACKING_BASE_URL || 'http://localhost:3000/api/v1/public/track'
  }
};
