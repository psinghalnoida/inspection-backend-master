/**
 * Admin Export Controller
 * Spec: v2-spec.md §5
 *
 * Visibility and manual control over the composite survey PDF and the outbound
 * sync to main ClaimsMitra.
 */

const db = require('../../config/database');
const { success, error, notFound, paginated } = require('../../utils/response');
const { parsePagination } = require('../../utils/helpers');
const cmSync = require('../../services/cmSync.service');
const exportService = require('../../services/export.service');
const timelineService = require('../../services/timeline.service');

/**
 * List exports and their sync state.
 * GET /api/v1/admin/exports?sync_status=
 */
const listExports = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { sync_status } = req.query;

    let where = '1=1';
    const params = [];
    if (sync_status) { where += ' AND e.sync_status = ?'; params.push(sync_status); }

    const [rows, countRow] = await Promise.all([
      db.query_rows(
        `SELECT e.*, s.survey_type, s.status AS survey_status, a.company_name
           FROM survey_export_documents e
           JOIN surveys s ON s.id = e.survey_id
           JOIN assigners a ON a.id = s.assigner_id
          WHERE ${where}
          ORDER BY e.updated_at DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      db.query_single(
        `SELECT COUNT(*) AS total FROM survey_export_documents e WHERE ${where}`,
        params
      )
    ]);

    const config = await cmSync.getSyncConfig();
    res.json({
      ...paginated(rows, { page, limit, total: countRow.total },
        config.enabled ? 'Success' : 'Main ClaimsMitra sync is disabled — exports are generated but not pushed.'),
      // Same flag GET /admin/surveys/:id/export returns. Without it the console
      // has to string-match `message` to know sync is off.
      sync_enabled: config.enabled
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Export state for one survey, including why it is not ready if it is not.
 * GET /api/v1/admin/surveys/:id/export
 */
const getSurveyExport = async (req, res, next) => {
  try {
    const row = await db.execute_single(
      'SELECT * FROM survey_export_documents WHERE survey_id = ?',
      [req.params.id]
    );

    const payload = await exportService.buildExportPayload(req.params.id);
    if (payload.error) return res.status(404).json(notFound(payload.error));

    const readiness = exportService.isReadyToExport(payload);
    const config = await cmSync.getSyncConfig();

    res.json(success({
      export: row || null,
      ready: readiness.ready,
      not_ready_reason: readiness.reason,
      // Non-null when the stored export predates the current data, i.e. media or
      // a new report version arrived after it was generated.
      stale: !!(row && row.payload_hash && row.payload_hash !== payload.payload_hash),
      current_payload_hash: payload.payload_hash,
      sync_enabled: config.enabled
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Generate or regenerate on demand.
 * POST /api/v1/admin/surveys/:id/export  { force?: true }
 */
const generateSurveyExport = async (req, res, next) => {
  try {
    const result = await cmSync.generateExport(req.params.id, { force: !!req.body?.force });

    if (!result.ok) return res.status(400).json(error(result.reason));

    res.json(success(
      { export: result.export, warnings: result.warnings || [] },
      result.regenerated ? 'Export generated' : 'Export is already up to date'
    ));
  } catch (err) {
    next(err);
  }
};

/**
 * Retry a failed push.
 * POST /api/v1/admin/exports/:id/push
 */
const pushSurveyExport = async (req, res, next) => {
  try {
    const row = await db.execute_single(
      'SELECT * FROM survey_export_documents WHERE id = ?',
      [req.params.id]
    );
    if (!row) return res.status(404).json(notFound('Export not found'));
    if (!row.file_url) return res.status(400).json(error('Generate the document before pushing it'));

    const result = await cmSync.pushExport(row);

    if (!result.ok) {
      return res.status(result.skipped ? 400 : 502).json(error(
        result.reason === 'sync disabled'
          ? 'Main ClaimsMitra sync is disabled. Enable cm_sync_enabled and set the base URL in Settings.'
          : `Push failed: ${result.reason}`
      ));
    }

    res.json(success({ external_id: result.externalId }, 'Pushed to main ClaimsMitra'));
  } catch (err) {
    next(err);
  }
};

/**
 * Canonical survey timeline — the audit trail. (v2 §5.5)
 * GET /api/v1/admin/surveys/:id/timeline
 */
const getSurveyTimeline = async (req, res, next) => {
  try {
    const tl = await timelineService.getTimeline(req.params.id);
    if (!tl) return res.status(404).json(notFound('Survey not found'));
    res.json(success(tl));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listExports,
  getSurveyExport,
  generateSurveyExport,
  pushSurveyExport,
  getSurveyTimeline
};
