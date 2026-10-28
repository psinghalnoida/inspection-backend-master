/**
 * Surveyor Survey Controller - Survey Workflow
 */

const db = require('../../config/database');
const { success, error, notFound, paginated, created } = require('../../utils/response');
const { parsePagination, calculateDistance } = require('../../utils/helpers');
const { SURVEY_STATUS, NOTIFICATION_RESPONSE } = require('../../utils/constants');
const { surveyBroadcastQueue } = require('../../queues/survey.queue');
const notificationHelper = require('../../services/notification.helper');
const eligibility = require('../../services/eligibility.service');
const { emitMediaAdded, emitNotesUpdated } = require('../../config/socket');

// Coerce session_number from request body to a positive integer; default to 1.
const parseSessionNumber = (raw) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * Get Survey Notifications
 * GET /api/v1/surveyor/notifications
 * Only returns notifications where broadcast window is still active
 */
const getNotifications = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status } = req.query;

    // Base conditions: surveyor's notifications + survey still in location_detected + broadcast not expired
    let whereClause = `sn.surveyor_id = ? 
      AND s.status = 'location_detected' 
      AND (s.broadcast_ends_at IS NULL OR s.broadcast_ends_at > NOW())`;
    const whereParams = [req.user.id];

    if (status) {
      whereClause += ' AND sn.response_status = ?';
      whereParams.push(status);
    }

    const listParams = [...whereParams, limit, offset];

    const [notifications, countResult] = await Promise.all([
      db.query_rows(
        `SELECT sn.*, s.laid, s.survey_type, s.contact_person_name, 
                s.latitude, s.longitude, s.city, s.state, s.case_reference,
                s.broadcast_ends_at
         FROM surveyor_notifications sn
         JOIN surveys s ON sn.survey_id = s.id
         WHERE ${whereClause}
         ORDER BY sn.created_at DESC
         LIMIT ? OFFSET ?`,
        listParams
      ),
      db.query_single(
        `SELECT COUNT(*) as total FROM surveyor_notifications sn 
         JOIN surveys s ON sn.survey_id = s.id 
         WHERE ${whereClause}`,
        whereParams
      )
    ]);

    res.json(paginated(notifications, { page, limit, total: countResult.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Accept Survey Notification with ETA
 * POST /api/v1/surveyor/notifications/:id/accept
 */
const acceptNotification = async (req, res, next) => {
  try {
    const { eta_minutes } = req.body;

    // Allow 0 for immediate start, otherwise must be positive
    if (eta_minutes === undefined || eta_minutes === null || eta_minutes < 0) {
      return res.status(400).json(error('Valid ETA in minutes is required (0 = immediately)'));
    }

    const notification = await db.execute_single(
      `SELECT sn.*, s.status as survey_status
       FROM surveyor_notifications sn
       JOIN surveys s ON sn.survey_id = s.id
       WHERE sn.id = ? AND sn.surveyor_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!notification) {
      return res.status(404).json(notFound('Notification not found'));
    }

    if (notification.response_status !== NOTIFICATION_RESPONSE.PENDING) {
      return res.status(400).json(error('Already responded to this notification'));
    }

    if (notification.survey_status !== SURVEY_STATUS.LOCATION_DETECTED) {
      return res.status(400).json(error('Survey is no longer available'));
    }

    // Update notification
    await db.execute_query(
      `UPDATE surveyor_notifications SET 
        response_status = ?, eta_minutes = ?, responded_at = NOW()
       WHERE id = ?`,
      [NOTIFICATION_RESPONSE.ACCEPTED, eta_minutes, req.params.id]
    );

    // Check if this surveyor has shortest ETA
    const shortestETA = await db.execute_single(
      `SELECT id, surveyor_id, eta_minutes FROM surveyor_notifications
       WHERE survey_id = ? AND response_status = ?
       ORDER BY eta_minutes ASC LIMIT 1`,
      [notification.survey_id, NOTIFICATION_RESPONSE.ACCEPTED]
    );

    // If this surveyor has shortest ETA, assign survey
    if (shortestETA && shortestETA.surveyor_id === req.user.id) {
      // Mark this notification as selected
      await db.execute_query(
        'UPDATE surveyor_notifications SET response_status = ? WHERE id = ?',
        [NOTIFICATION_RESPONSE.SELECTED, req.params.id]
      );

      // Update survey with assigned surveyor
      await db.execute_query(
        `UPDATE surveys SET 
          status = ?,
          surveyor_id = ?,
          surveyor_eta_minutes = ?,
          surveyor_assigned_at = NOW(),
          updated_at = NOW()
         WHERE id = ?`,
        [SURVEY_STATUS.ASSIGNED, req.user.id, eta_minutes, notification.survey_id]
      );

      // Log status change
      await db.execute_query(
        `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
         VALUES (?, ?, ?, 'surveyor', ?, ?)`,
        [notification.survey_id, SURVEY_STATUS.LOCATION_DETECTED, SURVEY_STATUS.ASSIGNED, req.user.id, `Assigned with ETA: ${eta_minutes} minutes`]
      );

      // Get full survey and surveyor details for notifications
      const fullSurvey = await db.execute_single(
        'SELECT id, laid, assigner_id, surveyor_eta_minutes FROM surveys WHERE id = ?',
        [notification.survey_id]
      );
      const surveyor = await db.execute_single(
        'SELECT id, full_name FROM surveyors WHERE id = ?',
        [req.user.id]
      );
      const assigner = await db.execute_single(
        'SELECT id, company_name, full_name FROM assigners WHERE id = ?',
        [fullSurvey.assigner_id]
      );

      // Notify surveyor that they have been assigned
      if (fullSurvey && assigner) {
        notificationHelper.notifySurveyorSurveyAssigned(
          req.user.id,
          fullSurvey,
          assigner
        ).catch(err => console.error('Notification error:', err));
      }

      // Notify assigner that surveyor has been assigned
      if (fullSurvey && surveyor) {
        notificationHelper.notifyAssignerSurveyAssigned(
          fullSurvey.assigner_id,
          fullSurvey,
          surveyor
        ).catch(err => console.error('Notification error:', err));
      }

      // Close the broadcast for everyone else: expire their pending notifications,
      // clear the general broadcast_request, and drop the request card in real time.
      const broadcastService = require('../../services/broadcast.service');
      await broadcastService.closeBroadcastNotifications(notification.survey_id, req.user.id);

      return res.json(success({ assigned: true, survey_id: notification.survey_id }, 'Survey assigned to you'));
    }

    res.json(success({ assigned: false }, 'Response recorded. Waiting for assignment.'));
  } catch (err) {
    next(err);
  }
};

/**
 * Decline Survey Notification
 * POST /api/v1/surveyor/notifications/:id/decline
 */
const declineNotification = async (req, res, next) => {
  try {
    const { decline_reason } = req.body;

    const result = await db.execute_query(
      `UPDATE surveyor_notifications SET 
        response_status = ?, decline_reason = ?, responded_at = NOW()
       WHERE id = ? AND surveyor_id = ? AND response_status = ?`,
      [NOTIFICATION_RESPONSE.DECLINED, decline_reason || null, req.params.id, req.user.id, NOTIFICATION_RESPONSE.PENDING]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Notification not found or already responded'));
    }

    res.json(success(null, 'Survey declined'));
  } catch (err) {
    next(err);
  }
};

/**
 * Accept Broadcasted Survey
 * POST /api/v1/surveyor/surveys/:id/accept-broadcast
 */
const acceptBroadcast = async (req, res, next) => {
  try {
    const { time_to_start_minutes } = req.body;
    const surveyId = req.params.id;

    // Allow 0 for immediate start, otherwise must be positive
    if (time_to_start_minutes === undefined || time_to_start_minutes === null || time_to_start_minutes < 0) {
      return res.status(400).json(error('Time to start is required (0 = immediately)'));
    }

    // Check Survey Status & Broadcast Window
    const survey = await db.execute_single(
      'SELECT id, status, broadcast_ends_at, latitude, longitude, survey_type FROM surveys WHERE id = ?',
      [surveyId]
    );

    if (!survey) return res.status(404).json(notFound('Survey not found'));

    if (survey.status !== SURVEY_STATUS.LOCATION_DETECTED) {
      // If status is ASSIGNED, it means broadcast ended or early exit triggered
      return res.status(400).json(error('Survey is no longer available'));
    }

    if (new Date() > new Date(survey.broadcast_ends_at)) {
      return res.status(400).json(error('Broadcast window has ended'));
    }

    // v2 §1.4: final gate. This endpoint never checked that the caller was
    // actually notified, so it is the last place an ineligible surveyor could
    // win a case they should not see.
    const categoryCheck = await eligibility.canTakeSurveyType(req.user.id, survey.survey_type);
    if (!categoryCheck.ok) {
      // Top-level `code` — see note in admin.controller.js. `errors` stays
      // reserved for the validation-error array that clients .map() over.
      return res.status(403).json({
        success: false,
        message: `You are not licensed for ${categoryCheck.requiredCategory} cases.`,
        code: 'SURVEYOR_CATEGORY_MISMATCH',
        data: { required_category: categoryCheck.requiredCategory }
      });
    }

    // v2 §2.3: non-Prime employees are not in the open pool. Without this an
    // excluded surveyor who kept a stale survey id could still win the case.
    const employeeCheck = await eligibility.isExcludedFromOpenBroadcast(req.user.id);
    if (employeeCheck.excluded) {
      return res.status(403).json({
        success: false,
        message: employeeCheck.employers?.length
          ? `You receive assignments directly from ${employeeCheck.employers.join(', ')} and cannot accept open survey requests.`
          : 'You receive assignments directly from your company and cannot accept open survey requests.',
        code: 'EMPLOYEE_NOT_IN_OPEN_POOL'
      });
    }

    // Check if already applied
    const existingApp = await db.execute_single(
      'SELECT id FROM survey_applications WHERE survey_id = ? AND surveyor_id = ?',
      [surveyId, req.user.id]
    );

    if (existingApp) {
      return res.status(400).json(error('You have already applied for this survey'));
    }

    // Get Surveyor Location
    const surveyor = await db.execute_single(
      'SELECT current_latitude, current_longitude FROM surveyors WHERE id = ?',
      [req.user.id]
    );

    // Calculate Travel Time
    // TODO: Use Google Matrix API if key available
    let travelTime = 30; // Default fallback
    if (surveyor && surveyor.current_latitude && survey.latitude) {
      const distance = calculateDistance(
        surveyor.current_latitude, surveyor.current_longitude,
        survey.latitude, survey.longitude
      );
      // Assuming 30km/h avg speed in city
      travelTime = Math.ceil((distance / 30) * 60);
    }

    const totalEta = parseInt(time_to_start_minutes) + travelTime;

    // Insert Application
    await db.execute_query(
      `INSERT INTO survey_applications (
        survey_id, surveyor_id, time_to_start_minutes, 
        estimated_travel_time_minutes, total_eta_minutes, status
      ) VALUES (?, ?, ?, ?, ?, 'applied')`,
      [surveyId, req.user.id, time_to_start_minutes, travelTime, totalEta]
    );

    // Update the notification status to accepted
    await db.execute_query(
      `UPDATE surveyor_notifications 
       SET response_status = 'accepted', eta_minutes = ?, responded_at = NOW()
       WHERE survey_id = ? AND surveyor_id = ?`,
      [totalEta, surveyId, req.user.id]
    );

    // Emit socket event to assigner watching this broadcast
    try {
      const io = require('../../config/socket').getIO();
      if (io) {
        // Get surveyor details for the notification
        const surveyorDetails = await db.execute_single(
          'SELECT full_name FROM surveyors WHERE id = ?',
          [req.user.id]
        );
        
        io.to(`broadcast:${surveyId}`).emit('broadcast:surveyor-accepted', {
          survey_id: surveyId,
          surveyor_id: req.user.id,
          surveyor_name: surveyorDetails?.full_name || 'Unknown',
          eta_minutes: totalEta,
          accepted_count: countResult.count,
          timestamp: new Date().toISOString()
        });
        
        console.log(`📡 Broadcast: Surveyor ${req.user.id} accepted survey ${surveyId} (Total: ${countResult.count})`);
      }
    } catch (socketErr) {
      console.warn('Socket emit error:', socketErr.message);
    }

    // Check Application Count
    const countResult = await db.execute_single(
      'SELECT COUNT(*) as count FROM survey_applications WHERE survey_id = ?',
      [surveyId]
    );

    // Get max acceptors config
    const maxConfig = await db.execute_single(
      "SELECT config_value FROM system_config WHERE config_key = 'max_surveyor_acceptors'"
    );
    const maxAcceptors = maxConfig ? parseInt(maxConfig.config_value) : 5;

    // Check against acceptance limit (Early Exit)
    if (countResult.count >= maxAcceptors) {
      console.log(`Survey ${surveyId} reached max acceptors (${countResult.count}). Triggering immediate selection.`);

      // Remove the scheduled job
      try {
        const job = await surveyBroadcastQueue.getJob(`broadcast-${surveyId}`);
        if (job) await job.remove();
      } catch (e) {
        console.warn('Could not remove scheduled job:', e.message);
      }

      // Add immediate selection job
      await surveyBroadcastQueue.add('select-surveyor', { surveyId }, {
        jobId: `broadcast-immediate-${surveyId}`
      });
    }

    res.json(success(null, 'Application submitted successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * List Assigned Surveys
 * GET /api/v1/surveyor/surveys
 */
const listSurveys = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status } = req.query;

    // Get surveyor's current location
    const surveyor = await db.execute_single(
      'SELECT current_latitude, current_longitude FROM surveyors WHERE id = ?',
      [req.user.id]
    );

    let whereClause = 's.surveyor_id = ?';
    const whereParams = [req.user.id];

    if (status) {
      whereClause += ' AND s.status = ?';
      whereParams.push(status);
    }

    const listParams = [...whereParams, limit, offset];

    // Calculate distance from surveyor to survey location using Haversine formula
    let distanceSelect = 'NULL as distance_km';
    if (surveyor && surveyor.current_latitude && surveyor.current_longitude) {
      const surveyorLat = parseFloat(surveyor.current_latitude);
      const surveyorLng = parseFloat(surveyor.current_longitude);
      distanceSelect = `
        CASE 
          WHEN s.latitude IS NOT NULL AND s.longitude IS NOT NULL THEN
            ROUND(6371 * ACOS(
              COS(RADIANS(${surveyorLat})) * COS(RADIANS(s.latitude)) *
              COS(RADIANS(s.longitude) - RADIANS(${surveyorLng})) +
              SIN(RADIANS(${surveyorLat})) * SIN(RADIANS(s.latitude))
            ), 1)
          ELSE NULL
        END as distance_km`;
    }

    const [surveys, countResult] = await Promise.all([
      db.query_rows(
        `SELECT s.*, 
                a.company_name as assigner_company, 
                a.contact_person_name as assigner_contact,
                ${distanceSelect}
         FROM surveys s
         JOIN assigners a ON s.assigner_id = a.id
         WHERE ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        listParams
      ),
      db.query_single(`SELECT COUNT(*) as total FROM surveys s WHERE ${whereClause}`, whereParams)
    ]);

    res.json(paginated(surveys, { page, limit, total: countResult.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Details
 * GET /api/v1/surveyor/surveys/:id
 */
const getSurvey = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      `SELECT s.*, a.company_name as assigner_company, a.phone as assigner_phone,
              a.contact_person_name as assigner_contact
       FROM surveys s
       JOIN assigners a ON s.assigner_id = a.id
       WHERE s.id = ? AND s.surveyor_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Get type-specific details
    let details = null;
    if (survey.survey_type.includes('motor')) {
      details = await db.execute_single('SELECT * FROM motor_survey_details WHERE survey_id = ?', [survey.id]);
    } else if (survey.survey_type.includes('marine')) {
      details = await db.execute_single('SELECT * FROM marine_survey_details WHERE survey_id = ?', [survey.id]);
      if (details) {
        details.invoices = await db.execute_query('SELECT * FROM marine_invoices WHERE marine_survey_id = ?', [details.id]);
        details.gr_entries = await db.execute_query('SELECT * FROM marine_gr_entries WHERE marine_survey_id = ?', [details.id]);
      }
    } else if (survey.survey_type === 'investigation') {
      details = await db.execute_single('SELECT * FROM investigation_survey_details WHERE survey_id = ?', [survey.id]);
    }

    survey.details = details;

    // Get reports
    survey.reports = await db.execute_query(
      'SELECT * FROM survey_reports WHERE survey_id = ? ORDER BY version DESC',
      [survey.id]
    );

    res.json(success(survey));
  } catch (err) {
    next(err);
  }
};

/**
 * Start Transit
 * PUT /api/v1/surveyor/surveys/:id/start-transit
 */
const startTransit = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      'SELECT id, status FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Survey should be in ASSIGNED status to start transit
    if (survey.status !== SURVEY_STATUS.IN_TRANSIT && survey.status !== SURVEY_STATUS.ASSIGNED) {
      return res.status(400).json(error('Cannot start transit in current status'));
    }

    // Update surveyor location if provided
    const { latitude, longitude } = req.body;
    if (latitude && longitude) {
      await db.execute_query(
        'UPDATE surveyors SET current_latitude = ?, current_longitude = ?, location_updated_at = NOW() WHERE id = ?',
        [latitude, longitude, req.user.id]
      );
    }

    // Update survey status to IN_TRANSIT (preserve in_transit_at if already set)
    await db.execute_query(
      'UPDATE surveys SET status = ?, in_transit_at = COALESCE(in_transit_at, NOW()) WHERE id = ?',
      [SURVEY_STATUS.IN_TRANSIT, req.params.id]
    );

    // Get surveyor info and full survey for notification
    const surveyor = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [req.user.id]);
    const fullSurvey = await db.execute_single('SELECT id, assigner_id, laid FROM surveys WHERE id = ?', [req.params.id]);

    // Send push notification to assigner
    if (fullSurvey && surveyor) {
      notificationHelper.notifyAssignerSurveyorInTransit(
        fullSurvey.assigner_id,
        fullSurvey,
        surveyor
      ).catch(err => console.error('Notification error:', err));
    }

    res.json(success(null, 'Transit started'));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Location During Transit
 * POST /api/v1/surveyor/surveys/:id/location-update
 */
const updateTransitLocation = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json(error('Latitude and longitude are required'));
    }

    const survey = await db.execute_single(
      'SELECT id, status, assigner_id FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey || survey.status !== SURVEY_STATUS.IN_TRANSIT) {
      return res.status(400).json(error('Survey not in transit'));
    }

    await db.execute_query(
      'UPDATE surveyors SET current_latitude = ?, current_longitude = ?, location_updated_at = NOW() WHERE id = ?',
      [latitude, longitude, req.user.id]
    );

    // Emit real-time location update via Socket.IO
    const { emitLocationUpdate } = require('../../config/socket');
    emitLocationUpdate(req.params.id, {
      surveyId: req.params.id,
      surveyorId: req.user.id,
      latitude,
      longitude,
    });

    res.json(success(null, 'Location updated'));
  } catch (err) {
    next(err);
  }
};


/**
 * Mark Arrived at Spot
 * PUT /api/v1/surveyor/surveys/:id/arrived
 */
const markArrived = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;

    const survey = await db.execute_single(
      'SELECT id, status, latitude as incident_lat, longitude as incident_lng FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    if (survey.status !== SURVEY_STATUS.IN_TRANSIT) {
      return res.status(400).json(error('Survey is not in transit'));
    }

    // Verify surveyor is at location (within 500 meters)
    if (latitude && longitude && survey.incident_lat && survey.incident_lng) {
      const distance = calculateDistance(latitude, longitude, survey.incident_lat, survey.incident_lng);
      if (distance > 0.5) { // 500 meters
        return res.status(400).json(error(`You are ${Math.round(distance * 1000)}m away from the incident location`));
      }
    }

    await db.execute_query(
      `UPDATE surveys SET surveyor_arrived_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    await db.execute_query(
      'UPDATE surveyors SET current_latitude = ?, current_longitude = ?, location_updated_at = NOW() WHERE id = ?',
      [latitude, longitude, req.user.id]
    );

    // Get surveyor info and full survey for notification
    const surveyor = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [req.user.id]);
    const fullSurvey = await db.execute_single('SELECT id, assigner_id, laid FROM surveys WHERE id = ?', [req.params.id]);

    // Send push notification to assigner
    if (fullSurvey && surveyor) {
      notificationHelper.notifyAssignerSurveyorArrived(
        fullSurvey.assigner_id,
        fullSurvey,
        surveyor
      ).catch(err => console.error('Notification error:', err));
    }

    res.json(success(null, 'Arrived at spot'));
  } catch (err) {
    next(err);
  }
};

/**
 * Upload Presence Selfie
 * POST /api/v1/surveyor/surveys/:id/selfie
 */
const uploadSelfie = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json(error('Selfie image is required'));
    }

    const survey = await db.execute_single(
      'SELECT id, status FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Allow selfie upload from assigned, in_transit, or arrived statuses
    const allowedStatuses = [SURVEY_STATUS.ASSIGNED, SURVEY_STATUS.IN_TRANSIT, SURVEY_STATUS.ARRIVED, SURVEY_STATUS.VISIT_COMPLETED];
    if (!allowedStatuses.includes(survey.status)) {
      return res.status(400).json(error('Cannot upload selfie in current status'));
    }

    const { latitude, longitude, captured_at } = req.body;
    const sessionNumber = parseSessionNumber(req.body.session_number);

    // Use captured_at from frontend for date/time stamp, fallback to NOW()
    const capturedAtValue = captured_at ? new Date(captured_at) : new Date();

    const result = await db.execute_query(
      `INSERT INTO survey_photos (
        survey_id, surveyor_id, photo_type, media_type, source_type, file_url,
        original_size_bytes, photo_latitude, photo_longitude, photo_taken_at, captured_at,
        has_location_badge, has_gallery_watermark, session_number
      ) VALUES (?, ?, 'selfie', 'image', 'camera', ?, ?, ?, ?, NOW(), ?, TRUE, FALSE, ?)`,
      [
        req.params.id, req.user.id, `/uploads/photos/${req.file.filename}`,
        req.file.size, latitude || null, longitude || null, capturedAtValue, sessionNumber
      ]
    );

    emitMediaAdded(req.params.id, { mediaType: 'selfie', sessionNumber, count: 1 });

    res.status(201).json(created({ id: result.insertId, sessionNumber }, 'Selfie uploaded'));
  } catch (err) {
    next(err);
  }
};

/**
 * Upload Survey Photos
 * POST /api/v1/surveyor/surveys/:id/photos
 */
const uploadPhotos = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json(error('At least one photo is required'));
    }

    const survey = await db.execute_single(
      'SELECT id, status FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Allow photo upload from assigned, in_transit, arrived, or visit_completed statuses
    const allowedStatuses = [SURVEY_STATUS.ASSIGNED, SURVEY_STATUS.IN_TRANSIT, SURVEY_STATUS.ARRIVED, SURVEY_STATUS.VISIT_COMPLETED];
    if (!allowedStatuses.includes(survey.status)) {
      return res.status(400).json(error('Cannot upload photos in current status'));
    }

    const { latitude, longitude, photo_type = 'live', caption, source_types, captured_at_times } = req.body;
    const sessionNumber = parseSessionNumber(req.body.session_number);
    const isGallery = photo_type === 'gallery';

    // Parse source_types if provided (JSON array from frontend)
    let sourceTypesArray = [];
    if (source_types) {
      try {
        sourceTypesArray = typeof source_types === 'string' ? JSON.parse(source_types) : source_types;
      } catch (e) {
        console.warn('Failed to parse source_types:', e.message);
      }
    }

    // Parse captured_at_times if provided (JSON array from frontend)
    let capturedAtTimesArray = [];
    if (captured_at_times) {
      try {
        capturedAtTimesArray = typeof captured_at_times === 'string' ? JSON.parse(captured_at_times) : captured_at_times;
      } catch (e) {
        console.warn('Failed to parse captured_at_times:', e.message);
      }
    }

    const insertedIds = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      // Get source type for this photo (default to 'camera' if not provided)
      const sourceType = sourceTypesArray[i] || 'camera';
      // Get captured_at timestamp for this photo
      const capturedAt = capturedAtTimesArray[i] ? new Date(capturedAtTimesArray[i]) : new Date();

      const result = await db.execute_query(
        `INSERT INTO survey_photos (
          survey_id, surveyor_id, photo_type, media_type, source_type, file_url,
          original_size_bytes, photo_latitude, photo_longitude, photo_taken_at, captured_at,
          has_location_badge, has_gallery_watermark, caption, session_number
        ) VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
        [
          req.params.id, req.user.id, photo_type, sourceType, `/uploads/photos/${file.filename}`,
          file.size, latitude || null, longitude || null, capturedAt,
          !isGallery, isGallery, caption || null, sessionNumber
        ]
      );
      insertedIds.push(result.insertId);
    }

    if (insertedIds.length > 0) {
      emitMediaAdded(req.params.id, { mediaType: 'photo', sessionNumber, count: insertedIds.length });
    }

    // Auto-update status to VISIT_COMPLETED (Arrived) if in transit
    if (insertedIds.length > 0 && (survey.status === SURVEY_STATUS.IN_TRANSIT || survey.status === SURVEY_STATUS.ASSIGNED)) {
      await db.execute_query(
        `UPDATE surveys SET status = ?, surveyor_arrived_at = NOW(),
                visit_completed_at = COALESCE(visit_completed_at, NOW()), updated_at = NOW() WHERE id = ?`,
        [SURVEY_STATUS.VISIT_COMPLETED, req.params.id]
      );

      await db.execute_query(
        `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
         VALUES (?, ?, ?, 'surveyor', ?, 'Arrived (First photo uploaded)')`,
        [req.params.id, survey.status, SURVEY_STATUS.VISIT_COMPLETED, req.user.id]
      );

      // Notify assigner that surveyor has arrived
      const surveyor = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [req.user.id]);
      const fullSurvey = await db.execute_single('SELECT id, assigner_id, laid FROM surveys WHERE id = ?', [req.params.id]);

      if (fullSurvey && surveyor) {
        notificationHelper.notifyAssignerSurveyorArrived(
          fullSurvey.assigner_id,
          fullSurvey,
          surveyor
        ).catch(err => console.error('Notification error:', err));
      }
    }

    res.status(201).json(created({ ids: insertedIds, count: insertedIds.length, sessionNumber }, 'Photos uploaded'));
  } catch (err) {
    next(err);
  }
};

/**
 * Upload Survey Videos
 * POST /api/v1/surveyor/surveys/:id/videos
 */
const uploadVideos = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json(error('At least one video is required'));
    }

    const survey = await db.execute_single(
      'SELECT id, status FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Allow video upload from assigned, in_transit, arrived, or visit_completed statuses
    const allowedStatuses = [SURVEY_STATUS.ASSIGNED, SURVEY_STATUS.IN_TRANSIT, SURVEY_STATUS.ARRIVED, SURVEY_STATUS.VISIT_COMPLETED];
    if (!allowedStatuses.includes(survey.status)) {
      return res.status(400).json(error('Cannot upload videos in current status'));
    }

    const { latitude, longitude, caption, source_types, captured_at_times, durations } = req.body;
    const sessionNumber = parseSessionNumber(req.body.session_number);

    // Parse source_types if provided (JSON array from frontend)
    let sourceTypesArray = [];
    if (source_types) {
      try {
        sourceTypesArray = typeof source_types === 'string' ? JSON.parse(source_types) : source_types;
      } catch (e) {
        console.warn('Failed to parse source_types:', e.message);
      }
    }

    // Parse captured_at_times if provided (JSON array from frontend)
    let capturedAtTimesArray = [];
    if (captured_at_times) {
      try {
        capturedAtTimesArray = typeof captured_at_times === 'string' ? JSON.parse(captured_at_times) : captured_at_times;
      } catch (e) {
        console.warn('Failed to parse captured_at_times:', e.message);
      }
    }

    // Parse durations if provided (JSON array from frontend)
    let durationsArray = [];
    if (durations) {
      try {
        durationsArray = typeof durations === 'string' ? JSON.parse(durations) : durations;
      } catch (e) {
        console.warn('Failed to parse durations:', e.message);
      }
    }

    const insertedIds = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      // Get source type for this video (default to 'camera' if not provided)
      const sourceType = sourceTypesArray[i] || 'camera';
      // Get captured_at timestamp for this video
      const capturedAt = capturedAtTimesArray[i] ? new Date(capturedAtTimesArray[i]) : new Date();
      // Get duration for this video
      const duration = durationsArray[i] || 0;

      const isFromGallery = sourceType === 'gallery';

      const result = await db.execute_query(
        `INSERT INTO survey_photos (
          survey_id, surveyor_id, photo_type, media_type, source_type, file_url,
          original_size_bytes, photo_latitude, photo_longitude, photo_taken_at, captured_at,
          video_duration_seconds, has_location_badge, has_gallery_watermark, caption, session_number
        ) VALUES (?, ?, 'live', 'video', ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id, req.user.id, sourceType, `/uploads/videos/${file.filename}`,
          file.size, latitude || null, longitude || null, capturedAt,
          duration, !isFromGallery, isFromGallery, caption || null, sessionNumber
        ]
      );
      insertedIds.push(result.insertId);
    }

    if (insertedIds.length > 0) {
      emitMediaAdded(req.params.id, { mediaType: 'video', sessionNumber, count: insertedIds.length });
    }

    // Auto-update status to VISIT_COMPLETED (Arrived) if in transit
    if (insertedIds.length > 0 && (survey.status === SURVEY_STATUS.IN_TRANSIT || survey.status === SURVEY_STATUS.ASSIGNED)) {
      await db.execute_query(
        `UPDATE surveys SET status = ?, surveyor_arrived_at = NOW(),
                visit_completed_at = COALESCE(visit_completed_at, NOW()), updated_at = NOW() WHERE id = ?`,
        [SURVEY_STATUS.VISIT_COMPLETED, req.params.id]
      );

      await db.execute_query(
        `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
         VALUES (?, ?, ?, 'surveyor', ?, 'Arrived (First video uploaded)')`,
        [req.params.id, survey.status, SURVEY_STATUS.VISIT_COMPLETED, req.user.id]
      );

      // Notify assigner that surveyor has arrived
      const surveyor = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [req.user.id]);
      const fullSurvey = await db.execute_single('SELECT id, assigner_id, laid FROM surveys WHERE id = ?', [req.params.id]);

      if (fullSurvey && surveyor) {
        notificationHelper.notifyAssignerSurveyorArrived(
          fullSurvey.assigner_id,
          fullSurvey,
          surveyor
        ).catch(err => console.error('Notification error:', err));
      }
    }

    res.status(201).json(created({ ids: insertedIds, count: insertedIds.length, sessionNumber }, 'Videos uploaded'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Photos (includes both images and videos)
 * GET /api/v1/surveyor/surveys/:id/photos
 */
const getSurveyPhotos = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    const photos = await db.execute_query(
      'SELECT * FROM survey_photos WHERE survey_id = ? ORDER BY session_number ASC, captured_at ASC, id ASC',
      [req.params.id]
    );

    res.json(success(photos));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Videos
 * GET /api/v1/surveyor/surveys/:id/videos
 */
const getSurveyVideos = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    const videos = await db.execute_query(
      "SELECT * FROM survey_photos WHERE survey_id = ? AND media_type = 'video' ORDER BY session_number ASC, captured_at ASC, id ASC",
      [req.params.id]
    );

    res.json(success(videos));
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Photo
 * DELETE /api/v1/surveyor/surveys/:id/photos/:photoId
 */
const deletePhoto = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      `DELETE FROM survey_photos WHERE id = ? AND survey_id = ? AND surveyor_id = ?`,
      [req.params.photoId, req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Photo not found'));
    }

    res.json(success(null, 'Photo deleted'));
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Video
 * DELETE /api/v1/surveyor/surveys/:id/videos/:videoId
 */
const deleteVideo = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      `DELETE FROM survey_photos WHERE id = ? AND survey_id = ? AND surveyor_id = ? AND media_type = 'video'`,
      [req.params.videoId, req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Video not found'));
    }

    res.json(success(null, 'Video deleted'));
  } catch (err) {
    next(err);
  }
};

/**
 * Upload Survey Document
 * POST /api/v1/surveyor/surveys/:id/documents
 */
const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json(error('Document file is required'));
    }

    const { document_type = 'others' } = req.body;

    const survey = await db.execute_single(
      'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    const result = await db.execute_query(
      `INSERT INTO survey_documents (
        survey_id, uploaded_by_type, uploaded_by_id, document_type,
        original_file_name, file_url, file_type, original_size_bytes
      ) VALUES (?, 'surveyor', ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id, req.user.id, document_type,
        req.file.originalname, `/uploads/documents/${req.file.filename}`,
        req.file.mimetype.split('/')[1], req.file.size
      ]
    );

    res.status(201).json(created({ id: result.insertId }, 'Document uploaded'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Documents
 * GET /api/v1/surveyor/surveys/:id/documents
 * Returns all documents (both assigner and surveyor uploaded)
 */
const getSurveyDocuments = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    const documents = await db.execute_query(
      'SELECT * FROM survey_documents WHERE survey_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json(success(documents));
  } catch (err) {
    next(err);
  }
};

/**
 * Mark Visit Completed
 * PUT /api/v1/surveyor/surveys/:id/complete-visit
 */
const completeVisit = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      'SELECT id, status FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // If already visit_completed, return success (idempotent)
    if (survey.status === SURVEY_STATUS.VISIT_COMPLETED) {
      return res.json(success(null, 'Visit already completed. Please submit report.'));
    }

    // Allow complete visit from ASSIGNED or IN_TRANSIT status
    const allowedStatuses = [SURVEY_STATUS.ASSIGNED, SURVEY_STATUS.IN_TRANSIT];
    if (!allowedStatuses.includes(survey.status)) {
      return res.status(400).json(error(`Cannot complete visit when survey is in '${survey.status}' status`));
    }

    // Check if selfie and at least one photo uploaded
    const photoCount = await db.execute_single(
      'SELECT COUNT(*) as count FROM survey_photos WHERE survey_id = ?',
      [req.params.id]
    );

    if (photoCount.count < 2) {
      return res.status(400).json(error('Upload selfie and at least one survey photo'));
    }

    await db.execute_query(
      `UPDATE surveys SET status = ?, surveyor_arrived_at = COALESCE(surveyor_arrived_at, NOW()),
              visit_completed_at = COALESCE(visit_completed_at, NOW()), updated_at = NOW() WHERE id = ?`,
      [SURVEY_STATUS.VISIT_COMPLETED, req.params.id]
    );

    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, ?, ?, 'surveyor', ?, 'Visit completed, preparing report')`,
      [req.params.id, survey.status, SURVEY_STATUS.VISIT_COMPLETED, req.user.id]
    );

    res.json(success(null, 'Visit completed. Please submit report.'));
  } catch (err) {
    next(err);
  }
};

/**
 * Submit Final Report
 * POST /api/v1/surveyor/surveys/:id/reports
 */
const submitReport = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json(error('Report PDF is required'));
    }

    const { surveyor_notes } = req.body;

    const survey = await db.execute_single(
      'SELECT id, status FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    if (survey.status !== SURVEY_STATUS.VISIT_COMPLETED &&
      survey.status !== SURVEY_STATUS.NOT_RESOLVED &&
      survey.status !== SURVEY_STATUS.REPORT_SUBMITTED) {
      return res.status(400).json(error('Cannot submit report in current status'));
    }

    // Get current report version
    const lastReport = await db.execute_single(
      'SELECT MAX(version) as max_version FROM survey_reports WHERE survey_id = ?',
      [req.params.id]
    );
    const newVersion = (lastReport?.max_version || 0) + 1;

    const result = await db.execute_query(
      `INSERT INTO survey_reports (
        survey_id, surveyor_id, version, report_file_url, file_size_bytes,
        status, surveyor_notes
      ) VALUES (?, ?, ?, ?, ?, 'submitted', ?)`,
      [
        req.params.id, req.user.id, newVersion,
        `/uploads/reports/${req.file.filename}`, req.file.size,
        surveyor_notes || null
      ]
    );

    // Update survey status
    await db.execute_query(
      // COALESCE: the milestone is the FIRST submission — a v2 resubmission must not move it.
      `UPDATE surveys SET status = ?, report_submitted_at = COALESCE(report_submitted_at, NOW()),
              updated_at = NOW() WHERE id = ?`,
      [SURVEY_STATUS.REPORT_SUBMITTED, req.params.id]
    );

    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, ?, ?, 'surveyor', ?, ?)`,
      [req.params.id, survey.status, SURVEY_STATUS.REPORT_SUBMITTED, req.user.id, `Report v${newVersion} submitted`]
    );

    // Get surveyor info and full survey for notification
    const surveyor = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [req.user.id]);
    const fullSurvey = await db.execute_single('SELECT id, assigner_id, laid FROM surveys WHERE id = ?', [req.params.id]);

    // Send push notification to assigner
    if (fullSurvey && surveyor) {
      notificationHelper.notifyAssignerReportSubmitted(
        fullSurvey.assigner_id,
        fullSurvey,
        surveyor
      ).catch(err => console.error('Notification error:', err));
    }

    res.status(201).json(created({
      id: result.insertId,
      version: newVersion
    }, 'Report submitted successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Notes (per session)
 * PUT /api/v1/surveyor/surveys/:id/notes
 *
 * Body: { notes, session_number }
 * Notes are stored per session in survey_session_notes so re-visits don't
 * overwrite the original visit's remarks. Session number defaults to 1.
 */
const updateNotes = async (req, res, next) => {
  try {
    const { notes } = req.body;
    const sessionNumber = parseSessionNumber(req.body.session_number);

    // Confirm the surveyor owns this survey before writing.
    const survey = await db.execute_single(
      'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );
    if (!survey) return res.status(404).json(notFound('Survey not found'));

    await db.execute_query(
      `INSERT INTO survey_session_notes (survey_id, surveyor_id, session_number, notes)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP`,
      [req.params.id, req.user.id, sessionNumber, notes ?? null]
    );

    emitNotesUpdated(req.params.id, { sessionNumber });

    res.json(success({ sessionNumber }, 'Notes updated'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Per-Session Notes
 * GET /api/v1/surveyor/surveys/:id/notes
 */
const getSessionNotes = async (req, res, next) => {
  try {
    // Confirm the requesting surveyor owns this survey before returning notes.
    const survey = await db.execute_single(
      'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
      [req.params.id, req.user.id]
    );
    if (!survey) return res.status(404).json(notFound('Survey not found'));

    const rows = await db.execute_query(
      `SELECT session_number, notes, created_at, updated_at
       FROM survey_session_notes
       WHERE survey_id = ?
       ORDER BY session_number ASC`,
      [req.params.id]
    );
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Available Broadcasts (New Survey Requests)
 * GET /api/v1/surveyor/available-surveys
 * Returns surveys in LOCATION_DETECTED status that are still within broadcast window
 */
const getAvailableBroadcasts = async (req, res, next) => {
  try {
    // v2 §2.3: a non-Prime employee is not in the open pool at all. This does not
    // depend on location, so it runs BEFORE the location guard — otherwise a
    // surveyor with no stored location (the norm on web) gets a bare 400 and
    // never learns why they have no open requests.
    const employeeCheck = await eligibility.isExcludedFromOpenBroadcast(req.user.id);
    if (employeeCheck.excluded) {
      return res.json(success([], employeeCheck.employers?.length
        ? `Open survey requests are not shown because you work for ${employeeCheck.employers.join(', ')}. You receive assignments directly from them.`
        : 'Open survey requests are not shown for company surveyors. You receive assignments directly from your company.'));
    }

    // Get surveyor's current location
    const surveyor = await db.execute_single(
      'SELECT current_latitude, current_longitude FROM surveyors WHERE id = ?',
      [req.user.id]
    );

    if (!surveyor || !surveyor.current_latitude || !surveyor.current_longitude) {
      return res.status(400).json(error('Please update your location first'));
    }

    // Get config for max broadcast radius to determine visibility
    const configs = await db.query_rows("SELECT config_key, config_value FROM system_config WHERE config_key IN ('broadcast_stage_1_km', 'broadcast_stage_2_km', 'broadcast_stage_3_km')");
    const configMap = configs.reduce((acc, row) => ({ ...acc, [row.config_key]: row.config_value }), {});

    let maxRadius = 0;
    if (configMap.broadcast_stage_1_km) maxRadius = Math.max(maxRadius, parseFloat(configMap.broadcast_stage_1_km));
    if (configMap.broadcast_stage_2_km) maxRadius = Math.max(maxRadius, parseFloat(configMap.broadcast_stage_2_km));
    if (configMap.broadcast_stage_3_km) maxRadius = Math.max(maxRadius, parseFloat(configMap.broadcast_stage_3_km));

    // Default fallback if no stages defined
    const radiusKm = maxRadius > 0 ? maxRadius : 15;

    const surveyorLat = parseFloat(surveyor.current_latitude);
    const surveyorLng = parseFloat(surveyor.current_longitude);

    // Fetch broadcasts:
    // - status = location_detected
    // - broadcast_ends_at > NOW()
    // - within radius
    // - surveyor has NOT already applied
    // NOTE: this selected `s.contact_phone` — a column that does not exist — so
    // the endpoint threw on every call. The real column is `contact_person_mobile`.
    //
    // v2 §1.4: this is the pull path. Filtering only the broadcast fan-out would
    // exclude nobody, because any verified surveyor could still discover and win
    // a case here. The category rule is applied per-survey against the caller's
    // own grants, mirroring eligibility.categoryClause() on the push side.
    const surveys = await db.query_rows(
      `SELECT s.id, s.laid, s.survey_type, s.case_reference,
              s.contact_person_name, s.contact_person_mobile, s.city, s.state,
              s.latitude, s.longitude, s.broadcast_ends_at,
              s.created_at,
              ROUND(6371 * ACOS(
                COS(RADIANS(?)) * COS(RADIANS(s.latitude)) *
                COS(RADIANS(s.longitude) - RADIANS(?)) +
                SIN(RADIANS(?)) * SIN(RADIANS(s.latitude))
              ), 1) AS distance_km
       FROM surveys s
       WHERE s.status = 'location_detected'
         AND s.broadcast_ends_at > NOW()
         AND s.latitude IS NOT NULL
         AND s.longitude IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM survey_applications sa
           WHERE sa.survey_id = s.id AND sa.surveyor_id = ?
         )
         AND (
           s.survey_type NOT IN ('motor_spot','motor_final','marine_final','marine_cargo_investigation')
           OR EXISTS (
             SELECT 1 FROM surveyor_categories sc
              WHERE sc.surveyor_id = ?
                AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
                AND sc.category = CASE
                      WHEN s.survey_type LIKE 'motor%'  THEN 'motor'
                      WHEN s.survey_type LIKE 'marine%' THEN 'marine'
                    END
           )
         )
       HAVING distance_km <= ?
       ORDER BY distance_km ASC
       LIMIT 20`,
      [surveyorLat, surveyorLng, surveyorLat, req.user.id, req.user.id, radiusKm]
    );

    // Calculate remaining time for each survey
    const now = new Date();
    const result = surveys.map(s => ({
      ...s,
      remaining_seconds: Math.max(0, Math.floor((new Date(s.broadcast_ends_at) - now) / 1000))
    }));

    res.json(success(result));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getNotifications,
  acceptNotification,
  acceptBroadcast,
  declineNotification,
  listSurveys,
  getSurvey,
  startTransit,
  updateTransitLocation,
  markArrived,
  uploadSelfie,
  uploadPhotos,
  uploadVideos,
  getSurveyPhotos,
  getSurveyVideos,
  deletePhoto,
  deleteVideo,
  uploadDocument,
  getSurveyDocuments,
  completeVisit,
  submitReport,
  updateNotes,
  getSessionNotes,
  getAvailableBroadcasts
};
