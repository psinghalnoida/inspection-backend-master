/**
 * Team / Employee Controller
 * Spec: v2-spec.md §2
 *
 * Team membership IS employment. A row in `assigner_surveyor_team` means:
 * this assigner may direct-assign this surveyor, and this surveyor is their
 * employee. The `status` column carries the surveyor's consent.
 *
 * Consequences of an ACCEPTED row (both must stay in sync with §2.3):
 *   - the assigner may direct-assign them  (assigner/survey.controller.js)
 *   - a NON-PRIME surveyor drops out of open broadcasts entirely
 *     (services/eligibility.service.js)
 *
 * This module holds the assigner-side and surveyor-side halves. The admin-side
 * CRUD stays in controllers/admin/team.controller.js.
 */

const db = require('../../config/database');
const { success, error, notFound, created } = require('../../utils/response');
const notificationHelper = require('../../services/notification.helper');
const eligibility = require('../../services/eligibility.service');

/* ========================================================================== *
 * ASSIGNER SIDE
 * ========================================================================== */

/**
 * Invite a surveyor to the assigner's team.
 * POST /api/v1/assigner/team/invite  { phone }  or  { surveyor_id }
 *
 * v2 §2.2: the assigner initiates. Previously this was admin-only CRUD and the
 * mobile picker literally read "Contact admin to add surveyors".
 */
const inviteMember = async (req, res, next) => {
  try {
    const { phone, surveyor_id } = req.body || {};

    if (!phone && !surveyor_id) {
      return res.status(400).json(error('phone or surveyor_id is required'));
    }

    const assigner = await db.execute_single(
      'SELECT id, company_name, contact_person_name, is_direct_assign FROM assigners WHERE id = ?',
      [req.user.id]
    );
    if (!assigner) return res.status(404).json(notFound('Assigner not found'));
    if (!assigner.is_direct_assign) {
      return res.status(403).json({
        success: false,
        message: 'Direct assignment is not enabled for your account',
        code: 'DIRECT_ASSIGN_DISABLED'
      });
    }

    const surveyor = surveyor_id
      ? await db.execute_single(
          'SELECT id, full_name, phone, verification_status, is_active FROM surveyors WHERE id = ?',
          [surveyor_id]
        )
      : await db.execute_single(
          'SELECT id, full_name, phone, verification_status, is_active FROM surveyors WHERE phone = ? LIMIT 1',
          [phone]
        );

    if (!surveyor) {
      return res.status(404).json({
        success: false,
        message: 'No surveyor found with those details',
        code: 'SURVEYOR_NOT_FOUND'
      });
    }
    if (!surveyor.is_active || surveyor.verification_status !== 'verified') {
      return res.status(400).json({
        success: false,
        message: 'Surveyor is not verified yet',
        code: 'SURVEYOR_NOT_VERIFIED'
      });
    }

    const existing = await db.execute_single(
      'SELECT id, status FROM assigner_surveyor_team WHERE assigner_id = ? AND surveyor_id = ?',
      [req.user.id, surveyor.id]
    );

    if (existing && existing.status === 'accepted') {
      return res.status(409).json(error(`${surveyor.full_name} is already in your team`));
    }

    if (existing) {
      // Re-invite: a declined or still-pending row is reset rather than
      // duplicated (UNIQUE(assigner_id, surveyor_id) forbids a second row).
      await db.execute_query(
        `UPDATE assigner_surveyor_team
            SET status = 'pending', invited_by = 'assigner', responded_at = NULL, updated_at = NOW()
          WHERE id = ?`,
        [existing.id]
      );
    } else {
      await db.execute_query(
        `INSERT INTO assigner_surveyor_team (assigner_id, surveyor_id, invited_by, status)
         VALUES (?, ?, 'assigner', 'pending')`,
        [req.user.id, surveyor.id]
      );
    }

    // Prime surveyors keep receiving open broadcasts, so the warning in the
    // invite body differs — tell them the truth about what accepting costs.
    const primeRow = await db.execute_single(
      `SELECT EXISTS (
         SELECT 1 FROM surveyor_categories sc
          WHERE sc.surveyor_id = ?
            AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
       ) AS is_prime`,
      [surveyor.id]
    );

    notificationHelper
      .notifyEmployeeInvite(surveyor.id, assigner, { isPrime: !!primeRow?.is_prime })
      .catch((err) => console.error('Employee invite notification error:', err));

    res.status(201).json(created(
      { surveyor_id: surveyor.id, full_name: surveyor.full_name, status: 'pending' },
      `Invitation sent to ${surveyor.full_name}. They will appear in your team once they accept.`
    ));
  } catch (err) {
    next(err);
  }
};

/**
 * Remove a surveyor from the assigner's team (or cancel a pending invite).
 * DELETE /api/v1/assigner/team/:surveyorId
 */
const removeMember = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      'DELETE FROM assigner_surveyor_team WHERE assigner_id = ? AND surveyor_id = ?',
      [req.user.id, req.params.surveyorId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Surveyor is not in your team'));
    }

    res.json(success(null, 'Surveyor removed from your team'));
  } catch (err) {
    next(err);
  }
};

/* ========================================================================== *
 * SURVEYOR SIDE
 * ========================================================================== */

/**
 * List the surveyor's team memberships and pending invitations.
 * GET /api/v1/surveyor/team-invites
 */
const listMyInvites = async (req, res, next) => {
  try {
    const rows = await db.query_rows(
      `SELECT t.id AS invite_id, t.status, t.invited_by, t.created_at AS invited_at,
              t.responded_at,
              a.id AS assigner_id, a.company_name, a.contact_person_name,
              a.city, a.state, a.profile_picture_url
         FROM assigner_surveyor_team t
         JOIN assigners a ON a.id = t.assigner_id
        WHERE t.surveyor_id = ?
        ORDER BY FIELD(t.status, 'pending', 'accepted', 'declined'), t.created_at DESC`,
      [req.user.id]
    );

    // The surveyor needs to know what accepting actually costs them.
    const primeRow = await db.execute_single(
      `SELECT EXISTS (
         SELECT 1 FROM surveyor_categories sc
          WHERE sc.surveyor_id = ?
            AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
       ) AS is_prime`,
      [req.user.id]
    );
    const isPrime = !!primeRow?.is_prime;

    res.json(success({
      is_prime: isPrime,
      // TRUE means: accepting will remove you from open survey requests.
      accepting_removes_from_open_pool: !isPrime,
      pending: rows.filter((r) => r.status === 'pending'),
      accepted: rows.filter((r) => r.status === 'accepted'),
      declined: rows.filter((r) => r.status === 'declined')
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Respond to a team invitation.
 * PUT /api/v1/surveyor/team-invites/:assignerId  { action: 'accept' | 'decline' }
 */
const respondToInvite = async (req, res, next) => {
  try {
    const { action } = req.body || {};

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json(error("action must be 'accept' or 'decline'"));
    }

    const invite = await db.execute_single(
      `SELECT t.id, t.status, a.id AS assigner_id, a.company_name, a.contact_person_name
         FROM assigner_surveyor_team t
         JOIN assigners a ON a.id = t.assigner_id
        WHERE t.surveyor_id = ? AND t.assigner_id = ?`,
      [req.user.id, req.params.assignerId]
    );

    if (!invite) return res.status(404).json(notFound('Invitation not found'));

    if (invite.status !== 'pending') {
      return res.status(409).json(error(
        `You have already ${invite.status} this invitation`
      ));
    }

    const newStatus = action === 'accept' ? 'accepted' : 'declined';

    await db.execute_query(
      `UPDATE assigner_surveyor_team
          SET status = ?, responded_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [newStatus, invite.id]
    );

    const surveyor = await db.execute_single(
      'SELECT id, full_name FROM surveyors WHERE id = ?',
      [req.user.id]
    );

    notificationHelper
      .notifyAssignerInviteResponse(invite.assigner_id, surveyor, action === 'accept')
      .catch((err) => console.error('Invite response notification error:', err));

    // Report the real consequence back to the surveyor so the UI can explain it.
    const exclusion = await eligibility.isExcludedFromOpenBroadcast(req.user.id);

    res.json(success(
      { status: newStatus, excluded_from_open_broadcasts: exclusion.excluded },
      action === 'accept'
        ? (exclusion.excluded
            ? 'Invitation accepted. You will now receive work directly from your company instead of open survey requests.'
            : 'Invitation accepted. You will receive work from your company and can still take open survey requests.')
        : 'Invitation declined.'
    ));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  inviteMember,
  removeMember,
  listMyInvites,
  respondToInvite
};
