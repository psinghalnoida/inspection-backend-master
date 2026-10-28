/**
 * Admin Controller - Admin Profile & User Management
 */

const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const { success, error, created, notFound, paginated } = require('../../utils/response');
const { parsePagination } = require('../../utils/helpers');

/**
 * Get Admin Profile
 * GET /api/v1/admin/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const admin = await db.execute_single(
      `SELECT id, full_name, email, phone, profile_picture_url, 
              is_super_admin, is_active, last_login_at, created_at
       FROM admins WHERE id = ?`,
      [req.user.id]
    );

    if (!admin) {
      return res.status(404).json(notFound('Admin not found'));
    }

    res.json(success(admin));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Admin Profile
 * PUT /api/v1/admin/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { full_name, phone } = req.body;
    const updates = [];
    const params = [];

    if (full_name) {
      updates.push('full_name = ?');
      params.push(full_name);
    }
    if (phone) {
      updates.push('phone = ?');
      params.push(phone);
    }

    if (updates.length === 0) {
      return res.status(400).json(error('No fields to update'));
    }

    params.push(req.user.id);

    await db.execute_query(
      `UPDATE admins SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    res.json(success(null, 'Profile updated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Change Password
 * PUT /api/v1/admin/change-password
 */
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json(error('Current and new password are required'));
    }

    const admin = await db.execute_single(
      'SELECT password_hash FROM admins WHERE id = ?',
      [req.user.id]
    );

    const isMatch = await bcrypt.compare(current_password, admin.password_hash);
    if (!isMatch) {
      return res.status(400).json(error('Current password is incorrect'));
    }

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const password_hash = await bcrypt.hash(new_password, saltRounds);

    await db.execute_query(
      'UPDATE admins SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [password_hash, req.user.id]
    );

    res.json(success(null, 'Password changed successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Create New Admin (Super Admin Only)
 * POST /api/v1/admin/admins
 */
const createAdmin = async (req, res, next) => {
  try {
    // Check if requester is super admin
    const requester = await db.execute_single(
      'SELECT is_super_admin FROM admins WHERE id = ?',
      [req.user.id]
    );

    if (!requester.is_super_admin) {
      return res.status(403).json(error('Only super admin can create new admins'));
    }

    const { full_name, email, phone, password, is_super_admin = false } = req.body;

    if (!full_name || !email || !phone || !password) {
      return res.status(400).json(error('All fields are required'));
    }

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const result = await db.execute_query(
      `INSERT INTO admins (full_name, email, phone, password_hash, is_super_admin, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [full_name, email, phone, password_hash, is_super_admin]
    );

    res.status(201).json(created({ id: result.insertId }, 'Admin created successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * List All Admins
 * GET /api/v1/admin/admins
 */
const listAdmins = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const [admins, countResult] = await Promise.all([
      db.query_rows(
        `SELECT id, full_name, email, phone, is_super_admin, is_active, 
                last_login_at, created_at
         FROM admins
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      db.query_single('SELECT COUNT(*) as total FROM admins', [])
    ]);

    res.json(paginated(admins, { page, limit, total: countResult.total }));
  } catch (err) {
    next(err);
  }
};

// ================== ASSIGNER MANAGEMENT ==================

/**
 * Create Assigner (Admin adds assigners)
 * POST /api/v1/admin/assigners
 */
const createAssigner = async (req, res, next) => {
  try {
    const {
      phone, email, password, company_name, gst_number, contact_person_name,
      latitude, longitude, address, city, state, pincode, is_direct_assign,
      // v2 §4.2 — captured at creation so a refund is possible without a
      // follow-up edit. All optional.
      bank_account_number_encrypted, bank_ifsc_code, bank_account_holder_name, bank_name
    } = req.body;

    if (!phone || !email || !password) {
      return res.status(400).json(error('Phone, email and PIN are required'));
    }

    if (!/^\d{4}$/.test(password)) {
      return res.status(400).json(error('PIN must be exactly 4 digits'));
    }

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // is_direct_assign defaults to true if not provided
    const directAssign = is_direct_assign === false || is_direct_assign === 'false' ? false : true;

    const result = await db.execute_query(
      `INSERT INTO assigners (
        phone, email, password_hash, company_name, gst_number, contact_person_name,
        latitude, longitude, address, city, state, pincode,
        bank_account_number_encrypted, bank_ifsc_code, bank_account_holder_name, bank_name,
        is_active, is_direct_assign, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?)`,
      [
        phone, email, password_hash, company_name || null, gst_number || null, contact_person_name || null,
        latitude || null, longitude || null, address || null,
        city || null, state || null, pincode || null,
        bank_account_number_encrypted || null, bank_ifsc_code || null,
        bank_account_holder_name || null, bank_name || null,
        directAssign, req.user.id
      ]
    );

    res.status(201).json(created({ id: result.insertId }, 'Assigner created successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * List All Assigners
 * GET /api/v1/admin/assigners
 */
const listAssigners = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, search } = req.query;

    let whereClause = '1=1';
    const whereParams = [];

    if (status === 'active') {
      whereClause += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
      whereClause += ' AND is_active = FALSE';
    }

    if (search) {
      whereClause += ' AND (phone LIKE ? OR email LIKE ? OR company_name LIKE ?)';
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Build params for list query (where params + limit + offset)
    const listParams = [...whereParams, limit, offset];

    const [assigners, countResult] = await Promise.all([
      db.query_rows(
        `SELECT a.id, a.phone, a.email, a.company_name, a.contact_person_name,
                a.city, a.state, a.is_active, a.created_at,
                COALESCE(s.survey_count, 0) as survey_count
         FROM assigners a
         LEFT JOIN (
           SELECT assigner_id, COUNT(*) as survey_count 
           FROM surveys 
           GROUP BY assigner_id
         ) s ON a.id = s.assigner_id
         WHERE ${whereClause.replace(/is_active/g, 'a.is_active').replace(/phone/g, 'a.phone').replace(/email/g, 'a.email').replace(/company_name/g, 'a.company_name')}
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
        listParams
      ),
      db.query_single(
        `SELECT COUNT(*) as total FROM assigners WHERE ${whereClause}`,
        whereParams.length > 0 ? whereParams : []
      )
    ]);

    res.json(paginated(assigners, { page, limit, total: countResult.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Assigner Details
 * GET /api/v1/admin/assigners/:id
 */
const getAssigner = async (req, res, next) => {
  try {
    const assigner = await db.execute_single(
      `SELECT * FROM assigners WHERE id = ?`,
      [req.params.id]
    );

    if (!assigner) {
      return res.status(404).json(notFound('Assigner not found'));
    }

    // Remove sensitive data
    delete assigner.password_hash;

    res.json(success(assigner));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Assigner
 * PUT /api/v1/admin/assigners/:id
 */
const updateAssigner = async (req, res, next) => {
  try {
    const {
      company_name, contact_person_name, email, gst_number, address, city, state, pincode,
      is_direct_assign,
      // v2 §4.2 — needed to refund an admin-owes-assigner balance.
      bank_account_number_encrypted, bank_ifsc_code, bank_account_holder_name, bank_name
    } = req.body;

    const updates = [];
    const params = [];

    if (company_name !== undefined) { updates.push('company_name = ?'); params.push(company_name); }
    if (contact_person_name !== undefined) { updates.push('contact_person_name = ?'); params.push(contact_person_name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (gst_number !== undefined) { updates.push('gst_number = ?'); params.push(gst_number); }
    if (address !== undefined) { updates.push('address = ?'); params.push(address); }
    if (city !== undefined) { updates.push('city = ?'); params.push(city); }
    if (state !== undefined) { updates.push('state = ?'); params.push(state); }
    if (pincode !== undefined) { updates.push('pincode = ?'); params.push(pincode); }
    if (is_direct_assign !== undefined) { updates.push('is_direct_assign = ?'); params.push(is_direct_assign ? 1 : 0); }
    if (bank_account_number_encrypted !== undefined) { updates.push('bank_account_number_encrypted = ?'); params.push(bank_account_number_encrypted); }
    if (bank_ifsc_code !== undefined) { updates.push('bank_ifsc_code = ?'); params.push(bank_ifsc_code); }
    if (bank_account_holder_name !== undefined) { updates.push('bank_account_holder_name = ?'); params.push(bank_account_holder_name); }
    if (bank_name !== undefined) { updates.push('bank_name = ?'); params.push(bank_name); }

    if (updates.length === 0) {
      return res.status(400).json(error('No fields to update'));
    }

    params.push(req.params.id);

    const result = await db.execute_query(
      `UPDATE assigners SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Assigner not found'));
    }

    res.json(success(null, 'Assigner updated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Activate Assigner
 * PUT /api/v1/admin/assigners/:id/activate
 */
const activateAssigner = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      `UPDATE assigners SET is_active = TRUE, activated_by = ?, activated_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [req.user.id, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Assigner not found'));
    }

    res.json(success(null, 'Assigner activated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Deactivate Assigner
 * PUT /api/v1/admin/assigners/:id/deactivate
 */
const deactivateAssigner = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      `UPDATE assigners SET is_active = FALSE, updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Assigner not found'));
    }

    res.json(success(null, 'Assigner deactivated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Assigner
 * DELETE /api/v1/admin/assigners/:id
 */
const deleteAssigner = async (req, res, next) => {
  try {
    // Check if assigner has any surveys
    const surveysCount = await db.execute_single(
      'SELECT COUNT(*) as count FROM surveys WHERE assigner_id = ?',
      [req.params.id]
    );

    if (surveysCount && surveysCount.count > 0) {
      return res.status(400).json(error(`Cannot delete assigner. They have ${surveysCount.count} associated survey(s). Please reassign or delete those surveys first.`));
    }

    const result = await db.execute_query(
      'DELETE FROM assigners WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Assigner not found'));
    }

    res.json(success(null, 'Assigner deleted successfully'));
  } catch (err) {
    next(err);
  }
};

// ================== SURVEY MANAGEMENT ==================

/**
 * List All Surveys (Admin view)
 * GET /api/v1/admin/surveys
 */
const listSurveys = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, survey_type, search, assigner_id, surveyor_id, archived } = req.query;

    let whereClause = '1=1';
    const whereParams = [];

    // Archive view: default lists active (non-archived) surveys; archived=true shows
    // the archive; archived=all bypasses the filter (used for all-time KPIs).
    if (archived === 'true' || archived === '1') {
      whereClause += ' AND s.is_archived = 1';
    } else if (archived !== 'all') {
      whereClause += ' AND s.is_archived = 0';
    }

    if (status) {
      whereClause += ' AND s.status = ?';
      whereParams.push(status);
    }

    if (survey_type) {
      whereClause += ' AND s.survey_type = ?';
      whereParams.push(survey_type);
    }

    if (assigner_id) {
      whereClause += ' AND s.assigner_id = ?';
      whereParams.push(assigner_id);
    }

    if (surveyor_id) {
      whereClause += ' AND s.surveyor_id = ?';
      whereParams.push(surveyor_id);
    }

    if (search) {
      whereClause += ' AND (s.laid LIKE ? OR s.case_reference LIKE ? OR a.company_name LIKE ?)';
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const listParams = [...whereParams, limit, offset];

    const [surveys, countResult] = await Promise.all([
      db.query_rows(
        `SELECT s.id, s.laid, s.survey_type, s.status, s.is_emergency,
                s.is_archived, s.archived_at,
                s.contact_person_name, s.contact_person_mobile,
                s.case_reference, s.city, s.state, s.created_at,
                a.company_name as assigner_name,
                sv.full_name as surveyor_name
         FROM surveys s
         LEFT JOIN assigners a ON s.assigner_id = a.id
         LEFT JOIN surveyors sv ON s.surveyor_id = sv.id
         WHERE ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        listParams
      ),
      db.query_single(
        `SELECT COUNT(*) as total FROM surveys s 
         LEFT JOIN assigners a ON s.assigner_id = a.id 
         WHERE ${whereClause}`,
        whereParams
      )
    ]);

    res.json(paginated(surveys, { page, limit, total: countResult.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Details (Admin view)
 * GET /api/v1/admin/surveys/:id
 */
const getSurvey = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      `SELECT s.*, 
              a.company_name as assigner_name, a.phone as assigner_phone,
              sv.full_name as surveyor_name, sv.phone as surveyor_phone,
              sv.profile_picture_url as surveyor_picture
       FROM surveys s
       LEFT JOIN assigners a ON s.assigner_id = a.id
       LEFT JOIN surveyors sv ON s.surveyor_id = sv.id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Backfill Survey Coordinates if missing and address available (Copied from Assigner Controller)
    if ((!survey.latitude || !survey.longitude) && (survey.address || survey.city || survey.pincode)) {
      const { geocodeAddress } = require('../../utils/helpers'); // Ensure this is imported or available
      console.log('🌍 Survey location missing in detail view (Admin), attempting backfill...');
      const addressParts = [
        survey.address,
        survey.city,
        survey.state,
        survey.pincode
      ].filter(Boolean);

      if (addressParts.length > 0) {
        const coords = await geocodeAddress(addressParts.join(', '));
        if (coords) {
          console.log('📍 Backfilled survey location:', coords);
          survey.latitude = coords.latitude;
          survey.longitude = coords.longitude;
          // Update DB
          await db.execute_query('UPDATE surveys SET latitude = ?, longitude = ? WHERE id = ?', [coords.latitude, coords.longitude, survey.id]);
        }
      }
    }

    // Get type-specific details
    if (survey.survey_type.includes('motor')) {
      survey.details = await db.execute_single(
        'SELECT * FROM motor_survey_details WHERE survey_id = ?',
        [survey.id]
      );
    } else if (survey.survey_type.includes('marine')) {
      survey.details = await db.execute_single(
        'SELECT * FROM marine_survey_details WHERE survey_id = ?',
        [survey.id]
      );
      if (survey.details) {
        survey.details.invoices = await db.query_rows(
          'SELECT * FROM marine_invoices WHERE marine_survey_id = ?',
          [survey.details.id]
        );
        survey.details.gr_entries = await db.query_rows(
          'SELECT * FROM marine_gr_entries WHERE marine_survey_id = ?',
          [survey.details.id]
        );
      }
    } else if (survey.survey_type === 'investigation') {
      survey.details = await db.execute_single(
        'SELECT * FROM investigation_survey_details WHERE survey_id = ?',
        [survey.id]
      );
    }

    // Get documents
    survey.documents = await db.query_rows(
      'SELECT * FROM survey_documents WHERE survey_id = ? ORDER BY created_at DESC',
      [survey.id]
    );

    // Get surveyor photos (selfies, vehicle photos, etc.) — chronological per session
    survey.photos = await db.query_rows(
      'SELECT * FROM survey_photos WHERE survey_id = ? ORDER BY session_number ASC, captured_at ASC, id ASC',
      [survey.id]
    );

    // Per-session surveyor remarks
    survey.session_notes = await db.query_rows(
      `SELECT session_number, notes, created_at, updated_at
       FROM survey_session_notes
       WHERE survey_id = ?
       ORDER BY session_number ASC`,
      [survey.id]
    );

    // Get submitted reports
    survey.reports = await db.query_rows(
      'SELECT * FROM survey_reports WHERE survey_id = ? ORDER BY created_at DESC',
      [survey.id]
    );

    // Get payment info
    survey.payment = await db.execute_single(
      'SELECT * FROM payments WHERE survey_id = ? ORDER BY created_at DESC LIMIT 1',
      [survey.id]
    );

    // Get surveyor payout info if payment exists
    if (survey.payment) {
      survey.payout = await db.execute_single(
        'SELECT * FROM surveyor_payouts WHERE survey_id = ? ORDER BY created_at DESC LIMIT 1',
        [survey.id]
      );
    }

    res.json(success(survey));
  } catch (err) {
    next(err);
  }
};

/**
 * List Available Surveyors (for assignment dropdown)
 * GET /api/v1/admin/surveyors/available
 */
const listAvailableSurveyors = async (req, res, next) => {
  try {
    const { survey_id } = req.query;

    let distanceSelect = '';
    let orderBy = 'sv.full_name ASC';

    // If survey_id provided, calculate distance from survey location
    if (survey_id) {
      const survey = await db.execute_single(
        'SELECT latitude, longitude FROM surveys WHERE id = ?',
        [survey_id]
      );

      if (survey && survey.latitude && survey.longitude) {
        distanceSelect = `,
          ROUND(6371 * ACOS(
            COS(RADIANS(${survey.latitude})) * COS(RADIANS(sv.current_latitude)) *
            COS(RADIANS(sv.current_longitude) - RADIANS(${survey.longitude})) +
            SIN(RADIANS(${survey.latitude})) * SIN(RADIANS(sv.current_latitude))
          ), 1) as distance_km`;
        orderBy = 'distance_km ASC';
      }
    }

    const surveyors = await db.query_rows(
      `SELECT sv.id, sv.full_name, sv.phone, sv.email, sv.city, sv.state,
              sv.is_available, sv.verification_status, sv.profile_picture_url,
              sv.current_latitude, sv.current_longitude
              ${distanceSelect}
       FROM surveyors sv
       WHERE sv.is_active = TRUE AND sv.verification_status = 'verified'
       ORDER BY ${orderBy}
       LIMIT 50`
    );

    res.json(success(surveyors));
  } catch (err) {
    next(err);
  }
};

/**
 * Assign Surveyor to Survey (Admin manual assignment)
 * PUT /api/v1/admin/surveys/:id/assign
 */
const assignSurveyorToSurvey = async (req, res, next) => {
  try {
    const { surveyor_id } = req.body;
    const surveyId = req.params.id;

    if (!surveyor_id) {
      return res.status(400).json(error('Surveyor ID is required'));
    }

    // Verify survey exists and is in assignable status
    const survey = await db.execute_single(
      'SELECT id, status, surveyor_id, survey_type FROM surveys WHERE id = ?',
      [surveyId]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Allow assignment if survey is pending, location_detected, or even re-assignment
    const assignableStatuses = ['pending', 'location_detected', 'assigned'];
    if (!assignableStatuses.includes(survey.status)) {
      return res.status(400).json(error(`Cannot assign surveyor when survey is in '${survey.status}' status`));
    }

    // Verify surveyor exists and is active/verified
    const surveyor = await db.execute_single(
      'SELECT id, full_name, is_active, verification_status FROM surveyors WHERE id = ?',
      [surveyor_id]
    );

    if (!surveyor) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    if (!surveyor.is_active) {
      return res.status(400).json(error('Surveyor is not active'));
    }

    if (surveyor.verification_status !== 'verified') {
      return res.status(400).json(error('Surveyor is not verified'));
    }

    // v2 §1.4 (revised): the category rule gates BROADCAST only. A manual/direct
    // assignment is a deliberate trust decision, so admin may assign any verified
    // surveyor regardless of category. No category check here on purpose.

    const previousStatus = survey.status;

    // Update survey with assigned surveyor
    await db.execute_query(
      `UPDATE surveys SET 
        surveyor_id = ?,
        status = 'assigned',
        surveyor_assigned_at = NOW(),
        updated_at = NOW()
       WHERE id = ?`,
      [surveyor_id, surveyId]
    );

    // Log status change
    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, ?, 'assigned', 'admin', ?, ?)`,
      [surveyId, previousStatus, req.user.id, `Admin assigned surveyor: ${surveyor.full_name}`]
    );

    // Close the broadcast for everyone else: expire pending notifications, clear
    // the general broadcast_request, and drop the request card in real time.
    const broadcastService = require('../../services/broadcast.service');
    await broadcastService.closeBroadcastNotifications(surveyId, surveyor_id);

    // Get full survey and assigner details for notifications
    const notificationHelper = require('../../services/notification.helper');
    const fullSurvey = await db.execute_single(
      'SELECT id, laid, assigner_id, surveyor_eta_minutes FROM surveys WHERE id = ?',
      [surveyId]
    );
    const assigner = await db.execute_single(
      'SELECT id, company_name, contact_person_name FROM assigners WHERE id = ?',
      [fullSurvey.assigner_id]
    );

    // Notify surveyor that they have been assigned
    if (fullSurvey && assigner) {
      notificationHelper.notifySurveyorSurveyAssigned(
        surveyor_id,
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

    res.json(success({
      survey_id: surveyId,
      surveyor_id: surveyor_id,
      surveyor_name: surveyor.full_name
    }, `Survey assigned to ${surveyor.full_name}`));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Surveyor Live Location (Admin view)
 * GET /api/v1/admin/surveys/:id/surveyor-location
 */
const getSurveyorLocation = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      `SELECT s.id, s.status, s.surveyor_id, sv.current_latitude, sv.current_longitude, sv.location_updated_at
       FROM surveys s
       JOIN surveyors sv ON s.surveyor_id = sv.id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Admin can view location in any active status ideally, matching assigner logic
    const { SURVEY_STATUS } = require('../../utils/constants');
    if (![SURVEY_STATUS.IN_TRANSIT, SURVEY_STATUS.ARRIVED, SURVEY_STATUS.VISIT_COMPLETED].includes(survey.status)) {
      // Optional: Decide if admin should see location even if not in these statuses. stick to same logic for now.
      return res.status(400).json(error('Surveyor location only available during transit or after arrival'));
    }

    res.json(success({
      latitude: survey.current_latitude,
      longitude: survey.current_longitude,
      updated_at: survey.location_updated_at
    }));
  } catch (err) {
    next(err);
  }
};

// Only terminal surveys may be archived (active/in-progress cases stay put)
const ARCHIVABLE_STATUSES = ['finished', 'completed', 'cancelled', 'not_resolved'];

/**
 * Archive a single survey
 * PUT /api/v1/admin/surveys/:id/archive
 */
const archiveSurvey = async (req, res, next) => {
  try {
    const surveyId = req.params.id;
    const survey = await db.execute_single('SELECT id, status, is_archived FROM surveys WHERE id = ?', [surveyId]);
    if (!survey) return res.status(404).json(notFound('Survey not found'));
    if (!ARCHIVABLE_STATUSES.includes(survey.status)) {
      return res.status(400).json(error('Only completed or cancelled surveys can be archived'));
    }
    await db.execute_query(
      'UPDATE surveys SET is_archived = 1, archived_at = NOW(), archived_by = ?, updated_at = NOW() WHERE id = ?',
      [req.user.id, surveyId]
    );
    res.json(success({ id: Number(surveyId), is_archived: true }, 'Survey archived'));
  } catch (err) {
    next(err);
  }
};

/**
 * Unarchive a single survey (restore to the active list)
 * PUT /api/v1/admin/surveys/:id/unarchive
 */
const unarchiveSurvey = async (req, res, next) => {
  try {
    const surveyId = req.params.id;
    const survey = await db.execute_single('SELECT id FROM surveys WHERE id = ?', [surveyId]);
    if (!survey) return res.status(404).json(notFound('Survey not found'));
    await db.execute_query(
      'UPDATE surveys SET is_archived = 0, archived_at = NULL, archived_by = NULL, updated_at = NOW() WHERE id = ?',
      [surveyId]
    );
    res.json(success({ id: Number(surveyId), is_archived: false }, 'Survey restored'));
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk archive / unarchive surveys
 * POST /api/v1/admin/surveys/bulk-archive  { ids: number[], archived: boolean }
 */
const bulkArchiveSurveys = async (req, res, next) => {
  try {
    const { ids, archived = true } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(error('ids array is required'));
    }
    const cleanIds = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (cleanIds.length === 0) return res.status(400).json(error('No valid survey ids provided'));
    const placeholders = cleanIds.map(() => '?').join(',');

    if (archived) {
      // Archive only terminal, not-yet-archived surveys; the rest are silently skipped
      const result = await db.execute_query(
        `UPDATE surveys SET is_archived = 1, archived_at = NOW(), archived_by = ?, updated_at = NOW()
         WHERE id IN (${placeholders}) AND is_archived = 0
           AND status IN ('finished', 'completed', 'cancelled', 'not_resolved')`,
        [req.user.id, ...cleanIds]
      );
      const count = result?.affectedRows || 0;
      return res.json(success(
        { archived: count, skipped: cleanIds.length - count },
        `${count} survey(s) archived${count < cleanIds.length ? `, ${cleanIds.length - count} skipped (not completed/cancelled)` : ''}`
      ));
    }

    const result = await db.execute_query(
      `UPDATE surveys SET is_archived = 0, archived_at = NULL, archived_by = NULL, updated_at = NOW()
       WHERE id IN (${placeholders}) AND is_archived = 1`,
      cleanIds
    );
    const count = result?.affectedRows || 0;
    return res.json(success({ unarchived: count }, `${count} survey(s) restored`));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // Profile
  getProfile,
  updateProfile,
  changePassword,

  // Admin management
  createAdmin,
  listAdmins,

  // Assigner management
  createAssigner,
  listAssigners,
  getAssigner,
  updateAssigner,
  activateAssigner,
  deactivateAssigner,
  deleteAssigner,

  // Survey management
  listSurveys,
  getSurvey,
  listAvailableSurveyors,
  assignSurveyorToSurvey,
  getSurveyorLocation,
  archiveSurvey,
  unarchiveSurvey,
  bulkArchiveSurveys
};
