/**
 * Request Validators
 */

const { body, param, query } = require('express-validator');

// ==================== AUTH VALIDATORS ====================

const loginValidator = [
  body('phone')
    .optional()
    .isLength({ min: 10, max: 10 })
    .withMessage('Phone must be 10 digits')
    .isNumeric()
    .withMessage('Phone must contain only numbers'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format'),
  body('password')
    .notEmpty()
    .withMessage('PIN is required')
    .isLength({ min: 4, max: 4 })
    .withMessage('PIN must be 4 digits')
    .isNumeric()
    .withMessage('PIN must contain only numbers')
];

// Admin login validator - allows flexible password (not restricted to 4-digit PIN)
const adminLoginValidator = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email format'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 4 })
    .withMessage('Password must be at least 4 characters')
];

const pinLoginValidator = [
  body('phone')
    .notEmpty()
    .withMessage('Phone is required')
    .isLength({ min: 10, max: 10 })
    .withMessage('Phone must be 10 digits'),
  body('pin')
    .notEmpty()
    .withMessage('PIN is required')
    .isLength({ min: 4, max: 4 })
    .withMessage('PIN must be 4 digits')
];

const surveyorRegisterValidator = [
  body('full_name')
    .notEmpty()
    .withMessage('Full name is required')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name must contain only letters and spaces'),
  body('email')
    .isEmail()
    .withMessage('Valid email is required'),
  body('phone')
    .isLength({ min: 10, max: 10 })
    .withMessage('Phone must be 10 digits')
    .isNumeric()
    .withMessage('Phone must contain only numbers'),
  body('password')
    .isLength({ min: 4, max: 4 })
    .withMessage('PIN must be 4 digits')
    .isNumeric()
    .withMessage('PIN must contain only numbers'),
  // Note: PIN is set after first login, not during registration
  body('business_address')
    .optional()
    .isString(),
  body('city')
    .optional()
    .isString()
    .isLength({ max: 100 }),
  body('state')
    .optional()
    .isString()
    .isLength({ max: 100 }),
  body('pincode')
    .optional()
    .isLength({ min: 6, max: 6 })
    .withMessage('Pincode must be 6 digits')
    .isNumeric()
    .withMessage('Pincode must contain only numbers'),
  body('surveyor_license_id')
    .optional()
    .isString()
    .isLength({ max: 50 }),
  // Profile picture is required
  body('profile_picture')
    .custom((value, { req }) => {
      if (!req.files || !req.files.profile_picture) {
        throw new Error('Profile picture is required');
      }
      return true;
    }),
  // Government ID is required
  body('government_id')
    .custom((value, { req }) => {
      if (!req.files || !req.files.government_id) {
        throw new Error('Government ID is required');
      }
      return true;
    }),
  // Proof of address is required
  body('proof_of_address')
    .custom((value, { req }) => {
      if (!req.files || !req.files.proof_of_address) {
        throw new Error('Proof of address is required');
      }
      return true;
    }),
];

// ==================== SURVEY VALIDATORS ====================

const createSurveyValidator = [
  // === Common Fields ===
  body('survey_type')
    .isIn(['motor_spot', 'motor_final', 'marine_final', 'marine_cargo_investigation', 'investigation'])
    .withMessage('Invalid survey type'),
  body('contact_person_name')
    .notEmpty()
    .withMessage('Contact person name is required')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name must contain only letters and spaces'),
  body('contact_person_mobile')
    .isLength({ min: 10, max: 10 })
    .withMessage('Mobile must be 10 digits')
    .isNumeric()
    .withMessage('Mobile must contain only numbers'),
  body('contact_person_available')
    .optional()
    .isBoolean(),
  body('alternate_whatsapp_number')
    .optional()
    .isLength({ min: 10, max: 10 })
    .withMessage('Alternate number must be 10 digits')
    .isNumeric()
    .withMessage('Alternate number must contain only numbers'),
  body('location_method')
    .isIn(['gps_auto', 'manual_coordinates', 'sms_link', 'pincode_entry', 'google_maps_link'])
    .withMessage('Invalid location method'),
  body('latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude'),
  body('longitude')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude'),
  body('pincode')
    .optional()
    .isLength({ min: 6, max: 6 })
    .withMessage('Pincode must be 6 digits')
    .isNumeric()
    .withMessage('Pincode must be numeric'),
  body('city')
    .optional()
    .isString(),
  body('state')
    .optional()
    .isString(),
  body('address')
    .optional()
    .isString(),
  body('case_reference')
    .notEmpty()
    .withMessage('Case reference is required'),
  body('name_of_insured')
    .optional()
    .matches(/^[a-zA-Z\s]*$/)
    .withMessage('Insured name must contain only letters'),
  body('policy_number')
    .optional()
    .isAlphanumeric()
    .withMessage('Policy number must be alphanumeric'),
  body('cause_of_loss')
    .optional()
    .isString(),
  body('instructions')
    .optional()
    .isString(),
  body('is_emergency')
    .optional()
    .isBoolean(),

  // === Motor Specific Fields ===
  body('vehicle_category')
    .if(body('survey_type').matches(/motor/))
    .isIn(['private', 'commercial'])
    .withMessage('Invalid vehicle category'),
  body('vehicle_type')
    .if(body('survey_type').matches(/motor/))
    .isIn(['motor_car', 'tractor', 'motorcycle', 'construction_equipment', 'bus', 'goods_carrier', 'others'])
    .withMessage('Invalid vehicle type'),
  body('vehicle_type_other')
    .if(body('vehicle_type').equals('others'))
    .notEmpty()
    .withMessage('Specify other vehicle type'),
  body('vehicle_number')
    .if(body('survey_type').matches(/motor/))
    .notEmpty()
    .withMessage('Vehicle number is required')
    .matches(/^[A-Za-z]{2}\s?\d{1,2}\s?[A-Za-z]{0,3}\s?\d{1,4}$/)
    .withMessage('Invalid vehicle number format (e.g., UP32 AB 1234)'),

  // === Marine Specific Fields ===
  body('name_of_consignee')
    .if(body('survey_type').matches(/marine/))
    .notEmpty()
    .withMessage('Consignee name is required')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Consignee name must contain only letters'),
  body('name_of_consignor')
    .if(body('survey_type').matches(/marine/))
    .notEmpty()
    .withMessage('Consignor name is required')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Consignor name must contain only letters'),
  body('commodity')
    .if(body('survey_type').matches(/marine/))
    .notEmpty()
    .withMessage('Commodity is required'),
  body('invoices')
    .if(body('survey_type').matches(/marine/))
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try { JSON.parse(value); } catch { throw new Error('Invalid invoices JSON format'); }
      }
      return true;
    }),
  body('gr_entries')
    .if(body('survey_type').matches(/marine/))
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try { JSON.parse(value); } catch { throw new Error('Invalid GR entries JSON format'); }
      }
      return true;
    }),

  // === Investigation Specific Fields ===
  body('loss_item_type')
    .if(body('survey_type').equals('investigation'))
    .isIn(['vehicle', 'cattle', 'human', 'others'])
    .withMessage('Invalid loss item type'),
  // Vehicle loss
  body('investigation_vehicle_number')
    .if(body('loss_item_type').equals('vehicle'))
    .notEmpty()
    .withMessage('Vehicle number required for vehicle loss')
    .matches(/^[A-Za-z]{2}\s?\d{1,2}\s?[A-Za-z]{0,3}\s?\d{1,4}$/)
    .withMessage('Invalid vehicle number format'),
  // Cattle loss
  body('cattle_tag_number')
    .if(body('loss_item_type').equals('cattle'))
    .notEmpty()
    .withMessage('Cattle tag number required'),
  body('cattle_name')
    .if(body('loss_item_type').equals('cattle'))
    .notEmpty()
    .withMessage('Cattle name required')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Cattle name must contain only letters'),
  // Human loss
  body('human_name')
    .if(body('loss_item_type').equals('human'))
    .notEmpty()
    .withMessage('Name required for human loss')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name must contain only letters'),
  body('human_contact_number')
    .if(body('loss_item_type').equals('human'))
    .notEmpty()
    .withMessage('Contact number required')
    .isLength({ min: 10, max: 10 })
    .withMessage('Contact must be 10 digits'),
  body('human_relation')
    .if(body('loss_item_type').equals('human'))
    .notEmpty()
    .withMessage('Relation required')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Relation must contain only letters'),
  // Others loss
  body('other_loss_item_name')
    .if(body('loss_item_type').equals('others'))
    .notEmpty()
    .withMessage('Loss item name required'),

  // === Document Types (array of document types for uploaded files) ===
  body('document_types')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try { JSON.parse(value); } catch { throw new Error('Invalid document types format'); }
      }
      return true;
    })
];

// Motor Survey Details Validator (for separate endpoint)
const motorDetailsValidator = [
  body('vehicle_category')
    .isIn(['private', 'commercial'])
    .withMessage('Invalid vehicle category'),
  body('vehicle_type')
    .isIn(['motor_car', 'tractor', 'motorcycle', 'construction_equipment', 'bus', 'goods_carrier', 'others'])
    .withMessage('Invalid vehicle type'),
  body('vehicle_number')
    .notEmpty()
    .withMessage('Vehicle number is required')
    .matches(/^[A-Za-z]{2}\s?\d{1,2}\s?[A-Za-z]{0,3}\s?\d{1,4}$/)
    .withMessage('Invalid vehicle number format')
];

// Marine Survey Details Validator (for separate endpoint)
const marineDetailsValidator = [
  body('name_of_consignee')
    .notEmpty()
    .withMessage('Consignee name is required')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Consignee name must contain only letters'),
  body('name_of_consignor')
    .notEmpty()
    .withMessage('Consignor name is required')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Consignor name must contain only letters'),
  body('commodity')
    .notEmpty()
    .withMessage('Commodity is required')
];

// Invoice Validator
const invoiceValidator = [
  body('invoice_number')
    .notEmpty()
    .withMessage('Invoice number required')
    .matches(/^[a-zA-Z0-9\-\/]+$/)
    .withMessage('Invoice number can only contain alphanumeric, hyphens, slashes'),
  body('invoice_date')
    .notEmpty()
    .withMessage('Invoice date required')
    .isISO8601()
    .withMessage('Invalid date format'),
  body('invoice_amount')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Invoice amount must be greater than 0')
];

// GR Entry Validator
const grEntryValidator = [
  body('gr_number')
    .notEmpty()
    .withMessage('GR number required')
    .matches(/^[a-zA-Z0-9\-\/]+$/)
    .withMessage('GR number can only contain alphanumeric, hyphens, slashes'),
  body('gr_date')
    .notEmpty()
    .withMessage('GR date required')
    .isISO8601()
    .withMessage('Invalid date format')
];

// Investigation Survey Details Validator (for separate endpoint)
const investigationDetailsValidator = [
  body('loss_item_type')
    .isIn(['vehicle', 'cattle', 'human', 'others'])
    .withMessage('Invalid loss item type'),
  body('vehicle_number')
    .if(body('loss_item_type').equals('vehicle'))
    .notEmpty()
    .withMessage('Vehicle number is required for vehicle loss'),
  body('cattle_tag_number')
    .if(body('loss_item_type').equals('cattle'))
    .notEmpty()
    .withMessage('Cattle tag number is required'),
  body('cattle_name')
    .if(body('loss_item_type').equals('cattle'))
    .notEmpty()
    .withMessage('Cattle name is required'),
  body('human_name')
    .if(body('loss_item_type').equals('human'))
    .notEmpty()
    .withMessage('Name is required for human loss'),
  body('human_contact_number')
    .if(body('loss_item_type').equals('human'))
    .notEmpty()
    .withMessage('Contact number is required'),
  body('human_relation')
    .if(body('loss_item_type').equals('human'))
    .notEmpty()
    .withMessage('Relation is required'),
  body('other_loss_item_name')
    .if(body('loss_item_type').equals('others'))
    .notEmpty()
    .withMessage('Loss item name is required')
];

// ==================== PAYMENT VALIDATORS ====================

const applyCouponValidator = [
  body('coupon_code')
    .notEmpty()
    .withMessage('Coupon code is required')
];

const createCouponValidator = [
  body('code')
    .notEmpty()
    .withMessage('Coupon code is required')
    .isLength({ max: 50 })
    .withMessage('Coupon code too long'),
  body('discount_type')
    .isIn(['percentage', 'fixed'])
    .withMessage('Invalid discount type'),
  body('discount_value')
    .isFloat({ min: 0 })
    .withMessage('Discount value must be positive'),
  body('valid_from')
    .isISO8601()
    .withMessage('Invalid start date'),
  body('valid_until')
    .isISO8601()
    .withMessage('Invalid end date')
];

// ==================== COMMON VALIDATORS ====================

const idParamValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid ID')
];

const paginationValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage('Limit must be between 1 and 10000')
];

const locationSubmitValidator = [
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude'),
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude')
];

const etaValidator = [
  body('eta_minutes')
    .isInt({ min: 0, max: 480 })
    .withMessage('ETA must be between 0 and 480 minutes (0 = immediately)')
];

const reportRejectValidator = [
  body('rejection_reason')
    .notEmpty()
    .withMessage('Rejection reason is required')
];

const disputeResolveValidator = [
  body('admin_decision')
    .isIn(['full_payment', 'partial_payment', 'no_payment'])
    .withMessage('Invalid decision'),
  body('admin_partial_amount')
    .if(body('admin_decision').equals('partial_payment'))
    .isFloat({ min: 0 })
    .withMessage('Partial amount is required for partial payment'),
  body('admin_decision_notes')
    .optional()
    .isString()
];

module.exports = {
  // Auth
  loginValidator,
  adminLoginValidator,
  pinLoginValidator,
  surveyorRegisterValidator,

  // Survey
  createSurveyValidator,
  motorDetailsValidator,
  marineDetailsValidator,
  investigationDetailsValidator,
  invoiceValidator,
  grEntryValidator,

  // Payment
  applyCouponValidator,
  createCouponValidator,

  // Common
  idParamValidator,
  paginationValidator,
  locationSubmitValidator,
  etaValidator,
  reportRejectValidator,
  disputeResolveValidator
};
