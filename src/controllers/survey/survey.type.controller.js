/**
 * Survey Type-Specific Details Controllers
 */

const db = require('../../config/database');
const { success, error, notFound, created } = require('../../utils/response');
const { normalizeVehicleNumber } = require('../../utils/helpers');

// ==================== MOTOR SURVEY ====================

/**
 * Add Motor Survey Details
 * POST /api/v1/surveys/:id/motor-details
 */
const addMotorDetails = async (req, res, next) => {
  try {
    const {
      vehicle_category,
      vehicle_type,
      vehicle_type_other,
      vehicle_number,
      workshop_name,
      workshop_advisor_name,
      workshop_advisor_contact
    } = req.body;

    // Verify survey belongs to assigner and is motor type
    const survey = await db.execute_single(
      `SELECT id, survey_type FROM surveys WHERE id = ? AND assigner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    if (!survey.survey_type.includes('motor')) {
      return res.status(400).json(error('This is not a motor survey'));
    }

    // Check if details already exist
    const existing = await db.execute_single(
      'SELECT id FROM motor_survey_details WHERE survey_id = ?',
      [req.params.id]
    );

    if (existing) {
      return res.status(400).json(error('Motor details already exist. Use PUT to update.'));
    }

    const result = await db.execute_query(
      `INSERT INTO motor_survey_details (
        survey_id, vehicle_category, vehicle_type, vehicle_type_other,
        vehicle_number, workshop_name, workshop_advisor_name, workshop_advisor_contact
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id, vehicle_category, vehicle_type, vehicle_type_other || null,
        normalizeVehicleNumber(vehicle_number),
        workshop_name || null, workshop_advisor_name || null, workshop_advisor_contact || null
      ]
    );

    res.status(201).json(created({ id: result.insertId }, 'Motor details added'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Motor Survey Details
 * GET /api/v1/surveys/:id/motor-details
 */
const getMotorDetails = async (req, res, next) => {
  try {
    const details = await db.execute_single(
      'SELECT * FROM motor_survey_details WHERE survey_id = ?',
      [req.params.id]
    );

    if (!details) {
      return res.status(404).json(notFound('Motor details not found'));
    }

    res.json(success(details));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Motor Survey Details
 * PUT /api/v1/surveys/:id/motor-details
 */
const updateMotorDetails = async (req, res, next) => {
  try {
    const {
      vehicle_category, vehicle_type, vehicle_type_other, vehicle_number,
      workshop_name, workshop_advisor_name, workshop_advisor_contact
    } = req.body;

    const updates = [];
    const params = [];

    if (vehicle_category) { updates.push('vehicle_category = ?'); params.push(vehicle_category); }
    if (vehicle_type) { updates.push('vehicle_type = ?'); params.push(vehicle_type); }
    if (vehicle_type_other !== undefined) { updates.push('vehicle_type_other = ?'); params.push(vehicle_type_other); }
    if (vehicle_number) { updates.push('vehicle_number = ?'); params.push(normalizeVehicleNumber(vehicle_number)); }
    if (workshop_name !== undefined) { updates.push('workshop_name = ?'); params.push(workshop_name); }
    if (workshop_advisor_name !== undefined) { updates.push('workshop_advisor_name = ?'); params.push(workshop_advisor_name); }
    if (workshop_advisor_contact !== undefined) { updates.push('workshop_advisor_contact = ?'); params.push(workshop_advisor_contact); }

    if (updates.length === 0) {
      return res.status(400).json(error('No fields to update'));
    }

    // Verify ownership
    const survey = await db.execute_single(
      'SELECT id FROM surveys WHERE id = ? AND assigner_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    params.push(req.params.id);

    const result = await db.execute_query(
      `UPDATE motor_survey_details SET ${updates.join(', ')}, updated_at = NOW() WHERE survey_id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Motor details not found'));
    }

    res.json(success(null, 'Motor details updated'));
  } catch (err) {
    next(err);
  }
};

// ==================== MARINE SURVEY ====================

/**
 * Add Marine Survey Details
 * POST /api/v1/surveys/:id/marine-details
 */
const addMarineDetails = async (req, res, next) => {
  try {
    const { name_of_consignee, name_of_consignor, commodity } = req.body;

    const survey = await db.execute_single(
      `SELECT id, survey_type FROM surveys WHERE id = ? AND assigner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    if (!survey.survey_type.includes('marine')) {
      return res.status(400).json(error('This is not a marine survey'));
    }

    const existing = await db.execute_single(
      'SELECT id FROM marine_survey_details WHERE survey_id = ?',
      [req.params.id]
    );

    if (existing) {
      return res.status(400).json(error('Marine details already exist'));
    }

    const result = await db.execute_query(
      `INSERT INTO marine_survey_details (survey_id, name_of_consignee, name_of_consignor, commodity)
       VALUES (?, ?, ?, ?)`,
      [req.params.id, name_of_consignee, name_of_consignor, commodity]
    );

    res.status(201).json(created({ id: result.insertId }, 'Marine details added'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Marine Survey Details
 * GET /api/v1/surveys/:id/marine-details
 */
const getMarineDetails = async (req, res, next) => {
  try {
    const details = await db.execute_single(
      'SELECT * FROM marine_survey_details WHERE survey_id = ?',
      [req.params.id]
    );

    if (!details) {
      return res.status(404).json(notFound('Marine details not found'));
    }

    // Get invoices and GR entries
    const [invoices, grEntries] = await Promise.all([
      db.execute_query('SELECT * FROM marine_invoices WHERE marine_survey_id = ?', [details.id]),
      db.execute_query('SELECT * FROM marine_gr_entries WHERE marine_survey_id = ?', [details.id])
    ]);

    details.invoices = invoices;
    details.gr_entries = grEntries;

    res.json(success(details));
  } catch (err) {
    next(err);
  }
};

/**
 * Add Invoice to Marine Survey
 * POST /api/v1/surveys/:id/marine-details/invoices
 */
const addMarineInvoice = async (req, res, next) => {
  try {
    const { invoice_number, invoice_date, invoice_amount } = req.body;

    // Get marine details id
    const marineDetails = await db.execute_single(
      `SELECT md.id FROM marine_survey_details md
       JOIN surveys s ON md.survey_id = s.id
       WHERE s.id = ? AND s.assigner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!marineDetails) {
      return res.status(404).json(notFound('Marine survey details not found'));
    }

    const result = await db.execute_query(
      `INSERT INTO marine_invoices (marine_survey_id, invoice_number, invoice_date, invoice_amount)
       VALUES (?, ?, ?, ?)`,
      [marineDetails.id, invoice_number, invoice_date, invoice_amount || null]
    );

    res.status(201).json(created({ id: result.insertId }, 'Invoice added'));
  } catch (err) {
    next(err);
  }
};

/**
 * Add GR Entry to Marine Survey
 * POST /api/v1/surveys/:id/marine-details/gr-entries
 */
const addMarineGREntry = async (req, res, next) => {
  try {
    const { gr_number, gr_date } = req.body;

    const marineDetails = await db.execute_single(
      `SELECT md.id FROM marine_survey_details md
       JOIN surveys s ON md.survey_id = s.id
       WHERE s.id = ? AND s.assigner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!marineDetails) {
      return res.status(404).json(notFound('Marine survey details not found'));
    }

    const result = await db.execute_query(
      `INSERT INTO marine_gr_entries (marine_survey_id, gr_number, gr_date)
       VALUES (?, ?, ?)`,
      [marineDetails.id, gr_number, gr_date]
    );

    res.status(201).json(created({ id: result.insertId }, 'GR entry added'));
  } catch (err) {
    next(err);
  }
};

// ==================== INVESTIGATION SURVEY ====================

/**
 * Add Investigation Survey Details
 * POST /api/v1/surveys/:id/investigation-details
 */
const addInvestigationDetails = async (req, res, next) => {
  try {
    const {
      loss_item_type,
      vehicle_number,
      cattle_tag_number,
      cattle_name,
      human_name,
      human_contact_number,
      human_relation,
      other_loss_item_name
    } = req.body;

    const survey = await db.execute_single(
      `SELECT id, survey_type FROM surveys WHERE id = ? AND assigner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    if (survey.survey_type !== 'investigation') {
      return res.status(400).json(error('This is not an investigation survey'));
    }

    const existing = await db.execute_single(
      'SELECT id FROM investigation_survey_details WHERE survey_id = ?',
      [req.params.id]
    );

    if (existing) {
      return res.status(400).json(error('Investigation details already exist'));
    }

    const result = await db.execute_query(
      `INSERT INTO investigation_survey_details (
        survey_id, loss_item_type, vehicle_number, cattle_tag_number, cattle_name,
        human_name, human_contact_number, human_relation, other_loss_item_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id, loss_item_type,
        vehicle_number ? normalizeVehicleNumber(vehicle_number) : null,
        cattle_tag_number || null, cattle_name || null,
        human_name || null, human_contact_number || null, human_relation || null,
        other_loss_item_name || null
      ]
    );

    res.status(201).json(created({ id: result.insertId }, 'Investigation details added'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Investigation Survey Details
 * GET /api/v1/surveys/:id/investigation-details
 */
const getInvestigationDetails = async (req, res, next) => {
  try {
    const details = await db.execute_single(
      'SELECT * FROM investigation_survey_details WHERE survey_id = ?',
      [req.params.id]
    );

    if (!details) {
      return res.status(404).json(notFound('Investigation details not found'));
    }

    res.json(success(details));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Investigation Survey Details
 * PUT /api/v1/surveys/:id/investigation-details
 */
const updateInvestigationDetails = async (req, res, next) => {
  try {
    const {
      loss_item_type, vehicle_number, cattle_tag_number, cattle_name,
      human_name, human_contact_number, human_relation, other_loss_item_name
    } = req.body;

    const updates = [];
    const params = [];

    if (loss_item_type) { updates.push('loss_item_type = ?'); params.push(loss_item_type); }
    if (vehicle_number !== undefined) { updates.push('vehicle_number = ?'); params.push(vehicle_number ? normalizeVehicleNumber(vehicle_number) : null); }
    if (cattle_tag_number !== undefined) { updates.push('cattle_tag_number = ?'); params.push(cattle_tag_number); }
    if (cattle_name !== undefined) { updates.push('cattle_name = ?'); params.push(cattle_name); }
    if (human_name !== undefined) { updates.push('human_name = ?'); params.push(human_name); }
    if (human_contact_number !== undefined) { updates.push('human_contact_number = ?'); params.push(human_contact_number); }
    if (human_relation !== undefined) { updates.push('human_relation = ?'); params.push(human_relation); }
    if (other_loss_item_name !== undefined) { updates.push('other_loss_item_name = ?'); params.push(other_loss_item_name); }

    if (updates.length === 0) {
      return res.status(400).json(error('No fields to update'));
    }

    const survey = await db.execute_single(
      'SELECT id FROM surveys WHERE id = ? AND assigner_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    params.push(req.params.id);

    const result = await db.execute_query(
      `UPDATE investigation_survey_details SET ${updates.join(', ')}, updated_at = NOW() WHERE survey_id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Investigation details not found'));
    }

    res.json(success(null, 'Investigation details updated'));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // Motor
  addMotorDetails,
  getMotorDetails,
  updateMotorDetails,

  // Marine
  addMarineDetails,
  getMarineDetails,
  addMarineInvoice,
  addMarineGREntry,

  // Investigation
  addInvestigationDetails,
  getInvestigationDetails,
  updateInvestigationDetails
};
