/**
 * Surveyor Management Controller (Admin)
 */

const db = require('../../config/database');
const { success, error, notFound, paginated, created } = require('../../utils/response');
const { parsePagination } = require('../../utils/helpers');
const { VERIFICATION_STATUS, SURVEYOR_CATEGORY_LIST } = require('../../utils/constants');
const eligibility = require('../../services/eligibility.service');

// Helper to get short file extension (max 3 chars for DB column)
const getFileExt = (filename) => {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = { jpeg: 'jpg', tiff: 'tif', webp: 'web' };
  return (map[ext] || ext).slice(0, 3) || 'bin';
};

/**
 * List All Surveyors
 * GET /api/v1/admin/surveyors
 */
const listSurveyors = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, verification, search } = req.query;

    // v2 §1: filter by granted category, and by Prime / investigator-only status.
    const { category, prime } = req.query;

    let whereClause = '1=1';
    const whereParams = [];

    if (status === 'active') {
      whereClause += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
      whereClause += ' AND is_active = FALSE';
    }

    if (verification) {
      whereClause += ' AND verification_status = ?';
      whereParams.push(verification);
    }

    if (search) {
      whereClause += ' AND (phone LIKE ? OR email LIKE ? OR full_name LIKE ?)';
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Category / Prime filters are expressed against the base table so they
    // survive the alias-rewrite below (which only rewrites the columns it lists).
    const categoryExists = (extra = '') =>
      `EXISTS (SELECT 1 FROM surveyor_categories sc
                WHERE sc.surveyor_id = surveyors.id
                  AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())${extra})`;

    if (category && SURVEYOR_CATEGORY_LIST.includes(category)) {
      whereClause += ` AND ${categoryExists(' AND sc.category = ?')}`;
      whereParams.push(category);
    }

    if (prime === 'true') {
      whereClause += ` AND ${categoryExists()}`;
    } else if (prime === 'false') {
      whereClause += ` AND NOT ${categoryExists()}`;
    }

    const listParams = [...whereParams, limit, offset];

    // The list query aliases `surveyors` as `sv`, so the shared where-clause has
    // its bare column references rewritten. Our EXISTS fragments above reference
    // `surveyors.id` explicitly, which is rewritten to `sv.id` by the last rule.
    const aliasedWhere = whereClause
      .replace(/is_active/g, 'sv.is_active')
      .replace(/verification_status/g, 'sv.verification_status')
      .replace(/phone/g, 'sv.phone')
      .replace(/email/g, 'sv.email')
      .replace(/full_name/g, 'sv.full_name')
      .replace(/surveyors\.id/g, 'sv.id');

    const [surveyors, countResult] = await Promise.all([
      db.query_rows(
        `SELECT sv.id, sv.full_name, sv.email, sv.phone, sv.profile_picture_url,
                sv.city, sv.state, sv.verification_status, sv.is_active, sv.is_available,
                sv.is_investigator, sv.created_at,
                COALESCE(s.survey_count, 0) as survey_count,
                ${eligibility.primeSelect('sv')}
         FROM surveyors sv
         LEFT JOIN (
           SELECT surveyor_id, COUNT(*) as survey_count
           FROM surveys
           GROUP BY surveyor_id
         ) s ON sv.id = s.surveyor_id
         WHERE ${aliasedWhere}
         ORDER BY sv.created_at DESC
         LIMIT ? OFFSET ?`,
        listParams
      ),
      db.query_single(
        `SELECT COUNT(*) as total FROM surveyors WHERE ${whereClause}`,
        whereParams.length > 0 ? whereParams : []
      )
    ]);

    res.json(paginated(eligibility.decorateSurveyors(surveyors), { page, limit, total: countResult.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Surveyor Details
 * GET /api/v1/admin/surveyors/:id
 */
const getSurveyor = async (req, res, next) => {
  try {
    const surveyor = await db.execute_single(
      `SELECT sv.id, sv.full_name, sv.email, sv.phone, sv.profile_picture_url,
              sv.surveyor_license_id, sv.business_address, sv.city, sv.state, sv.pincode,
              sv.verification_status, sv.verified_at, sv.rejection_reason,
              sv.is_active, sv.is_available, sv.is_investigator,
              sv.bank_ifsc_code, sv.bank_account_number_encrypted,
              sv.bank_account_holder_name, sv.upi_id,
              sv.created_at, sv.updated_at,
              ${eligibility.primeSelect('sv')}
       FROM surveyors sv WHERE sv.id = ?`,
      [req.params.id]
    );

    if (!surveyor) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    // Get KYC documents
    const documents = await db.execute_query(
      `SELECT id, document_type, document_name, file_url, file_type,
              is_verified, verified_at, rejection_reason, created_at
       FROM surveyor_documents WHERE surveyor_id = ?`,
      [req.params.id]
    );

    eligibility.decorateSurveyor(surveyor);
    surveyor.documents = documents;
    // Full grant rows (licence number, expiry, who granted) for the admin detail view.
    surveyor.category_grants = await eligibility.getCategories(req.params.id);

    res.json(success(surveyor));
  } catch (err) {
    next(err);
  }
};

/**
 * Verify Surveyor KYC
 * PUT /api/v1/admin/surveyors/:id/verify
 */
const verifySurveyor = async (req, res, next) => {
  try {
    // v2 §1.6: admin decides the licensed categories at approval time.
    // Body is optional — omitting `categories` approves the surveyor as
    // investigator-only (valid, and not Prime).
    const { categories } = req.body || {};

    const categoryError = eligibility.validateCategories(categories);
    if (categoryError) {
      return res.status(400).json(error(categoryError));
    }

    const surveyor = await db.execute_single(
      'SELECT id, verification_status FROM surveyors WHERE id = ?',
      [req.params.id]
    );

    if (!surveyor) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    await db.execute_query(
      `UPDATE surveyors SET
        verification_status = ?,
        verified_by = ?,
        verified_at = NOW(),
        is_active = TRUE,
        activated_by = ?,
        activated_at = NOW(),
        updated_at = NOW()
       WHERE id = ?`,
      [VERIFICATION_STATUS.VERIFIED, req.user.id, req.user.id, req.params.id]
    );

    // Mark all documents as verified
    await db.execute_query(
      `UPDATE surveyor_documents SET
        is_verified = TRUE,
        verified_by = ?,
        verified_at = NOW()
       WHERE surveyor_id = ?`,
      [req.user.id, req.params.id]
    );

    let granted;
    if (categories !== undefined) {
      granted = await eligibility.setCategories(req.params.id, categories, req.user.id);
    }

    res.json(success(
      { categories: granted, is_prime: granted ? granted.length > 0 : undefined },
      'Surveyor verified and activated successfully'
    ));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Surveyor Categories
 * GET /api/v1/admin/surveyors/:id/categories
 */
const getSurveyorCategories = async (req, res, next) => {
  try {
    const grants = await eligibility.getCategories(req.params.id);
    res.json(success({
      available: SURVEYOR_CATEGORY_LIST,
      granted: grants,
      is_prime: grants.length > 0
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Replace Surveyor Categories
 * PUT /api/v1/admin/surveyors/:id/categories
 *
 * Send the complete desired set — this replaces all existing grants.
 * An empty array demotes the surveyor to investigator-only (not Prime).
 */
const setSurveyorCategories = async (req, res, next) => {
  try {
    const { categories } = req.body || {};

    if (categories === undefined) {
      return res.status(400).json(error('categories is required (send [] to revoke all)'));
    }

    const categoryError = eligibility.validateCategories(categories);
    if (categoryError) {
      return res.status(400).json(error(categoryError));
    }

    const surveyor = await db.execute_single('SELECT id FROM surveyors WHERE id = ?', [req.params.id]);
    if (!surveyor) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    const granted = await eligibility.setCategories(req.params.id, categories, req.user.id);

    res.json(success(
      { categories: granted, is_prime: granted.length > 0 },
      granted.length > 0
        ? `Categories updated — surveyor is Prime (${granted.join(', ')})`
        : 'All categories revoked — surveyor is investigator-only'
    ));
  } catch (err) {
    next(err);
  }
};

/**
 * Reject Surveyor KYC
 * PUT /api/v1/admin/surveyors/:id/reject
 */
const rejectSurveyor = async (req, res, next) => {
  try {
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
      return res.status(400).json(error('Rejection reason is required'));
    }

    const result = await db.execute_query(
      `UPDATE surveyors SET 
        verification_status = ?,
        verified_by = ?,
        verified_at = NOW(),
        rejection_reason = ?,
        is_active = FALSE,
        updated_at = NOW()
       WHERE id = ?`,
      [VERIFICATION_STATUS.REJECTED, req.user.id, rejection_reason, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    res.json(success(null, 'Surveyor KYC rejected'));
  } catch (err) {
    next(err);
  }
};

/**
 * Activate Surveyor
 * PUT /api/v1/admin/surveyors/:id/activate
 */
const activateSurveyor = async (req, res, next) => {
  try {
    const surveyor = await db.execute_single(
      'SELECT verification_status FROM surveyors WHERE id = ?',
      [req.params.id]
    );

    if (!surveyor) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    if (surveyor.verification_status !== VERIFICATION_STATUS.VERIFIED) {
      return res.status(400).json(error('Surveyor must be verified before activation'));
    }

    await db.execute_query(
      `UPDATE surveyors SET 
        is_active = TRUE,
        activated_by = ?,
        activated_at = NOW(),
        updated_at = NOW()
       WHERE id = ?`,
      [req.user.id, req.params.id]
    );

    res.json(success(null, 'Surveyor activated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Deactivate Surveyor
 * PUT /api/v1/admin/surveyors/:id/deactivate
 */
const deactivateSurveyor = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      `UPDATE surveyors SET is_active = FALSE, updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    res.json(success(null, 'Surveyor deactivated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Surveyor Documents
 * GET /api/v1/admin/surveyors/:id/documents
 */
const getSurveyorDocuments = async (req, res, next) => {
  try {
    const documents = await db.execute_query(
      `SELECT id, document_type, document_name, file_url, file_type,
              file_size_bytes, is_verified, verified_at, rejection_reason, created_at
       FROM surveyor_documents WHERE surveyor_id = ?
       ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json(success(documents));
  } catch (err) {
    next(err);
  }
};

/**
 * Verify Specific Document
 * PUT /api/v1/admin/surveyors/:id/documents/:docId/verify
 */
const verifyDocument = async (req, res, next) => {
  try {
    const { is_verified, rejection_reason } = req.body;

    if (is_verified === undefined) {
      return res.status(400).json(error('is_verified is required'));
    }

    if (!is_verified && !rejection_reason) {
      return res.status(400).json(error('Rejection reason required when rejecting'));
    }

    const result = await db.execute_query(
      `UPDATE surveyor_documents SET 
        is_verified = ?,
        verified_by = ?,
        verified_at = NOW(),
        rejection_reason = ?
       WHERE id = ? AND surveyor_id = ?`,
      [is_verified, req.user.id, rejection_reason || null, req.params.docId, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Document not found'));
    }

    res.json(success(null, is_verified ? 'Document verified' : 'Document rejected'));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Surveyor
 * PUT /api/v1/admin/surveyors/:id
 */
const updateSurveyor = async (req, res, next) => {
  try {
    const {
      full_name, email, surveyor_license_id, business_address, city, state, pincode,
      bank_ifsc_code, bank_account_number_encrypted, bank_account_holder_name, upi_id,
      is_investigator, categories
    } = req.body;

    // Categories live in their own table — handle before the column updates so
    // a request containing only `categories` still succeeds.
    const categoryError = eligibility.validateCategories(categories);
    if (categoryError) {
      return res.status(400).json(error(categoryError));
    }
    if (categories !== undefined) {
      await eligibility.setCategories(req.params.id, categories, req.user.id);
    }

    const updates = [];
    const params = [];

    if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (surveyor_license_id !== undefined) { updates.push('surveyor_license_id = ?'); params.push(surveyor_license_id); }
    if (business_address !== undefined) { updates.push('business_address = ?'); params.push(business_address); }
    if (city !== undefined) { updates.push('city = ?'); params.push(city); }
    if (state !== undefined) { updates.push('state = ?'); params.push(state); }
    if (pincode !== undefined) { updates.push('pincode = ?'); params.push(pincode); }
    if (bank_ifsc_code !== undefined) { updates.push('bank_ifsc_code = ?'); params.push(bank_ifsc_code); }
    if (bank_account_number_encrypted !== undefined) { updates.push('bank_account_number_encrypted = ?'); params.push(bank_account_number_encrypted); }
    if (bank_account_holder_name !== undefined) { updates.push('bank_account_holder_name = ?'); params.push(bank_account_holder_name); }
    if (upi_id !== undefined) { updates.push('upi_id = ?'); params.push(upi_id); }
    if (is_investigator !== undefined) { updates.push('is_investigator = ?'); params.push(!!is_investigator); }

    if (updates.length === 0) {
      // A categories-only update is legitimate — it already ran above.
      if (categories !== undefined) {
        return res.json(success(null, 'Surveyor categories updated successfully'));
      }
      return res.status(400).json(error('No fields to update'));
    }

    params.push(req.params.id);

    const result = await db.execute_query(
      `UPDATE surveyors SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    res.json(success(null, 'Surveyor updated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin Upload KYC Document for Surveyor
 * POST /api/v1/admin/surveyors/:id/documents
 */
const adminUploadDocument = async (req, res, next) => {
  try {
    const { document_type } = req.body;

    if (!req.file) {
      return res.status(400).json(error('Document file is required'));
    }

    if (!document_type || !['government_id', 'proof_of_address', 'surveyor_license'].includes(document_type)) {
      return res.status(400).json(error('Valid document type is required (government_id, proof_of_address, surveyor_license)'));
    }

    // Check surveyor exists
    const surveyor = await db.execute_single('SELECT id FROM surveyors WHERE id = ?', [req.params.id]);
    if (!surveyor) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    const result = await db.execute_query(
      `INSERT INTO surveyor_documents (
        surveyor_id, document_type, document_name, file_url, file_type, file_size_bytes,
        is_verified, verified_by, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, NOW())`,
      [
        req.params.id, document_type, req.file.originalname,
        `/uploads/documents/${req.file.filename}`,
        getFileExt(req.file.originalname),
        req.file.size,
        req.user.id
      ]
    );

    res.status(201).json(success({ id: result.insertId }, 'Document uploaded by admin'));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin Replace Existing KYC Document
 * PUT /api/v1/admin/surveyors/:id/documents/:docId/replace
 */
const adminReplaceDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json(error('Document file is required'));
    }

    const result = await db.execute_query(
      `UPDATE surveyor_documents SET 
        document_name = ?, file_url = ?, file_type = ?, file_size_bytes = ?,
        is_verified = TRUE, verified_by = ?, verified_at = NOW()
       WHERE id = ? AND surveyor_id = ?`,
      [
        req.file.originalname,
        `/uploads/documents/${req.file.filename}`,
        getFileExt(req.file.originalname),
        req.file.size,
        req.user.id,
        req.params.docId,
        req.params.id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Document not found'));
    }

    res.json(success(null, 'Document replaced successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin Delete KYC Document
 * DELETE /api/v1/admin/surveyors/:id/documents/:docId
 */
const adminDeleteDocument = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      'DELETE FROM surveyor_documents WHERE id = ? AND surveyor_id = ?',
      [req.params.docId, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Document not found'));
    }

    res.json(success(null, 'Document deleted successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Surveyor
 * DELETE /api/v1/admin/surveyors/:id
 */
const deleteSurveyor = async (req, res, next) => {
  try {
    // Check if surveyor has any surveys
    const surveysCount = await db.execute_single(
      'SELECT COUNT(*) as count FROM surveys WHERE surveyor_id = ?',
      [req.params.id]
    );

    if (surveysCount && surveysCount.count > 0) {
      return res.status(400).json(error(`Cannot delete surveyor. They have ${surveysCount.count} associated survey(s). Please reassign or delete those surveys first.`));
    }

    // Delete surveyor documents first
    await db.execute_query('DELETE FROM surveyor_documents WHERE surveyor_id = ?', [req.params.id]);

    const result = await db.execute_query(
      'DELETE FROM surveyors WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    res.json(success(null, 'Surveyor deleted successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Find Surveyor by Phone Number
 * GET /api/v1/admin/surveyors/by-phone
 */
const findSurveyorByPhone = async (req, res, next) => {
  try {
    const { phone } = req.query;
    
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    
    const surveyor = await db.execute_single(
      `SELECT id, full_name, phone, email, profile_picture_url, city, state, 
              verification_status, is_active, is_available, created_at
       FROM surveyors 
       WHERE phone = ? AND is_active = 1`,
      [phone]
    );
    
    if (!surveyor) {
      return res.status(404).json({ 
        success: false, 
        message: 'No active surveyor found with this phone number',
        code: 'SURVEYOR_NOT_FOUND'
      });
    }
    
    if (surveyor.verification_status !== 'verified') {
      return res.status(400).json({ 
        success: false, 
        message: 'Surveyor is not verified',
        code: 'SURVEYOR_NOT_VERIFIED'
      });
    }
    
    res.json(created(surveyor, 'Surveyor found'));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listSurveyors,
  getSurveyor,
  verifySurveyor,
  getSurveyorCategories,
  setSurveyorCategories,
  rejectSurveyor,
  activateSurveyor,
  deactivateSurveyor,
  getSurveyorDocuments,
  verifyDocument,
  updateSurveyor,
  adminUploadDocument,
  adminReplaceDocument,
  adminDeleteDocument,
  deleteSurveyor,
  findSurveyorByPhone
};
