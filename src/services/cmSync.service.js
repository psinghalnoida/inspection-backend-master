/**
 * Main ClaimsMitra Sync
 * Spec: v2-spec.md §5.3 / §5.4
 *
 * STATUS: the outbound push is STUBBED. `cm_sync_enabled` defaults to false, so
 * exports are generated and queued but nothing leaves the building until main CM
 * publishes a contract (base URL, auth scheme, request schema, and whether they
 * key on our LAID or return their own id).
 *
 * The outbox (`survey_export_documents`) is deliberately in MySQL rather than
 * only in BullMQ: the queue is instantiated CONDITIONALLY — when Redis is absent
 * the app logs "Survey broadcast queue disabled" and carries on — so a
 * queue-only outbox would silently become fire-and-forget.
 */

const getDb = () => require('../config/database');
const exportService = require('./export.service');
const pdfService = require('./pdf.service');

const getSyncConfig = async () => {
  const rows = await getDb().query_rows(
    `SELECT config_key, config_value FROM system_config
      WHERE config_key IN ('cm_sync_enabled','cm_sync_base_url','cm_sync_api_key','cm_sync_max_attempts')`
  );
  const map = rows.reduce((acc, r) => ({ ...acc, [r.config_key]: r.config_value }), {});

  return {
    enabled: String(map.cm_sync_enabled).toLowerCase() === 'true',
    baseUrl: (map.cm_sync_base_url || '').trim(),
    apiKey: (map.cm_sync_api_key || '').trim(),
    maxAttempts: parseInt(map.cm_sync_max_attempts ?? 5, 10)
  };
};

/**
 * Generate (or regenerate) the composite PDF for a survey and record it.
 *
 * Idempotent by payload hash: if an export already exists for the same hash and
 * the file is still on disk, nothing is regenerated.
 *
 * @param {number} surveyId
 * @param {Object} [opts]
 * @param {boolean} [opts.force] regenerate even when the hash is unchanged
 */
const generateExport = async (surveyId, opts = {}) => {
  const db = getDb();

  const payload = await exportService.buildExportPayload(surveyId);
  if (payload.error) return { ok: false, reason: payload.error };

  const readiness = exportService.isReadyToExport(payload);
  if (!readiness.ready && !opts.force) {
    return { ok: false, reason: readiness.reason };
  }

  const existing = await db.execute_single(
    'SELECT * FROM survey_export_documents WHERE survey_id = ?',
    [surveyId]
  );

  const unchanged =
    existing &&
    existing.payload_hash === payload.payload_hash &&
    existing.file_url &&
    !opts.force;

  if (unchanged) {
    return { ok: true, regenerated: false, export: existing };
  }

  let rendered;
  try {
    rendered = await pdfService.renderSurveyPdf(payload);
  } catch (err) {
    // Record the failure rather than throwing it into a cron log where nobody
    // sees it. The admin surface reads generation_error.
    await db.execute_query(
      `INSERT INTO survey_export_documents
         (survey_id, laid, payload_hash, generation_error, sync_status)
       VALUES (?, ?, ?, ?, 'failed')
       ON DUPLICATE KEY UPDATE
         payload_hash = VALUES(payload_hash),
         generation_error = VALUES(generation_error),
         sync_status = 'failed',
         updated_at = NOW()`,
      [surveyId, payload.survey.laid, payload.payload_hash, err.message]
    );
    return { ok: false, reason: `PDF generation failed: ${err.message}` };
  }

  // A changed payload means whatever was sent before is stale — reset the sync
  // state so the drainer picks it up again.
  await db.execute_query(
    `INSERT INTO survey_export_documents
       (survey_id, laid, file_url, file_size_bytes, bill_id, report_version,
        payload_hash, generated_at, generation_error, sync_status, sync_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NULL, 'not_sent', 0)
     ON DUPLICATE KEY UPDATE
       laid = VALUES(laid),
       file_url = VALUES(file_url),
       file_size_bytes = VALUES(file_size_bytes),
       bill_id = VALUES(bill_id),
       report_version = VALUES(report_version),
       payload_hash = VALUES(payload_hash),
       generated_at = NOW(),
       generation_error = NULL,
       sync_status = 'not_sent',
       sync_attempts = 0,
       last_error = NULL,
       updated_at = NOW()`,
    [
      surveyId,
      payload.survey.laid,
      rendered.fileUrl,
      rendered.sizeBytes,
      payload.bill?.id || null,
      payload.report?.version || null,
      payload.payload_hash
    ]
  );

  const saved = await db.execute_single(
    'SELECT * FROM survey_export_documents WHERE survey_id = ?',
    [surveyId]
  );

  return { ok: true, regenerated: true, export: saved, warnings: rendered.warnings };
};

/**
 * Push one export to main ClaimsMitra.
 *
 * STUB. With cm_sync_enabled = false this marks the row 'disabled' and returns
 * without any network call, so the outbox does not accumulate spurious failures
 * while the contract does not exist.
 *
 * When the contract lands, the only part that should need writing is the fetch
 * below and the shape of `body`.
 */
const pushExport = async (exportRow) => {
  const db = getDb();
  const config = await getSyncConfig();

  if (!config.enabled || !config.baseUrl) {
    await db.execute_query(
      `UPDATE survey_export_documents
          SET sync_status = 'disabled',
              last_error = 'Main CM sync is not configured (cm_sync_enabled=false)',
              updated_at = NOW()
        WHERE id = ?`,
      [exportRow.id]
    );
    return { ok: false, skipped: true, reason: 'sync disabled' };
  }

  if (exportRow.sync_attempts >= config.maxAttempts) {
    return { ok: false, skipped: true, reason: 'max attempts reached' };
  }

  const body = {
    // LAID is the only external-facing identifier we own. Whether main CM keys
    // on it or returns their own id is the open question in v2-spec §8.
    laid: exportRow.laid,
    survey_id: exportRow.survey_id,
    payload_hash: exportRow.payload_hash,
    document_url: exportRow.file_url,
    generated_at: exportRow.generated_at
  };

  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/inspection/surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();

    if (!res.ok) {
      await db.execute_query(
        `UPDATE survey_export_documents
            SET sync_status = 'failed', sync_attempts = sync_attempts + 1,
                last_error = ?, updated_at = NOW()
          WHERE id = ?`,
        [`HTTP ${res.status}: ${text.slice(0, 500)}`, exportRow.id]
      );
      return { ok: false, reason: `HTTP ${res.status}` };
    }

    let externalId = null;
    try {
      externalId = JSON.parse(text)?.id || JSON.parse(text)?.external_id || null;
    } catch {
      // A non-JSON 2xx is still a success; we just have no id to store.
    }

    await db.execute_query(
      `UPDATE survey_export_documents
          SET sync_status = 'sent', sync_attempts = sync_attempts + 1,
              external_id = ?, sent_at = NOW(), last_error = NULL, updated_at = NOW()
        WHERE id = ?`,
      [externalId, exportRow.id]
    );

    return { ok: true, externalId };
  } catch (err) {
    await db.execute_query(
      `UPDATE survey_export_documents
          SET sync_status = 'failed', sync_attempts = sync_attempts + 1,
              last_error = ?, updated_at = NOW()
        WHERE id = ?`,
      [err.message, exportRow.id]
    );
    return { ok: false, reason: err.message };
  }
};

/**
 * Find surveys that are ready to export but have no current export row.
 * Cheap pre-filter — isReadyToExport() is the authority.
 */
const findExportableSurveys = async (limit = 25) =>
  getDb().query_rows(
    `SELECT s.id
       FROM surveys s
       JOIN survey_reports r ON r.survey_id = s.id AND r.status = 'accepted'
       LEFT JOIN survey_bills b ON b.survey_id = s.id AND b.status IN ('issued','settled')
       LEFT JOIN survey_export_documents e ON e.survey_id = s.id
      WHERE (s.is_direct_assign = TRUE OR b.status = 'settled')
        AND (e.id IS NULL OR e.file_url IS NULL)
      GROUP BY s.id
      LIMIT ?`,
    [limit]
  );

/**
 * Fire-and-forget export generation, triggered by the events that can complete
 * a survey's readiness (report accepted, bill settled, survey satisfied).
 *
 * Self-guarding: generateExport() no-ops when the survey is not yet ready, so it
 * is safe to call from any of those events. Never awaited and never throws into
 * the caller — the composite PDF is heavy and must not slow the request or fail
 * it. Errors land in survey_export_documents.generation_error, surfaced in the
 * admin export UI. The hourly cron remains the backstop.
 */
const triggerExportAsync = (surveyId, reason = '') => {
  Promise.resolve()
    .then(() => generateExport(surveyId))
    .then((res) => {
      if (res?.ok && res.regenerated) {
        console.log(`📄 Auto-generated export for survey ${surveyId}${reason ? ` (${reason})` : ''}`);
      } else if (res && !res.ok) {
        // The reason used to vanish here, so a satisfied survey with (say) an
        // unaccepted report produced no export and no trace. Log it.
        console.log(`⏸️  Export skipped for survey ${surveyId}${reason ? ` (${reason})` : ''}: ${res.reason}`);
      }
    })
    .catch((err) => console.error(`Auto-export failed for survey ${surveyId}:`, err.message));
};

module.exports = {
  getSyncConfig,
  generateExport,
  triggerExportAsync,
  pushExport,
  findExportableSurveys
};
