/**
 * Assigner Profile Controller
 */

const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const { success, error, notFound } = require('../../utils/response');

/**
 * Get Profile
 * GET /api/v1/assigner/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const assigner = await db.execute_single(
      `SELECT id, phone, email, company_name, contact_person_name,
              profile_picture_url, latitude, longitude, address,
              city, state, pincode, is_active, is_direct_assign, created_at
       FROM assigners WHERE id = ?`,
      [req.user.id]
    );

    if (!assigner) {
      return res.status(404).json(notFound('Assigner not found'));
    }

    assigner.is_direct_assign = assigner.is_direct_assign !== false && assigner.is_direct_assign !== 0;

    res.json(success(assigner));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Profile
 * PUT /api/v1/assigner/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { company_name, contact_person_name, address, city, state, pincode, latitude, longitude } = req.body;

    const updates = [];
    const params = [];

    if (company_name !== undefined) { updates.push('company_name = ?'); params.push(company_name); }
    if (contact_person_name !== undefined) { updates.push('contact_person_name = ?'); params.push(contact_person_name); }
    if (address !== undefined) { updates.push('address = ?'); params.push(address); }
    if (city !== undefined) { updates.push('city = ?'); params.push(city); }
    if (state !== undefined) { updates.push('state = ?'); params.push(state); }
    if (pincode !== undefined) { updates.push('pincode = ?'); params.push(pincode); }
    if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
    if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }

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
      `UPDATE assigners SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    res.json(success(null, 'Profile updated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Change Password
 * PUT /api/v1/assigner/change-password
 */
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json(error('Current and new password are required'));
    }

    const assigner = await db.execute_single(
      'SELECT password_hash FROM assigners WHERE id = ?',
      [req.user.id]
    );

    const isMatch = await bcrypt.compare(current_password, assigner.password_hash);
    if (!isMatch) {
      return res.status(400).json(error('Current password is incorrect'));
    }

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const password_hash = await bcrypt.hash(new_password, saltRounds);

    await db.execute_query(
      'UPDATE assigners SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [password_hash, req.user.id]
    );

    res.json(success(null, 'Password changed successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get My Surveyor Team
 * GET /api/v1/assigner/team
 *
 * Admin builds this team per assigner. Only surfaced for assigners with
 * is_direct_assign=TRUE — others cannot direct-assign, so the list is not relevant.
 */
const getTeam = async (req, res, next) => {
  try {
    const assigner = await db.execute_single(
      'SELECT id, is_direct_assign FROM assigners WHERE id = ?',
      [req.user.id]
    );
    if (!assigner) return res.status(404).json(notFound('Assigner not found'));

    const isDirectAssign = !!assigner.is_direct_assign;
    if (!isDirectAssign) {
      // Keep the same shape as the success path — a client doing
      // `data.pending.map(...)` must not crash on this branch.
      return res.json(success({
        is_direct_assign: false, members: [], pending: [], declined: []
      }));
    }

    // v2 §1.5: return categories + the derived Prime flag so the assigner can see
    // whether a surveyor actually holds the licence for the case they are
    // assigning. Without it they pick blind and the server rejects the mismatch.
    const eligibility = require('../../services/eligibility.service');

    // v2 §2.2: `members` holds only surveyors who have ACCEPTED — those are the
    // only ones direct-assign will allow, so offering pending/declined ones in
    // the picker would just produce a server rejection at submit time.
    // Pending and declined are returned separately so the assigner can see the
    // state of invites they have sent.
    const rows = await db.query_rows(
      `SELECT sv.id, sv.full_name, sv.phone, sv.profile_picture_url,
              sv.city, sv.state, sv.verification_status, sv.is_active, sv.is_available,
              sv.is_investigator,
              t.status, t.invited_by, t.created_at AS invited_at, t.responded_at,
              ${eligibility.primeSelect('sv')}
         FROM assigner_surveyor_team t
         JOIN surveyors sv ON sv.id = t.surveyor_id
        WHERE t.assigner_id = ?
          AND sv.is_active = 1
          AND sv.verification_status = 'verified'
        ORDER BY sv.full_name ASC`,
      [req.user.id]
    );

    const decorated = eligibility.decorateSurveyors(rows);

    res.json(success({
      is_direct_assign: true,
      members: decorated.filter((m) => m.status === 'accepted'),
      pending: decorated.filter((m) => m.status === 'pending'),
      declined: decorated.filter((m) => m.status === 'declined')
    }));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getTeam
};
