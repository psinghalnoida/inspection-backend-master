/**
 * Survey Type-Specific Routes
 */

const express = require('express');
const router = express.Router();

// Controllers
const surveyTypeController = require('../controllers/survey/survey.type.controller');

// Middleware
const { authenticate } = require('../middleware/auth');
const { assignerOnly, anyAuthenticated } = require('../middleware/roleGuard');
const { validate } = require('../middleware/validate');
const { idParamValidator, motorDetailsValidator, marineDetailsValidator, investigationDetailsValidator } = require('../validators');

// All survey routes require authentication
router.use(authenticate);

// ==================== MOTOR DETAILS ====================
router.post('/:id/motor-details', assignerOnly, motorDetailsValidator, validate, surveyTypeController.addMotorDetails);
router.get('/:id/motor-details', idParamValidator, validate, surveyTypeController.getMotorDetails);
router.put('/:id/motor-details', assignerOnly, surveyTypeController.updateMotorDetails);

// ==================== MARINE DETAILS ====================
router.post('/:id/marine-details', assignerOnly, marineDetailsValidator, validate, surveyTypeController.addMarineDetails);
router.get('/:id/marine-details', idParamValidator, validate, surveyTypeController.getMarineDetails);
router.post('/:id/marine-details/invoices', assignerOnly, surveyTypeController.addMarineInvoice);
router.post('/:id/marine-details/gr-entries', assignerOnly, surveyTypeController.addMarineGREntry);

// ==================== INVESTIGATION DETAILS ====================
router.post('/:id/investigation-details', assignerOnly, investigationDetailsValidator, validate, surveyTypeController.addInvestigationDetails);
router.get('/:id/investigation-details', idParamValidator, validate, surveyTypeController.getInvestigationDetails);
router.put('/:id/investigation-details', assignerOnly, surveyTypeController.updateInvestigationDetails);

module.exports = router;
