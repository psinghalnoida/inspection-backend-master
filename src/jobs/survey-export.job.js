/**
 * Survey Export Job
 * Spec: v2-spec.md §5.4
 *
 * Runs hourly. Two passes:
 *   1. generate the composite PDF for any survey that has become exportable
 *   2. drain the outbox (a no-op while cm_sync_enabled is false)
 *
 * Deliberately a cron over a MySQL outbox rather than a BullMQ worker: the queue
 * is only created when Redis is present, so a queue-only design would silently
 * stop working in a Redis-less environment.
 */

const cron = require('node-cron');
const db = require('../config/database');
const cmSync = require('../services/cmSync.service');

const BATCH = 25;

const runOnce = async () => {
  const generated = [];
  const failed = [];

  const candidates = await cmSync.findExportableSurveys(BATCH);

  for (const { id } of candidates) {
    try {
      const res = await cmSync.generateExport(id);
      if (res.ok && res.regenerated) generated.push(id);
      else if (!res.ok) failed.push({ id, reason: res.reason });
    } catch (err) {
      // One bad survey must never stop the batch.
      failed.push({ id, reason: err.message });
    }
  }

  const config = await cmSync.getSyncConfig();
  let pushed = 0;

  if (config.enabled) {
    const pending = await db.query_rows(
      `SELECT * FROM survey_export_documents
        WHERE file_url IS NOT NULL
          AND sync_status IN ('not_sent','failed','disabled')
          AND sync_attempts < ?
        ORDER BY updated_at ASC
        LIMIT ?`,
      [config.maxAttempts, BATCH]
    );

    for (const row of pending) {
      const res = await cmSync.pushExport(row);
      if (res.ok) pushed++;
    }
  }

  if (generated.length || failed.length || pushed) {
    console.log(
      `📄 Survey export: ${generated.length} generated, ${pushed} pushed, ${failed.length} failed` +
      (config.enabled ? '' : ' (main CM sync disabled)')
    );
  }
  for (const f of failed) {
    console.log(`   ↳ survey ${f.id}: ${f.reason}`);
  }

  return { generated: generated.length, pushed, failed };
};

const initSurveyExport = () => {
  // Hourly at :15, away from the 09:00/09:30 notification jobs.
  cron.schedule('15 * * * *', async () => {
    try {
      await runOnce();
    } catch (err) {
      console.error('Survey export job error:', err.message);
    }
  });

  console.log('✅ Survey export job scheduled (hourly at :15)');
};

module.exports = initSurveyExport;
module.exports.runOnce = runOnce;
