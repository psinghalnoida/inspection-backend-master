/**
 * Assigner Routes
 */

const express = require('express');
const router = express.Router();

// Controllers
const profileController = require('../controllers/assigner/profile.controller');
const teamController = require('../controllers/team/team.controller');
const ledgerController = require('../controllers/ledger/ledger.controller');
const surveyController = require('../controllers/assigner/survey.controller');
const disputeController = require('../controllers/assigner/dispute.controller');
const paymentController = require('../controllers/assigner/payment.controller');
const chatController = require('../controllers/chat/chat.controller');
const notificationController = require('../controllers/notification/notification.controller');
const surveyorMgmtController = require('../controllers/admin/surveyor.management.controller');

// Middleware
const { authenticate } = require('../middleware/auth');
const { assignerOnly } = require('../middleware/roleGuard');
const { validate } = require('../middleware/validate');
const { uploadSurveyFiles, uploadMultipleDocuments, uploadProfilePicture } = require('../middleware/upload');
const {
  idParamValidator, paginationValidator, createSurveyValidator,
  applyCouponValidator, reportRejectValidator
} = require('../validators');

// ==================== PUBLIC ENDPOINTS (Authentication required, but no role restriction) ====================
// Surveyor lookup by phone - works for authenticated assigners
router.get('/surveyors/by-phone', authenticate, surveyorMgmtController.findSurveyorByPhone);

// All assigner routes require authentication and assigner role
router.use(authenticate, assignerOnly);

// ==================== PROFILE ====================
router.get('/profile', profileController.getProfile);
router.put('/profile', uploadProfilePicture, profileController.updateProfile);
router.put('/change-password', profileController.changePassword);

// ==================== SURVEYOR TEAM / EMPLOYEES (v2 §2) ====================
// Team membership IS employment. The assigner invites; the surveyor consents.
router.get('/team', profileController.getTeam);
router.post('/team/invite', teamController.inviteMember);
router.delete('/team/:surveyorId', teamController.removeMember);

// ==================== PUSH NOTIFICATIONS (FCM) ====================
router.post('/notifications/register-token', notificationController.registerToken);
router.post('/notifications/remove-token', notificationController.removeToken);
router.get('/notifications/app', paginationValidator, validate, notificationController.getNotifications);
router.get('/notifications/unread-count', notificationController.getUnreadCount);
router.put('/notifications/:id/read', idParamValidator, validate, notificationController.markAsRead);
router.put('/notifications/read-all', notificationController.markAllAsRead);

// ==================== SURVEYS ====================
// Create survey with documents (multipart/form-data)
router.post('/surveys', uploadSurveyFiles, createSurveyValidator, validate, surveyController.createSurvey);
router.get('/surveys', paginationValidator, validate, surveyController.listSurveys);
router.get('/surveys/:id', idParamValidator, validate, surveyController.getSurvey);
router.get('/surveys/:id/status-history', idParamValidator, validate, surveyController.getStatusHistory);
router.get('/surveys/:id/photos', idParamValidator, validate, surveyController.getSurveyPhotos);
router.get('/surveys/:id/notes', idParamValidator, validate, surveyController.getSessionNotes);
router.get('/surveys/:id/documents', idParamValidator, validate, surveyController.getSurveyDocuments);
router.get('/surveys/:id/reports', idParamValidator, validate, surveyController.getSurveyReports);
router.get('/surveys/:id/broadcast-status', idParamValidator, validate, surveyController.getBroadcastStatus);
router.put('/surveys/:id/reports/:reportId/accept', surveyController.acceptReport);
router.put('/surveys/:id/reports/:reportId/reject', reportRejectValidator, validate, surveyController.rejectReport);
// Route Proxy (Bypasses API Key restrictions)
router.get('/route', validate, surveyController.getRoute);

router.get('/surveys/:id/surveyor-location', idParamValidator, validate, surveyController.getSurveyorLocation);

// Upload additional documents to existing survey
router.post('/surveys/:id/documents', idParamValidator, validate, uploadMultipleDocuments, surveyController.uploadDocuments);
router.delete('/surveys/:id/documents/:docId', surveyController.deleteDocument);

// SMS Location Link
router.post('/surveys/:id/send-location-sms', idParamValidator, validate, surveyController.sendLocationSMS);
router.post('/surveys/:id/resend-location-sms', idParamValidator, validate, surveyController.sendLocationSMS);

// Survey completion actions
router.post('/surveys/:id/satisfied', idParamValidator, validate, surveyController.markSatisfied);
router.post('/surveys/:id/escalate', idParamValidator, validate, surveyController.escalateSurvey);

// ==================== DISPUTES ====================
router.get('/surveys/:id/dispute', idParamValidator, validate, disputeController.getDisputeBySurvey);
router.post('/disputes/:id/messages', idParamValidator, validate, disputeController.addMessage);

// ==================== PAYMENT ====================
router.post('/surveys/:id/calculate-price', idParamValidator, validate, paymentController.calculatePrice);
router.post('/surveys/:id/apply-coupon', applyCouponValidator, validate, paymentController.applyCoupon);
router.post('/surveys/:id/initiate-payment', idParamValidator, validate, paymentController.initiatePayment);
router.post('/surveys/:id/verify-payment', paymentController.verifyPayment);
router.get('/payments', paginationValidator, validate, paymentController.getPaymentHistory);
// ==================== LEDGER (v2 §4) ====================
router.get('/ledger', paginationValidator, validate, ledgerController.getMyLedger);
router.get('/ledger/summary', ledgerController.getMySummary);

// v2 §3: the itemised final invoice for a survey (issued/settled only).
router.get('/surveys/:id/bill', idParamValidator, validate, paymentController.getSurveyBill);
// v2 §4: pay the invoice balance via SabPaisa. Settled server-side by the
// shared SabPaisa callback — no client-trusted verify step.
router.post('/surveys/:id/pay-balance', idParamValidator, validate, paymentController.payBalance);

// ==================== CHAT ====================
router.get('/surveys/:id/chat', idParamValidator, validate, chatController.getMessages);
router.post('/surveys/:id/chat', idParamValidator, validate, chatController.sendMessage);

module.exports = router;
