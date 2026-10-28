/**
 * Read-only: explain why a survey's composite-PDF export did or didn't generate.
 * No writes, no PDF rendering — safe to run anywhere with prod DB access.
 *
 *   node scripts/diagnose-export.js          # newest finished survey
 *   node scripts/diagnose-export.js 77        # a specific survey id
 *
 * The line that matters is ">>> isReadyToExport" — its `reason` is the exact
 * gate that's blocking generation (report not accepted, no invoice, not settled…).
 */

const db = require('../src/config/database');
const exportService = require('../src/services/export.service');

(async () => {
  let surveyId = process.argv[2];
  if (!surveyId) {
    const row = await db.execute_single(
      "SELECT id FROM surveys WHERE status IN ('finished','completed','report_submitted') ORDER BY id DESC LIMIT 1"
    );
    surveyId = row && row.id;
  }
  if (!surveyId) { console.error('No survey found.'); process.exit(1); }

  const s = await db.execute_single(
    "SELECT id, laid, status, is_direct_assign, surveyor_id, completed_at FROM surveys WHERE id=?", [surveyId]);
  console.log('SURVEY        :', JSON.stringify(s));

  const reports = await db.query_rows(
    "SELECT version, status, submitted_at FROM survey_reports WHERE survey_id=? ORDER BY version DESC", [surveyId]);
  console.log('REPORTS       :', JSON.stringify(reports));

  const bill = await db.execute_single(
    "SELECT invoice_number, status, total_amount, balance_due, settled_at FROM survey_bills WHERE survey_id=? AND status<>'cancelled' ORDER BY id DESC LIMIT 1", [surveyId]);
  console.log('BILL          :', JSON.stringify(bill) || 'none');

  const pay = await db.execute_single(
    "SELECT id, status, final_amount, base_amount FROM payments WHERE survey_id=? AND status='completed' LIMIT 1", [surveyId]);
  console.log('PAYMENT(done) :', JSON.stringify(pay) || 'none');

  const exp = await db.execute_single(
    "SELECT file_url, file_size_bytes, generated_at, generation_error, sync_status FROM survey_export_documents WHERE survey_id=?", [surveyId]);
  console.log('EXPORT ROW    :', exp ? JSON.stringify(exp) : 'NONE (never got past the readiness gate)');

  const payload = await exportService.buildExportPayload(surveyId);
  if (payload.error) {
    console.log('>>> payload error:', payload.error);
  } else {
    const r = exportService.isReadyToExport(payload);
    console.log('>>> isReadyToExport:', JSON.stringify(r));
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
