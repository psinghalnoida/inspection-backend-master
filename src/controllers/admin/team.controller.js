/**
 * Admin: Assigner Surveyor Team Management
 *
 * Team = list of surveyors an assigner (with is_direct_assign=TRUE) is allowed to directly assign to.
 * Only admins can modify teams. Direct-assignment is blocked if the assigner's team is empty.
 */

const db = require('../../config/database');
const { success, error, notFound, created } = require('../../utils/response');
const notificationHelper = require('../../services/notification.helper');
const eligibility = require('../../services/eligibility.service');

/**
 * List Team Members for an Assigner
 * GET /api/v1/admin/assigners/:id/team
 */
const listTeam = async (req, res, next) => {
  try {
    const assigner = await db.execute_single(
      'SELECT id, is_direct_assign FROM assigners WHERE id = ?',
      [req.params.id]
    );
    if (!assigner) return res.status(404).json(notFound('Assigner not found'));

    const members = eligibility.decorateSurveyors(await db.query_rows(
      `SELECT t.id as team_entry_id, t.created_at as added_at,
              t.status, t.invited_by, t.responded_at,
              sv.id, sv.full_name, sv.phone, sv.email, sv.profile_picture_url,
              sv.city, sv.state, sv.verification_status, sv.is_active, sv.is_available,
              sv.is_investigator,
              ${eligibility.primeSelect('sv')}
         FROM assigner_surveyor_team t
         JOIN surveyors sv ON sv.id = t.surveyor_id
        WHERE t.assigner_id = ?
        ORDER BY FIELD(t.status, 'pending', 'accepted', 'declined'), t.created_at DESC`,
      [req.params.id]
    ));

    res.json(success({
      assigner_id: Number(req.params.id),
      is_direct_assign: !!assigner.is_direct_assign,
      members
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Add Surveyor to Team
 * POST /api/v1/admin/assigners/:id/team  { surveyor_id }
 */
const addTeamMember = async (req, res, next) => {
  try {
    const assignerId = req.params.id;
    const { surveyor_id } = req.body;

    if (!surveyor_id) return res.status(400).json(error('surveyor_id is required'));

    // company_name / contact_person_name are needed for the invite notification.
    const assigner = await db.execute_single(
      'SELECT id, company_name, contact_person_name, is_direct_assign FROM assigners WHERE id = ?',
      [assignerId]
    );
    if (!assigner) return res.status(404).json(notFound('Assigner not found'));
    if (!assigner.is_direct_assign) {
      return res.status(400).json(error('Assigner does not have direct assignment enabled'));
    }

    const surveyor = await db.execute_single(
      `SELECT id, full_name, verification_status, is_active
         FROM surveyors WHERE id = ?`,
      [surveyor_id]
    );
    if (!surveyor) return res.status(404).json(notFound('Surveyor not found'));
    if (!surveyor.is_active) return res.status(400).json(error('Surveyor is not active'));
    if (surveyor.verification_status !== 'verified') {
      return res.status(400).json(error('Surveyor is not verified'));
    }

    const existing = await db.execute_single(
      'SELECT id, status FROM assigner_surveyor_team WHERE assigner_id = ? AND surveyor_id = ?',
      [assignerId, surveyor_id]
    );
    if (existing && existing.status === 'accepted') {
      return res.status(409).json(error('Surveyor already in this team'));
    }

    // v2 §2.2: even when admin adds the row, the surveyor must consent. Admin
    // fiat is no longer enough — accepting removes a non-Prime surveyor from
    // open broadcasts, so it cannot happen without them agreeing.
    let teamEntryId;
    if (existing) {
      await db.execute_query(
        `UPDATE assigner_surveyor_team
            SET status = 'pending', invited_by = 'admin', added_by_admin_id = ?,
                responded_at = NULL, updated_at = NOW()
          WHERE id = ?`,
        [req.user.id, existing.id]
      );
      teamEntryId = existing.id;
    } else {
      const result = await db.execute_query(
        `INSERT INTO assigner_surveyor_team
           (assigner_id, surveyor_id, added_by_admin_id, invited_by, status)
         VALUES (?, ?, ?, 'admin', 'pending')`,
        [assignerId, surveyor_id, req.user.id]
      );
      teamEntryId = result.insertId;
    }

    const primeRow = await db.execute_single(
      `SELECT EXISTS (
         SELECT 1 FROM surveyor_categories sc
          WHERE sc.surveyor_id = ?
            AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
       ) AS is_prime`,
      [surveyor_id]
    );

    notificationHelper
      .notifyEmployeeInvite(surveyor_id, assigner, { isPrime: !!primeRow?.is_prime })
      .catch((err) => console.error('Employee invite notification error:', err));

    res.status(201).json(created({
      team_entry_id: teamEntryId,
      assigner_id: Number(assignerId),
      surveyor_id: Number(surveyor_id),
      status: 'pending'
    }, `Invitation sent to ${surveyor.full_name}. They join the team once they accept.`));
  } catch (err) {
    next(err);
  }
};

/**
 * Remove Surveyor from Team
 * DELETE /api/v1/admin/assigners/:id/team/:surveyorId
 */
const removeTeamMember = async (req, res, next) => {
  try {
    const { id: assignerId, surveyorId } = req.params;

    const result = await db.execute_query(
      'DELETE FROM assigner_surveyor_team WHERE assigner_id = ? AND surveyor_id = ?',
      [assignerId, surveyorId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Team entry not found'));
    }

    res.json(success(null, 'Surveyor removed from team'));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listTeam,
  addTeamMember,
  removeTeamMember
};
