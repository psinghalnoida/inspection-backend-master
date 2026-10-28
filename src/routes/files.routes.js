/**
 * Authenticated file routes
 * Spec: v2-spec.md §4.4
 *
 * WHY THIS EXISTS: `app.use('/uploads', express.static(...))` serves every file
 * with no auth at all, and every client builds report URLs by stripping
 * `/api/v1` off the API base. A paywall enforced only in a JSON controller is
 * therefore theatre — an assigner who has ever loaded the survey detail already
 * holds a permanent, unauthenticated link to the PDF.
 *
 * Reports are served through here instead. Photos and documents stay on the
 * static mount for now: the gate is on the report, and moving everything would
 * mean touching every image URL in three clients for no security gain today.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { USER_ROLES } = require('../utils/constants');
const { checkReportAccess } = require('../services/reportAccess.service');

const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');

/**
 * GET /api/v1/files/reports/:surveyId/:filename
 *
 * Authenticated, authorised, and gated on the invoice balance.
 */
router.get('/reports/:surveyId/:filename', authenticate, async (req, res, next) => {
  try {
    const { surveyId, filename } = req.params;

    // Path traversal guard: resolve and confirm the result is still inside the
    // reports directory. `path.basename` alone is not enough on its own once
    // encoded separators are involved.
    const reportsDir = path.join(UPLOADS_ROOT, 'reports');
    const resolved = path.resolve(reportsDir, path.basename(filename));
    if (!resolved.startsWith(reportsDir + path.sep)) {
      return res.status(400).json({ success: false, message: 'Invalid file path' });
    }

    const survey = await db.execute_single(
      'SELECT id, assigner_id, surveyor_id FROM surveys WHERE id = ?',
      [surveyId]
    );
    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    // The file must actually belong to this survey — otherwise the surveyId in
    // the URL is just decoration and any report could be fetched through a
    // survey the caller happens to own.
    const report = await db.execute_single(
      `SELECT id FROM survey_reports
        WHERE survey_id = ? AND report_file_url LIKE ?`,
      [surveyId, `%${path.basename(filename)}`]
    );
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found for this survey' });
    }

    // Authorisation: admin sees everything; the assigner who owns the survey and
    // the surveyor who did it see theirs.
    const role = req.user.role;
    const isOwnerAssigner = role === USER_ROLES.ASSIGNER && Number(req.user.id) === Number(survey.assigner_id);
    const isOwnerSurveyor = role === USER_ROLES.SURVEYOR && Number(req.user.id) === Number(survey.surveyor_id);

    if (role !== USER_ROLES.ADMIN && !isOwnerAssigner && !isOwnerSurveyor) {
      return res.status(403).json({ success: false, message: 'You do not have access to this report' });
    }

    // The paywall applies to the assigner only. Admin needs it to do their job,
    // and the surveyor wrote it — withholding it from them would be nonsense.
    if (isOwnerAssigner) {
      const access = await checkReportAccess(surveyId);
      if (access.locked) {
        return res.status(402).json({
          success: false,
          message: access.reason,
          code: 'REPORT_PAYMENT_REQUIRED',
          data: {
            invoice_number: access.bill?.invoice_number,
            balance_due: access.bill?.balance_due
          }
        });
      }
    }

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ success: false, message: 'File not found on disk' });
    }

    return res.sendFile(resolved);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
