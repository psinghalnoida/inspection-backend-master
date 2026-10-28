/**
 * Public Location Controller - SMS Link Location Capture
 */

const db = require('../../config/database');
const { success, error, notFound } = require('../../utils/response');
const { SURVEY_STATUS, LOCATION_METHODS } = require('../../utils/constants');

/**
 * Get Location Capture Page (Validate Token & Render EJS)
 * GET /api/v1/public/location/:smsToken
 */
const getLocationPage = async (req, res, next) => {
  try {
    const { smsToken } = req.params;

    const survey = await db.execute_single(
      `SELECT id, laid, contact_person_name, status, sms_link_clicked_at, latitude, longitude
       FROM surveys WHERE sms_link_token = ?`,
      [smsToken]
    );

    if (!survey) {
      return res.status(404).render('location-error', {
        title: 'Invalid Link',
        message: 'This location link is invalid or has expired.'
      });
    }

    // Check if location is already captured (has latitude and longitude)
    const locationAlreadyCaptured = !!(survey.latitude && survey.longitude);

    // Render the location capture page with survey info
    res.render('location-capture', {
      survey_id: survey.id,
      laid: survey.laid,
      contact_person_name: survey.contact_person_name,
      already_clicked: locationAlreadyCaptured,
      sms_token: smsToken
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Submit Location from SMS Link
 * POST /api/v1/public/location/:smsToken
 * This updates survey status to LOCATION_DETECTED
 */
const submitLocation = async (req, res, next) => {
  try {
    const { smsToken } = req.params;
    const { latitude, longitude, pincode, city, state, address } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json(error('Latitude and longitude are required'));
    }

    const survey = await db.execute_single(
      `SELECT id, status, assigner_id, surveyor_id, laid, is_direct_assign,
              latitude as existing_latitude, longitude as existing_longitude
       FROM surveys WHERE sms_link_token = ?`,
      [smsToken]
    );

    if (!survey) {
      return res.status(404).json(notFound('Invalid or expired location link'));
    }

    // Check if location is already captured (has latitude and longitude)
    if (survey.existing_latitude && survey.existing_longitude) {
      return res.status(400).json(error('Location already captured for this survey'));
    }

    // Get assigner location for distance calculation
    const assigner = await db.execute_single(
      'SELECT latitude, longitude FROM assigners WHERE id = ?',
      [survey.assigner_id]
    );

    let distanceFromAssignerKm = null;
    if (assigner && assigner.latitude && assigner.longitude) {
      const { calculateDistance } = require('../../utils/helpers');
      distanceFromAssignerKm = calculateDistance(
        assigner.latitude, assigner.longitude,
        latitude, longitude
      );
    }

    // Reverse geocode if address not provided
    let finalAddress = address;
    let finalCity = city;
    let finalState = state;
    let finalPincode = pincode;

    if (!address || !city || !state) {
      const { reverseGeocode } = require('../../utils/helpers');
      console.log('🌍 Reverse geocoding SMS location:', latitude, longitude);
      const geoResult = await reverseGeocode(latitude, longitude);
      if (geoResult) {
        console.log('📍 Geocode result:', geoResult);
        finalAddress = finalAddress || geoResult.address;
        finalCity = finalCity || geoResult.city;
        finalState = finalState || geoResult.state;
        finalPincode = finalPincode || geoResult.pincode;
      }
    }

    // Determine new status:
    // - Direct assign + assigned: go to in_transit immediately (no payment needed)
    // - Already assigned (normal): stay assigned (payment still required)
    // - Otherwise: set to location_detected and trigger broadcast
    const isDirectAssignSmsEdge = survey.status === SURVEY_STATUS.ASSIGNED && survey.is_direct_assign;
    let newStatus;
    if (isDirectAssignSmsEdge) {
      newStatus = SURVEY_STATUS.IN_TRANSIT;
    } else if (survey.status === SURVEY_STATUS.ASSIGNED) {
      newStatus = SURVEY_STATUS.ASSIGNED;
    } else {
      newStatus = SURVEY_STATUS.LOCATION_DETECTED;
    }

    const { generateQRToken } = require('../../utils/helpers');
    const qrToken = isDirectAssignSmsEdge ? generateQRToken() : null;
    const qrCodeUrl = qrToken ? `${process.env.QR_TRACKING_BASE_URL}/${qrToken}` : null;

    await db.execute_query(
      `UPDATE surveys SET
        latitude = ?,
        longitude = ?,
        pincode = ?,
        city = ?,
        state = ?,
        address = ?,
        sms_link_clicked_at = NOW(),
        distance_from_assigner_km = ?,
        status = ?,
        ${qrCodeUrl ? 'qr_code_url = ?, qr_code_generated_at = NOW(),' : ''}
        ${isDirectAssignSmsEdge ? 'in_transit_at = NOW(),' : ''}
        updated_at = NOW()
       WHERE id = ?`,
      qrCodeUrl
        ? [latitude, longitude, finalPincode || null, finalCity || null, finalState || null, finalAddress || null, distanceFromAssignerKm, newStatus, qrCodeUrl, survey.id]
        : [latitude, longitude, finalPincode || null, finalCity || null, finalState || null, finalAddress || null, distanceFromAssignerKm, newStatus, survey.id]
    );

    if (survey.status !== newStatus) {
      await db.execute_query(
        `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, remarks)
         VALUES (?, ?, ?, 'system', ?)`,
        [survey.id, survey.status, newStatus,
          isDirectAssignSmsEdge
            ? 'Location captured via SMS link — direct assignment, survey started without payment'
            : 'Location captured via SMS link']
      );
    }

    if (isDirectAssignSmsEdge && survey.surveyor_id) {
      const notificationHelper = require('../../services/notification.helper');
      notificationHelper.notifySurveyorPaymentCompleted(
        survey.surveyor_id,
        { id: survey.id, laid: survey.laid }
      ).catch(err => console.error('Notification error:', err));
    }

    if (newStatus === SURVEY_STATUS.LOCATION_DETECTED) {
      const { triggerBroadcast } = require('../../services/broadcast.service');
      await triggerBroadcast(survey.id, latitude, longitude);
    }

    res.json(success({
      message: 'Location captured successfully',
      survey_id: survey.id
    }));
  } catch (err) {
    next(err);
  }
};



/**
 * Track Survey via QR Code
 * GET /api/v1/public/track/:qrToken
 */
const trackByQR = async (req, res, next) => {
  try {
    const { qrToken } = req.params;

    const survey = await db.execute_single(
      `SELECT s.id, s.laid, s.survey_type, s.status, s.contact_person_name,
              s.city, s.state, s.surveyor_eta_minutes, s.surveyor_assigned_at,
              s.surveyor_arrived_at, s.created_at,
              sv.full_name as surveyor_name, sv.phone as surveyor_phone
       FROM surveys s
       LEFT JOIN surveyors sv ON s.surveyor_id = sv.id
       WHERE s.qr_code_url LIKE ?`,
      [`%${qrToken}%`]
    );

    if (!survey) {
      return res.status(404).json(notFound('Invalid tracking code'));
    }

    // Get status history for timeline
    const history = await db.execute_query(
      `SELECT new_status, remarks, created_at
       FROM survey_status_history
       WHERE survey_id = ?
       ORDER BY created_at ASC`,
      [survey.id]
    );

    res.json(success({
      survey: {
        id: survey.id,
        laid: survey.laid,
        type: survey.survey_type,
        status: survey.status,
        contact_person: survey.contact_person_name,
        location: `${survey.city || ''}, ${survey.state || ''}`.trim() || 'Not available',
        surveyor_name: survey.surveyor_name,
        eta_minutes: survey.surveyor_eta_minutes,
        assigned_at: survey.surveyor_assigned_at,
        arrived_at: survey.surveyor_arrived_at,
        created_at: survey.created_at
      },
      timeline: history
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Health Check
 * GET /api/v1/public/health
 */
const healthCheck = async (req, res, next) => {
  try {
    // Test database connection
    await db.execute_single('SELECT 1');

    res.json(success({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected'
    }));
  } catch (err) {
    res.status(500).json(error('Service unhealthy', { database: 'disconnected' }));
  }
};

/**
 * Get App Config
 * GET /api/v1/public/config/app
 */
const getAppConfig = async (req, res, next) => {
  try {
    // Admin-controlled app-update settings live in system_config (category 'app_update')
    const rows = await db.execute_query(
      `SELECT config_key, config_value FROM system_config
       WHERE category = 'app_update' OR config_key = 'maintenance_mode'`
    );
    const cfg = rows.reduce((acc, r) => { acc[r.config_key] = r.config_value; return acc; }, {});
    const toBool = (v, fallback = false) =>
      v === undefined ? fallback : (v === 'true' || v === '1' || v === true);

    res.json(success({
      app_name: 'ClaimsMitra',
      latest_version: cfg.latest_app_version || '1.0.0',
      min_supported_version: cfg.min_supported_version || '1.0.0',
      force_update: toBool(cfg.force_update, false),
      update_title: cfg.update_title || 'Update Available',
      update_message: cfg.update_message || 'A new version of ClaimsMitra is available. Please update to continue.',
      android_store_url: cfg.android_store_url || 'https://play.google.com/store/apps/details?id=com.xenotix.claimsmitra',
      ios_store_url: cfg.ios_store_url || 'https://apps.apple.com/sg/app/claimsmitra/id6760928718',
      maintenance_mode: toBool(cfg.maintenance_mode, false)
    }));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getLocationPage,
  submitLocation,
  trackByQR,
  healthCheck,
  getAppConfig
};
