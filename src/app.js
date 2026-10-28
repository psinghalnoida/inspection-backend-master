/**
 * Express Application Setup
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { notFound } = require('./utils/response');

const app = express();

// Trust proxy for ngrok/reverse proxy (needed for rate limiting with X-Forwarded-For)
app.set('trust proxy', 1);

// ========= PAYMENT CALLBACK - BEFORE CORS (cross-origin form POST) =========
// SabPaisa POSTs form data directly to this URL, CORS must be bypassed
const sabpaisaCallback = require('./controllers/payment/sabpaisa.callback');
app.use(express.urlencoded({ extended: true })); // Parse form data
app.post('/api/v1/public/payment/sabpaisa/callback', sabpaisaCallback.handleCallback);
app.get('/api/v1/public/payment/sabpaisa/callback', sabpaisaCallback.handleCallback);
// ============================================================================

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for EJS pages
      styleSrc: ["'self'", "'unsafe-inline'"],  // Allow inline styles
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:3004',
      'http://localhost:3005',
      'http://127.0.0.1',
      'http://127.0.0.1:3000',
      'http://192.168.1.13',
      'http://192.168.1.13:3000',
      'exp://localhost:8081',
      'exp://192.168.1.13:8081',
      'http://inspection.claimsmitra.com:3000',
      'https://inspection.claimsmitra.com:3000',
      'https://inspection.claimsmitra.com',

      'https://claimsmitra-admin.vercel.app',
      'https://claimsmitra-web.vercel.app',
      'https://claimsmitra-backend-production.up.railway.app',
      // SabPaisa payment gateway domains
      'https://stage-securepay.sabpaisa.in',
      'https://securepay.sabpaisa.in',
      'https://sabpaisa.in'
    ].filter(Boolean);

    // Allow requests with no origin (like mobile apps, server-to-server, or form submissions)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // 1000 requests per minute
  message: { success: false, message: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// v2 §4.4 — REPORTS ARE NOT PUBLIC.
//
// Reports are paywalled behind the assigner's invoice balance, and a gate that
// only lives in a JSON controller is theatre while the file itself is on an
// unauthenticated static mount. This 403 must sit BEFORE express.static, or the
// static handler answers first.
//
// Reports are served by GET /api/v1/files/reports/:surveyId/:filename, which
// authenticates, authorises and checks the balance.
app.use('/uploads/reports', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'Reports must be requested through /api/v1/files/reports/:surveyId/:filename',
    code: 'REPORT_DIRECT_ACCESS_DENIED'
  });
});

// Static files for uploads (photos, documents, profile pictures — not reports)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// EJS View Engine for password reset pages
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Short URL route for SMS links (/location?=TOKEN -> /api/v1/public/location/TOKEN)
// DLT template doesn't allow slashes in variable, so we use query param format
app.get('/location', (req, res) => {
  // URL format: /location?=TOKEN (note: the = is part of the query string key)
  // When URL is /location?=abc123, req.query will be { '': 'abc123' } or we need to parse raw URL
  const rawUrl = req.originalUrl;
  const tokenMatch = rawUrl.match(/location\?=(.+)$/);

  if (tokenMatch && tokenMatch[1]) {
    const token = tokenMatch[1];
    res.redirect(`/api/v1/public/location/${token}`);
  } else {
    res.status(400).json({ error: 'Invalid token format. Expected: /location?=TOKEN' });
  }
});

// API Routes
app.use('/api/v1', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json(notFound('Route not found'));
});

// Global error handler
app.use(errorHandler);

module.exports = app;
