/**
 * Surveyor Routes
 */

const express = require('express');
const router = express.Router();

// Controllers
const profileController = require('../controllers/surveyor/profile.controller');
const teamController = require('../controllers/team/team.controller');
const surveyController = require('../controllers/surveyor/survey.controller');
const walletController = require('../controllers/surveyor/wallet.controller');
const chatController = require('../controllers/chat/chat.controller');
const surveyorAuthController = require('../controllers/auth/surveyor.auth.controller');
const disputeController = require('../controllers/surveyor/dispute.controller');
const notificationController = require('../controllers/notification/notification.controller');

// Middleware
const { authenticate } = require('../middleware/auth');
const { surveyorOnly } = require('../middleware/roleGuard');
const { validate } = require('../middleware/validate');
const {
  uploadKYCDocument, uploadProfilePicture, uploadSelfie,
  uploadMultiplePhotos, uploadMultipleVideos, uploadDocument, uploadReport
} = require('../middleware/upload');
const {
  idParamValidator, paginationValidator, etaValidator, locationSubmitValidator
} = require('../validators');

// All surveyor routes require authentication and surveyor role
router.use(authenticate, surveyorOnly);

// ==================== MPIN (Set after first login) ====================
router.post('/set-pin', surveyorAuthController.setMPIN);
router.post('/change-pin', surveyorAuthController.changeMPIN);

// ==================== PROFILE ====================
router.get('/profile', profileController.getProfile);
router.put('/profile', uploadProfilePicture, profileController.updateProfile);

// ==================== TEAM INVITATIONS (v2 §2) ====================
// The confirmation the surveyor acts on "on his profile".
router.get('/team-invites', teamController.listMyInvites);
router.put('/team-invites/:assignerId', teamController.respondToInvite);
router.put('/change-password', profileController.changePassword);

// ==================== KYC DOCUMENTS ====================
router.post('/documents', uploadKYCDocument, profileController.uploadDocument);
router.get('/documents', profileController.listDocuments);
router.delete('/documents/:id', idParamValidator, validate, profileController.deleteDocument);

// ==================== AVAILABILITY & LOCATION ====================
router.put('/availability', profileController.toggleAvailability);
router.put('/location', locationSubmitValidator, validate, profileController.updateLocation);

// ==================== BANK DETAILS ====================
router.put('/bank-details', profileController.updateBankDetails);

// ==================== PUSH NOTIFICATIONS (FCM) ====================
router.post('/notifications/register-token', notificationController.registerToken);
router.post('/notifications/remove-token', notificationController.removeToken);
router.get('/notifications/app', paginationValidator, validate, notificationController.getNotifications);
router.get('/notifications/unread-count', notificationController.getUnreadCount);
router.put('/notifications/:id/read', idParamValidator, validate, notificationController.markAsRead);
router.put('/notifications/read-all', notificationController.markAllAsRead);

// ==================== SURVEY NOTIFICATIONS (Legacy) ====================
router.get('/notifications', paginationValidator, validate, surveyController.getNotifications);
router.post('/notifications/:id/accept', etaValidator, validate, surveyController.acceptNotification);
router.post('/notifications/:id/decline', surveyController.declineNotification);

// ==================== SURVEYS ====================
router.get('/available-surveys', surveyController.getAvailableBroadcasts);
router.post('/surveys/:id/accept-broadcast', idParamValidator, validate, surveyController.acceptBroadcast);
router.get('/surveys', paginationValidator, validate, surveyController.listSurveys);
router.get('/surveys/:id', idParamValidator, validate, surveyController.getSurvey);
router.put('/surveys/:id/start-transit', idParamValidator, validate, surveyController.startTransit);
router.post('/surveys/:id/location-update', locationSubmitValidator, validate, surveyController.updateTransitLocation);
router.put('/surveys/:id/arrived', surveyController.markArrived);

// ==================== PHOTOS ====================
router.post('/surveys/:id/selfie', uploadSelfie, surveyController.uploadSelfie);
router.post('/surveys/:id/photos', uploadMultiplePhotos, surveyController.uploadPhotos);
router.get('/surveys/:id/photos', idParamValidator, validate, surveyController.getSurveyPhotos);
router.delete('/surveys/:id/photos/:photoId', surveyController.deletePhoto);

// ==================== VIDEOS ====================
router.post('/surveys/:id/videos', uploadMultipleVideos, surveyController.uploadVideos);
router.get('/surveys/:id/videos', idParamValidator, validate, surveyController.getSurveyVideos);
router.delete('/surveys/:id/videos/:videoId', surveyController.deleteVideo);

// ==================== DOCUMENTS ====================
router.get('/surveys/:id/documents', idParamValidator, validate, surveyController.getSurveyDocuments);
router.post('/surveys/:id/documents', uploadDocument, surveyController.uploadDocument);

// ==================== SURVEY COMPLETION ====================
router.put('/surveys/:id/complete-visit', idParamValidator, validate, surveyController.completeVisit);
router.post('/surveys/:id/reports', uploadReport, surveyController.submitReport);
router.put('/surveys/:id/notes', surveyController.updateNotes);
router.get('/surveys/:id/notes', idParamValidator, validate, surveyController.getSessionNotes);

// ==================== DISPUTES ====================
router.get('/surveys/:id/dispute', idParamValidator, validate, disputeController.getDisputeBySurvey);
router.post('/disputes/:id/messages', idParamValidator, validate, disputeController.addMessage);

// ==================== CHAT ====================
router.get('/surveys/:id/chat', idParamValidator, validate, chatController.getMessages);
router.post('/surveys/:id/chat', idParamValidator, validate, chatController.sendMessage);

// ==================== PAYOUTS ====================
// router.get('/payouts', payoutController.listPayouts);
// router.get('/payouts/:id', payoutController.getPayoutDetails);

// ==================== WALLET ====================
router.get('/wallet', walletController.getWalletBalance);
router.get('/wallet/transactions', paginationValidator, validate, walletController.getWalletTransactions);

module.exports = router;
