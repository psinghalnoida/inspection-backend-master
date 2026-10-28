/**
 * Surveyor Profile Controller
 */

const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const { success, error, notFound, created } = require('../../utils/response');

/**
 * Get Profile
 * GET /api/v1/surveyor/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const eligibility = require('../../services/eligibility.service');

    const surveyor = await db.execute_single(
      `SELECT sv.id, sv.full_name, sv.email, sv.phone, sv.profile_picture_url,
              sv.surveyor_license_id, sv.business_address, sv.city, sv.state, sv.pincode,
              sv.current_latitude, sv.current_longitude, sv.location_updated_at,
              sv.is_available, sv.verification_status, sv.is_active, sv.is_investigator,
              sv.bank_ifsc_code, sv.upi_id, sv.created_at,
              ${eligibility.primeSelect('sv')}
       FROM surveyors sv WHERE sv.id = ?`,
      [req.user.id]
    );

    if (!surveyor) {
      return res.status(404).json(notFound('Surveyor not found'));
    }

    // v2 §1.5: the surveyor sees their own granted categories and Prime status.
    eligibility.decorateSurveyor(surveyor);
    surveyor.category_grants = await eligibility.getCategories(req.user.id);

    res.json(success(surveyor));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Profile
 * PUT /api/v1/surveyor/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { full_name, business_address, city, state, pincode, surveyor_license_id } = req.body;

    const updates = [];
    const params = [];

    if (full_name) { updates.push('full_name = ?'); params.push(full_name); }
    if (business_address !== undefined) { updates.push('business_address = ?'); params.push(business_address); }
    if (city !== undefined) { updates.push('city = ?'); params.push(city); }
    if (state !== undefined) { updates.push('state = ?'); params.push(state); }
    if (pincode !== undefined) { updates.push('pincode = ?'); params.push(pincode); }
    if (surveyor_license_id !== undefined) { updates.push('surveyor_license_id = ?'); params.push(surveyor_license_id); }

    // Handle profile picture upload
    if (req.file) {
      updates.push('profile_picture_url = ?');
      params.push(`/uploads/profiles/${req.file.filename}`);
    }

    if (updates.length === 0) {
      return res.status(400).json(error('No fields to update'));
    }

    params.push(req.user.id);

    await db.execute_query(
      `UPDATE surveyors SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    res.json(success(null, 'Profile updated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Change Password
 * PUT /api/v1/surveyor/change-password
 */
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json(error('Current and new password are required'));
    }

    const surveyor = await db.execute_single(
      'SELECT password_hash FROM surveyors WHERE id = ?',
      [req.user.id]
    );

    const isMatch = await bcrypt.compare(current_password, surveyor.password_hash);
    if (!isMatch) {
      return res.status(400).json(error('Current password is incorrect'));
    }

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const password_hash = await bcrypt.hash(new_password, saltRounds);

    await db.execute_query(
      'UPDATE surveyors SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [password_hash, req.user.id]
    );

    res.json(success(null, 'Password changed successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Change PIN
 * PUT /api/v1/surveyor/change-pin
 */
const changePIN = async (req, res, next) => {
  try {
    const { current_pin, new_pin } = req.body;

    if (!current_pin || !new_pin) {
      return res.status(400).json(error('Current and new PIN are required'));
    }

    if (!/^\d{4}$/.test(new_pin)) {
      return res.status(400).json(error('PIN must be 4 digits'));
    }

    const surveyor = await db.execute_single(
      'SELECT pin_hash FROM surveyors WHERE id = ?',
      [req.user.id]
    );

    const isMatch = await bcrypt.compare(current_pin, surveyor.pin_hash);
    if (!isMatch) {
      return res.status(400).json(error('Current PIN is incorrect'));
    }

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const pin_hash = await bcrypt.hash(new_pin, saltRounds);

    await db.execute_query(
      'UPDATE surveyors SET pin_hash = ?, updated_at = NOW() WHERE id = ?',
      [pin_hash, req.user.id]
    );

    res.json(success(null, 'PIN changed successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Upload KYC Document
 * POST /api/v1/surveyor/documents
 */
const uploadDocument = async (req, res, next) => {
  try {
    const { document_type } = req.body;

    if (!req.file) {
      return res.status(400).json(error('Document file is required'));
    }

    if (!document_type || !['government_id', 'proof_of_address', 'surveyor_license'].includes(document_type)) {
      return res.status(400).json(error('Valid document type is required'));
    }

    const result = await db.execute_query(
      `INSERT INTO surveyor_documents (
        surveyor_id, document_type, document_name, file_url, file_type, file_size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, document_type, req.file.originalname,
        `/uploads/documents/${req.file.filename}`,
        req.file.mimetype.split('/')[1],
        req.file.size
      ]
    );

    // Update verification status if was pending
    await db.execute_query(
      `UPDATE surveyors SET verification_status = 'under_review', updated_at = NOW()
       WHERE id = ? AND verification_status = 'pending'`,
      [req.user.id]
    );

    res.status(201).json(created({ id: result.insertId }, 'Document uploaded'));
  } catch (err) {
    next(err);
  }
};

/**
 * List Documents
 * GET /api/v1/surveyor/documents
 */
const listDocuments = async (req, res, next) => {
  try {
    const documents = await db.execute_query(
      `SELECT id, document_type, document_name, file_url, file_type,
              is_verified, rejection_reason, created_at
       FROM surveyor_documents WHERE surveyor_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(success(documents));
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Document
 * DELETE /api/v1/surveyor/documents/:id
 */
const deleteDocument = async (req, res, next) => {
  try {
    // Can only delete unverified documents
    const result = await db.execute_query(
      'DELETE FROM surveyor_documents WHERE id = ? AND surveyor_id = ? AND is_verified = FALSE',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Document not found or cannot be deleted'));
    }

    res.json(success(null, 'Document deleted'));
  } catch (err) {
    next(err);
  }
};

/**
 * Toggle Availability
 * PUT /api/v1/surveyor/availability
 */
const toggleAvailability = async (req, res, next) => {
  try {
    const { is_available } = req.body;

    if (is_available === undefined) {
      return res.status(400).json(error('is_available is required'));
    }

    await db.execute_query(
      'UPDATE surveyors SET is_available = ?, updated_at = NOW() WHERE id = ?',
      [is_available, req.user.id]
    );

    // Broadcast availability change to all connected clients (especially admins)
    const io = req.app.get('io');
    if (io) {
      console.log(`📡 Broadcasting surveyor #${req.user.id} availability: ${is_available ? 'ONLINE' : 'OFFLINE'}`);
      io.emit('surveyor:availability', {
        surveyorId: req.user.id,
        isAvailable: is_available,
        timestamp: new Date().toISOString()
      });
    }

    res.json(success({ is_available }, `You are now ${is_available ? 'online' : 'offline'}`));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Current Location
 * PUT /api/v1/surveyor/location
 */
const updateLocation = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json(error('Latitude and longitude are required'));
    }

    await db.execute_query(
      `UPDATE surveyors SET 
        current_latitude = ?, 
        current_longitude = ?, 
        location_updated_at = NOW(),
        updated_at = NOW()
       WHERE id = ?`,
      [latitude, longitude, req.user.id]
    );

    res.json(success(null, 'Location updated'));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Bank Details
 * PUT /api/v1/surveyor/bank-details
 */
const updateBankDetails = async (req, res, next) => {
  try {
    const { bank_account_number, bank_ifsc_code, bank_account_holder_name, upi_id } = req.body;

    const updates = [];
    const params = [];

    if (bank_account_number) {
      // Encrypt bank account number (in production, use proper encryption)
      updates.push('bank_account_number_encrypted = ?');
      params.push(bank_account_number); // TODO: Encrypt this
    }
    if (bank_ifsc_code) { updates.push('bank_ifsc_code = ?'); params.push(bank_ifsc_code); }
    if (bank_account_holder_name) { updates.push('bank_account_holder_name = ?'); params.push(bank_account_holder_name); }
    if (upi_id !== undefined) { updates.push('upi_id = ?'); params.push(upi_id); }

    if (updates.length === 0) {
      return res.status(400).json(error('No fields to update'));
    }

    params.push(req.user.id);

    await db.execute_query(
      `UPDATE surveyors SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    res.json(success(null, 'Bank details updated'));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  changePIN,
  uploadDocument,
  listDocuments,
  deleteDocument,
  toggleAvailability,
  updateLocation,
  updateBankDetails
};
