/**
 * Survey Export Service
 * Spec: v2-spec.md §5
 *
 * Assembles everything main ClaimsMitra should receive for one survey:
 * timeline, payment, media and the report — and computes the hash that decides
 * whether an already-generated export is stale.
 *
 * DELIBERATE SPLIT: this module is pure data assembly and contains NO pdfkit
 * calls. Rendering lives in pdf.service.js. That separation exists so the part
 * that decides WHAT goes into a tax-adjacent document can be unit-tested without
 * a PDF toolchain — see scripts/test-export.js.
 */

const crypto = require('crypto');

const getDb = () => require('../config/database');
const timeline = require('./timeline.service');

/**
 * Stable hash of everything that should force a regenerate + re-push.
 *
 * Survey data is NOT immutable after completion:
 *   - survey_reports.version increments on every resubmission
 *   - survey_photos grows when the mobile offline queue flushes, days later
 *   - a dispute can change the payment picture after `finished`
 *
 * Anything that would change the PDF must be in here, and nothing else — a
 * volatile field (a timestamp of "now", a row count that includes drafts) would
 * make every run look stale and re-push forever.
 *
 * @param {Object} payload the object returned by buildExportPayload
 */
const computePayloadHash = (payload) => {
  const material = {
    laid: payload.survey?.laid,
    status: payload.survey?.status,
    // Milestones only — `events` carries remarks that can be edited without
    // changing the substance of the document.
    milestones: (payload.timeline?.milestones || []).map((m) => [m.key, m.at]),
    bill: payload.bill
      ? [payload.bill.invoice_number, payload.bill.total_amount, payload.bill.status, payload.bill.balance_due]
      : null,
    advance: payload.payment ? [payload.payment.final_amount, payload.payment.status] : null,
    report: payload.report ? [payload.report.version, payload.report.report_file_url] : null,
    media: (payload.media || []).map((m) => m.id).sort((a, b) => a - b),
    documents: (payload.documents || []).map((d) => d.id).sort((a, b) => a - b)
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(material))
    .digest('hex');
};

/**
 * Gather everything for one survey.
 * @param {number} surveyId
 * @returns {Promise<Object|{error:string}>}
 */
const buildExportPayload = async (surveyId) => {
  const db = getDb();

  const survey = await db.execute_single(
    `SELECT s.*, a.company_name, a.contact_person_name, a.gst_number,
            a.address AS assigner_address, a.state AS assigner_state,
            sv.full_name AS surveyor_name, sv.phone AS surveyor_phone,
            sv.surveyor_license_id
       FROM surveys s
       JOIN assigners a ON a.id = s.assigner_id
       LEFT JOIN surveyors sv ON sv.id = s.surveyor_id
      WHERE s.id = ?`,
    [surveyId]
  );

  if (!survey) return { error: 'Survey not found' };

  const [tl, bill, payment, reports, media, documents] = await Promise.all([
    timeline.getTimeline(surveyId),
    db.execute_single(
      `SELECT * FROM survey_bills WHERE survey_id = ? AND status IN ('issued','settled')`,
      [surveyId]
    ),
    db.execute_single(
      `SELECT id, final_amount, base_amount, discount_amount, status, paid_at,
              gateway_transaction_id, payment_method
         FROM payments WHERE survey_id = ? AND status = 'completed'`,
      [surveyId]
    ),
    db.execute_query(
      `SELECT id, version, report_file_url, status, surveyor_notes, submitted_at
         FROM survey_reports WHERE survey_id = ? ORDER BY version DESC`,
      [surveyId]
    ),
    db.execute_query(
      `SELECT id, photo_type, media_type, file_url, thumbnail_url, video_thumbnail_url,
              video_duration_seconds, caption, photo_latitude, photo_longitude,
              photo_taken_at, created_at
         FROM survey_photos WHERE survey_id = ? ORDER BY created_at ASC`,
      [surveyId]
    ),
    db.execute_query(
      `SELECT id, document_type, document_name, file_url, created_at
         FROM survey_documents WHERE survey_id = ? ORDER BY created_at ASC`,
      [surveyId]
    )
  ]);

  const payload = {
    survey: {
      id: survey.id,
      laid: survey.laid,
      survey_type: survey.survey_type,
      status: survey.status,
      case_reference: survey.case_reference,
      policy_number: survey.policy_number,
      name_of_insured: survey.name_of_insured,
      cause_of_loss: survey.cause_of_loss,
      contact_person_name: survey.contact_person_name,
      contact_person_mobile: survey.contact_person_mobile,
      address: survey.address,
      city: survey.city,
      state: survey.state,
      pincode: survey.pincode,
      latitude: survey.latitude,
      longitude: survey.longitude,
      is_direct_assign: !!survey.is_direct_assign,
      created_at: survey.created_at,
      completed_at: survey.completed_at
    },
    assigner: {
      company_name: survey.company_name,
      contact_person_name: survey.contact_person_name,
      gst_number: survey.gst_number,
      address: survey.assigner_address,
      state: survey.assigner_state
    },
    surveyor: survey.surveyor_id
      ? {
          id: survey.surveyor_id,
          name: survey.surveyor_name,
          phone: survey.surveyor_phone,
          license_id: survey.surveyor_license_id
        }
      : null,
    timeline: tl,
    bill: bill || null,
    payment: payment || null,
    // The latest version is the one that counts; earlier ones are listed for the
    // audit trail but only the current file is embedded.
    report: reports[0] || null,
    report_history: reports.map((r) => ({
      version: r.version, status: r.status, submitted_at: r.submitted_at
    })),
    // Videos cannot be embedded in a PDF — they are listed with their thumbnail
    // and a link instead. video_thumbnail_url is nullable, so it may be absent.
    media: media || [],
    documents: documents || []
  };

  payload.payload_hash = computePayloadHash(payload);
  return payload;
};

/**
 * Is this survey ready to export?
 *
 * v2 §5.4: generate when the bill is SETTLED and the report ACCEPTED — the PDF
 * The composite PDF contains the report, which is gated until the invoice is
 * settled (see reportAccess.service). The export file lives on the public
 * /uploads/exports mount, so it must carry the SAME gate — otherwise it would
 * leak a report the assigner is not yet allowed to see. So for a broadcast
 * survey the export is ready only once its invoice is SETTLED.
 *
 * Direct-assign surveys are never billed (§3.6), so the report alone gates them.
 */
const isReadyToExport = (payload) => {
  if (!payload || payload.error) return { ready: false, reason: 'Survey not found' };

  const report = payload.report;
  if (!report) return { ready: false, reason: 'No report has been submitted' };
  if (report.status !== 'accepted') {
    return { ready: false, reason: `Report is ${report.status}, not accepted` };
  }

  if (payload.survey.is_direct_assign) return { ready: true, reason: null };

  if (!payload.bill) return { ready: false, reason: 'No invoice has been raised yet' };
  if (payload.bill.status !== 'settled') {
    return { ready: false, reason: `Invoice ${payload.bill.invoice_number} is not settled` };
  }

  return { ready: true, reason: null };
};

/**
 * Split media into what a PDF can embed and what it cannot.
 * Images are embedded; videos get a thumbnail-and-link entry.
 */
const partitionMedia = (media = []) => {
  const images = [];
  const videos = [];

  for (const m of media) {
    if (m.media_type === 'video') videos.push(m);
    else images.push(m);
  }

  return { images, videos };
};

module.exports = {
  computePayloadHash,
  buildExportPayload,
  isReadyToExport,
  partitionMedia
};
