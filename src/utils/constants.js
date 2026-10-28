/**
 * Application Constants
 */

// User Roles
const USER_ROLES = {
  ADMIN: 'admin',
  ASSIGNER: 'assigner',
  SURVEYOR: 'surveyor'
};

// Survey Types
const SURVEY_TYPES = {
  MOTOR_SPOT: 'motor_spot',
  MOTOR_FINAL: 'motor_final',
  MARINE_FINAL: 'marine_final',
  MARINE_CARGO_INVESTIGATION: 'marine_cargo_investigation',
  INVESTIGATION: 'investigation'
};

// Surveyor Categories (v2 §1) — licensed lines of business granted by admin.
// 'investigator' is NOT here: it is a baseline flag on every surveyor
// (surveyors.is_investigator), not a category. See migration 025.
const SURVEYOR_CATEGORIES = {
  MOTOR: 'motor',
  MARINE: 'marine',
  FIRE: 'fire',
  ENGINEERING: 'engineering',
  MISCELLANEOUS: 'miscellaneous',
  LOP: 'lop',
  HULL: 'hull',
  AVIATION: 'aviation'
};

const SURVEYOR_CATEGORY_LIST = Object.values(SURVEYOR_CATEGORIES);

// Which category a case type requires to be broadcast to a surveyor.
// Only motor and marine gate anything today — the other six categories have no
// matching survey_type, so they are licence metadata / badge only (v2 §1.3).
//
// NOTE: marine_cargo_investigation is MARINE, not investigation. The rest of the
// backend already branches on survey_type.includes('marine'), so it never
// matches === 'investigation'. Keeping it Marine preserves existing behaviour.
const SURVEY_TYPE_REQUIRED_CATEGORY = {
  motor_spot: SURVEYOR_CATEGORIES.MOTOR,
  motor_final: SURVEYOR_CATEGORIES.MOTOR,
  marine_final: SURVEYOR_CATEGORIES.MARINE,
  marine_cargo_investigation: SURVEYOR_CATEGORIES.MARINE,
  investigation: null // open to every investigator
};

// Survey Status
const SURVEY_STATUS = {
  PENDING: 'pending',
  LOCATION_DETECTED: 'location_detected',
  ASSIGNED: 'assigned',
  IN_TRANSIT: 'in_transit',
  ARRIVED: 'arrived',
  VISIT_COMPLETED: 'visit_completed',
  REPORT_SUBMITTED: 'report_submitted',
  // FINISHED is the canonical terminal status (set when the assigner marks a
  // survey satisfied or a dispute resolves). Frontends display it as "Completed".
  FINISHED: 'finished',
  // COMPLETED is a legacy alias kept for backward compatibility — no code path
  // assigns it to a survey. Treat it as equivalent to FINISHED.
  COMPLETED: 'completed',
  DISPUTED: 'disputed',
  NOT_RESOLVED: 'not_resolved',
  CANCELLED: 'cancelled',
  ESCALATED: 'escalated'
};

// Location Detection Methods
const LOCATION_METHODS = {
  GPS_AUTO: 'gps_auto',
  MANUAL_COORDINATES: 'manual_coordinates',
  SMS_LINK: 'sms_link',
  PINCODE_ENTRY: 'pincode_entry',
  GOOGLE_MAPS_LINK: 'google_maps_link'
};

// Vehicle Categories
const VEHICLE_CATEGORIES = {
  PRIVATE: 'private',
  COMMERCIAL: 'commercial'
};

// Vehicle Types
const VEHICLE_TYPES = {
  MOTOR_CAR: 'motor_car',
  TRACTOR: 'tractor',
  MOTORCYCLE: 'motorcycle',
  CONSTRUCTION_EQUIPMENT: 'construction_equipment',
  BUS: 'bus',
  GOODS_CARRIER: 'goods_carrier',
  OTHERS: 'others'
};

// Loss Item Types (Investigation)
const LOSS_ITEM_TYPES = {
  VEHICLE: 'vehicle',
  CATTLE: 'cattle',
  HUMAN: 'human',
  OTHERS: 'others'
};

// Document Types
const DOCUMENT_TYPES = {
  RC: 'rc',
  DL: 'dl',
  POLICY: 'policy',
  FIR: 'fir',
  GR: 'gr',
  INVOICE: 'invoice',
  OTHERS: 'others'
};

// Photo Types
const PHOTO_TYPES = {
  SELFIE: 'selfie',
  LIVE: 'live',
  SYNC_MODE: 'sync_mode',
  GALLERY: 'gallery'
};

// Payment Status
const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded'
};

// Payout Status
const PAYOUT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Dispute Status
const DISPUTE_STATUS = {
  OPEN: 'open',
  IN_DISCUSSION: 'in_discussion',
  RESUBMITTED: 'resubmitted',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
};

// Verification Status
const VERIFICATION_STATUS = {
  PENDING: 'pending',
  UNDER_REVIEW: 'under_review',
  VERIFIED: 'verified',
  REJECTED: 'rejected'
};

// Notification Response Status
const NOTIFICATION_RESPONSE = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  SELECTED: 'selected'
};

// Report Status
const REPORT_STATUS = {
  SUBMITTED: 'submitted',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  RESUBMIT_REQUIRED: 'resubmit_required'
};

// File size limits (in bytes)
const FILE_LIMITS = {
  MAX_IMAGE_SIZE: 500 * 1024,      // 500KB
  MAX_DOCUMENT_SIZE: 300 * 1024,   // 300KB
  MAX_VIDEO_DURATION: 120,          // 2 minutes
  MAX_UPLOAD_SIZE: 5 * 1024 * 1024  // 5MB
};

// Allowed file types
const ALLOWED_FILE_TYPES = {
  IMAGES: ['image/jpeg', 'image/jpg', 'image/png'],
  DOCUMENTS: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'],
  VIDEOS: ['video/mp4', 'video/quicktime']
};

module.exports = {
  USER_ROLES,
  SURVEY_TYPES,
  SURVEYOR_CATEGORIES,
  SURVEYOR_CATEGORY_LIST,
  SURVEY_TYPE_REQUIRED_CATEGORY,
  SURVEY_STATUS,
  LOCATION_METHODS,
  VEHICLE_CATEGORIES,
  VEHICLE_TYPES,
  LOSS_ITEM_TYPES,
  DOCUMENT_TYPES,
  PHOTO_TYPES,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
  DISPUTE_STATUS,
  VERIFICATION_STATUS,
  NOTIFICATION_RESPONSE,
  REPORT_STATUS,
  FILE_LIMITS,
  ALLOWED_FILE_TYPES
};
