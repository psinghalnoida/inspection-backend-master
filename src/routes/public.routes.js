/**
 * Public Routes (No Authentication Required)
 */

const express = require('express');
const router = express.Router();

// Controllers
const locationController = require('../controllers/location/location.controller');
const passwordResetController = require('../controllers/auth/password.reset.controller');
const sabpaisaCallback = require('../controllers/payment/sabpaisa.callback');

// Middleware
const { validate } = require('../middleware/validate');
const { locationSubmitValidator } = require('../validators');

// ==================== PASSWORD RESET (EJS Pages) ====================
router.get('/reset-password/:token', passwordResetController.showResetForm);
router.post('/reset-password/:token', passwordResetController.handleResetForm);

// ==================== LOCATION (SMS Link) ====================
router.get('/location/:smsToken', locationController.getLocationPage);
router.post('/location/:smsToken', locationSubmitValidator, validate, locationController.submitLocation);

// ==================== QR TRACKING ====================
router.get('/track/:qrToken', locationController.trackByQR);

// ==================== PAYMENT CALLBACKS ====================
// SabPaisa callback (both GET and POST supported)
router.get('/payment/sabpaisa/callback', sabpaisaCallback.handleCallback);
router.post('/payment/sabpaisa/callback', sabpaisaCallback.handleCallback);
router.get('/payment/status/:clientTxnId', sabpaisaCallback.getPaymentStatus);

// ==================== SYSTEM ====================
router.get('/health', locationController.healthCheck);
router.get('/config/app', locationController.getAppConfig);

module.exports = router;
