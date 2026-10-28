/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();

// Controllers
const adminAuthController = require('../controllers/auth/admin.auth.controller');
const assignerAuthController = require('../controllers/auth/assigner.auth.controller');
const surveyorAuthController = require('../controllers/auth/surveyor.auth.controller');
const otpController = require('../controllers/auth/otp.controller');

// Middleware
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { uploadSurveyorKYC } = require('../middleware/upload');
const { loginValidator, adminLoginValidator, surveyorRegisterValidator, pinLoginValidator } = require('../validators');

// ==================== OTP VERIFICATION ====================
router.post('/send-otp', otpController.sendOTP);
router.post('/verify-otp', otpController.verifyOTP);

// ==================== ADMIN AUTH ====================
router.post('/admin/login', adminLoginValidator, validate, adminAuthController.login);
router.post('/admin/refresh-token', adminAuthController.refreshToken);
router.post('/admin/logout', authenticate, adminAuthController.logout);
router.post('/admin/forgot-password', adminAuthController.forgotPassword);
router.post('/admin/reset-password', adminAuthController.resetPassword);

// ==================== ASSIGNER AUTH ====================
router.post('/assigner/login', loginValidator, validate, assignerAuthController.login);
router.post('/assigner/refresh-token', assignerAuthController.refreshToken);
router.post('/assigner/logout', authenticate, assignerAuthController.logout);
router.post('/assigner/forgot-password', assignerAuthController.forgotPassword);
router.post('/assigner/reset-password', assignerAuthController.resetPassword);
router.post('/assigner/delete-account', authenticate, assignerAuthController.deleteAccount);

// ==================== SURVEYOR AUTH ====================
router.post('/surveyor/register', uploadSurveyorKYC, surveyorRegisterValidator, validate, surveyorAuthController.register);
router.post('/surveyor/login', loginValidator, validate, surveyorAuthController.login);
router.post('/surveyor/login-pin', pinLoginValidator, validate, surveyorAuthController.loginWithPIN);
router.post('/surveyor/refresh-token', surveyorAuthController.refreshToken);
router.post('/surveyor/logout', authenticate, surveyorAuthController.logout);
router.post('/surveyor/forgot-password', surveyorAuthController.forgotPassword);
router.post('/surveyor/reset-password', surveyorAuthController.resetPassword);
router.post('/surveyor/delete-account', authenticate, surveyorAuthController.deleteAccount);

module.exports = router;

