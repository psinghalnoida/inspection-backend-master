/**
 * Composite Survey PDF
 * Spec: v2-spec.md §5.2
 *
 * pdfkit composes the new pages; pdf-lib appends the surveyor's own uploaded
 * report PDF at the end. Both are pure JS and small.
 *
 * Considered and rejected: Puppeteer/headless Chrome would have let us reuse the
 * existing EJS view engine for HTML->PDF, but it adds ~300 MB of Chromium to a
 * Railway container for one feature.
 *
 * ⚠️ NEVER call this inline in a request. Composing 20-40 photos is CPU and
 * memory heavy — it runs from the export job.
 */

const fs = require('fs');
const path = require('path');

const { partitionMedia } = require('./export.service');

const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');
const EXPORTS_DIR = path.join(UPLOADS_ROOT, 'exports');

// pdfkit's default page is 595.28 x 841.89 (A4) with a 50pt margin.
const MARGIN = 50;
const CONTENT_WIDTH = 595.28 - MARGIN * 2;

const INR = (n) =>
  `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * Resolve a stored file_url ('/uploads/photos/x.jpg') to an absolute path.
 * Returns null when the file is missing — media referenced by a row whose file
 * never uploaded is a real case (the mobile offline queue gives up after 3
 * retries), and a missing file must not abort the whole document.
 */
const resolveUpload = (fileUrl) => {
  if (!fileUrl) return null;
  const rel = String(fileUrl).replace(/^\/?uploads\//, '');
  const abs = path.resolve(UPLOADS_ROOT, rel);
  if (!abs.startsWith(UPLOADS_ROOT + path.sep)) return null; // traversal guard
  return fs.existsSync(abs) ? abs : null;
};

const heading = (doc, text) => {
  if (doc.y > 700) doc.addPage();
  doc.moveDown(0.8);
  // x MUST be explicit. pdfkit remembers the x of the last positioned text()
  // call, so after a row() the heading would otherwise start at the value
  // column and drift right down the page.
  doc.fontSize(13).fillColor('#1A1A1A').text(text, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + CONTENT_WIDTH, doc.y + 2)
    .strokeColor('#DDDDDD').stroke();
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#333333');
};

/** Full-width paragraph. Same x-retention caveat as heading(). */
const para = (doc, text, color = '#1A1A1A', size = 9) => {
  if (doc.y > 760) doc.addPage();
  doc.fontSize(size).fillColor(color).text(text, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.35);
};

/** Two-column label/value row. */
const row = (doc, label, value) => {
  if (doc.y > 760) doc.addPage();
  const y = doc.y;
  doc.fontSize(9).fillColor('#666666').text(label, MARGIN, y, { width: 160 });
  doc.fontSize(9).fillColor('#1A1A1A')
    .text(value === null || value === undefined || value === '' ? '—' : String(value),
      MARGIN + 170, y, { width: CONTENT_WIDTH - 170 });
  doc.moveDown(0.35);
};

/** Right-aligned money row for the invoice block. */
const moneyRow = (doc, label, value, bold = false) => {
  if (doc.y > 760) doc.addPage();
  const y = doc.y;
  doc.fontSize(bold ? 10 : 9).fillColor(bold ? '#1A1A1A' : '#444444')
    .text(label, MARGIN, y, { width: CONTENT_WIDTH - 140 });
  doc.fontSize(bold ? 10 : 9).fillColor('#1A1A1A')
    .text(value, MARGIN + CONTENT_WIDTH - 140, y, { width: 140, align: 'right' });
  doc.moveDown(0.35);
};

/**
 * Render the composite PDF for a payload.
 * @param {Object} payload from export.service.buildExportPayload
 * @returns {Promise<{ filePath:string, fileUrl:string, sizeBytes:number, warnings:string[] }>}
 */
const renderSurveyPdf = async (payload) => {
  // Required lazily so the rest of the backend still boots if the PDF deps are
  // not installed yet — the export job is the only consumer.
  const PDFDocument = require('pdfkit');
  const { PDFDocument: LibPDFDocument } = require('pdf-lib');

  const warnings = [];
  const laid = payload.survey.laid || `survey-${payload.survey.id}`;

  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const filename = `${laid.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  const filePath = path.join(EXPORTS_DIR, filename);

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  // ---- Header -------------------------------------------------------------
  doc.fontSize(18).fillColor('#1A1A1A').text('ClaimsMitra Survey Record');
  doc.fontSize(11).fillColor('#666666').text(`LA ID: ${laid}`);
  doc.fontSize(9).fillColor('#999999').text(`Generated ${fmtDate(new Date())}`);
  doc.moveDown(0.5);

  // ---- Survey -------------------------------------------------------------
  heading(doc, 'Survey Details');
  const s = payload.survey;
  row(doc, 'Case Reference', s.case_reference);
  row(doc, 'Survey Type', (s.survey_type || '').replace(/_/g, ' '));
  row(doc, 'Status', s.status);
  row(doc, 'Policy Number', s.policy_number);
  row(doc, 'Insured Name', s.name_of_insured);
  row(doc, 'Cause of Loss', s.cause_of_loss);
  row(doc, 'Location', [s.address, s.city, s.state, s.pincode].filter(Boolean).join(', '));
  if (s.latitude && s.longitude) row(doc, 'Coordinates', `${s.latitude}, ${s.longitude}`);

  // ---- Parties ------------------------------------------------------------
  heading(doc, 'Parties');
  row(doc, 'Assigner', payload.assigner?.company_name || payload.assigner?.contact_person_name);
  row(doc, 'Assigner GSTIN', payload.assigner?.gst_number);
  row(doc, 'Surveyor', payload.surveyor?.name);
  row(doc, 'Surveyor Licence', payload.surveyor?.license_id);
  row(doc, 'Contact', `${s.contact_person_name || '—'} ${s.contact_person_mobile || ''}`.trim());

  // ---- Timeline -----------------------------------------------------------
  heading(doc, 'Timeline');
  for (const m of payload.timeline?.milestones || []) {
    row(doc, m.label, m.reached ? fmtDate(m.at) : 'Not reached');
  }

  const extraEvents = (payload.timeline?.events || []).filter(
    (e) => ['disputed', 'not_resolved', 'escalated', 'cancelled'].includes(e.to)
  );
  if (extraEvents.length) {
    heading(doc, 'Exceptions');
    for (const e of extraEvents) {
      row(doc, fmtDate(e.at), `${e.from || '?'} -> ${e.to}${e.remarks ? ` (${e.remarks})` : ''}`);
    }
  }

  // ---- Payment ------------------------------------------------------------
  heading(doc, 'Payment');
  if (s.is_direct_assign) {
    para(doc, 'Direct assignment — no platform charge applies to this survey.', '#444444');
  } else if (payload.bill) {
    const b = payload.bill;
    row(doc, 'Invoice Number', b.invoice_number);
    row(doc, 'Invoice Status', b.status);
    doc.moveDown(0.2);
    moneyRow(doc, 'Professional Fee', INR(b.fee_amount));
    moneyRow(doc, `Conveyance (${Number(b.conveyance_km).toFixed(2)} km @ ${INR(b.conveyance_rate)}/km)`, INR(b.conveyance_amount));
    moneyRow(doc, 'DA / Toll', INR(b.da_toll_amount));
    moneyRow(doc, `Photos (${b.photo_count} @ ${INR(b.photo_rate)})`, INR(b.photo_amount));
    moneyRow(doc, 'Taxable Value', INR(b.taxable_value), true);
    if (Number(b.igst_amount) > 0) {
      moneyRow(doc, `IGST @ ${Number(b.gst_percent)}%`, INR(b.igst_amount));
    } else {
      moneyRow(doc, `CGST @ ${Number(b.gst_percent) / 2}%`, INR(b.cgst_amount));
      moneyRow(doc, `SGST @ ${Number(b.gst_percent) / 2}%`, INR(b.sgst_amount));
    }
    moneyRow(doc, 'Total (incl. GST)', INR(b.total_amount), true);
    moneyRow(doc, 'Less: advance paid', `- ${INR(b.advance_adjusted)}`);
    if (Number(b.amount_paid) > 0) moneyRow(doc, 'Less: balance paid', `- ${INR(b.amount_paid)}`);
    const bal = Number(b.balance_due) || 0;
    moneyRow(doc, bal < 0 ? 'Credit to assigner' : 'Balance', INR(Math.abs(bal)), true);
  } else if (payload.payment) {
    row(doc, 'Advance Paid', INR(payload.payment.final_amount));
    row(doc, 'Paid At', fmtDate(payload.payment.paid_at));
    row(doc, 'Gateway Reference', payload.payment.gateway_transaction_id);
    doc.moveDown(0.2);
    para(doc, 'No itemised invoice was raised for this survey.', '#996600');
  } else {
    para(doc, 'No payment recorded.', '#444444');
  }

  // ---- Report metadata ----------------------------------------------------
  heading(doc, 'Report');
  if (payload.report) {
    row(doc, 'Version', payload.report.version);
    row(doc, 'Status', payload.report.status);
    row(doc, 'Submitted', fmtDate(payload.report.submitted_at));
    if (payload.report.surveyor_notes) {
      doc.moveDown(0.2);
      para(doc, 'Surveyor notes:', '#666666');
      para(doc, payload.report.surveyor_notes);
    }
  } else {
    para(doc, 'No report on record.', '#444444');
  }

  // ---- Media --------------------------------------------------------------
  const { images, videos } = partitionMedia(payload.media);

  // Count what can actually be embedded, not what the DB rows claim. A record
  // document that says "Photographs (6)" above five images is misleading, and
  // missing files are a real case (the mobile offline queue gives up after 3
  // retries). Any shortfall is spelled out under the grid.
  const embeddable = images.filter((i) => resolveUpload(i.file_url));
  const missingCount = images.length - embeddable.length;

  heading(doc, `Photographs (${embeddable.length}${missingCount ? ` of ${images.length}` : ''})`);
  if (images.length === 0) {
    para(doc, 'No photographs on record.', '#444444');
  } else {
    // 2-up grid.
    const cellW = (CONTENT_WIDTH - 12) / 2;
    const cellH = 150;
    let col = 0;

    for (const img of images) {
      const abs = resolveUpload(img.file_url);
      if (!abs) {
        warnings.push(`Missing image file: ${img.file_url}`);
        continue;
      }

      if (col === 0 && doc.y + cellH + 24 > 780) doc.addPage();
      const x = MARGIN + col * (cellW + 12);
      const y = doc.y;

      try {
        doc.image(abs, x, y, { fit: [cellW, cellH], align: 'center', valign: 'center' });
      } catch (imgErr) {
        // A corrupt or unsupported image must not kill the whole document.
        warnings.push(`Unreadable image ${img.file_url}: ${imgErr.message}`);
        continue;
      }

      const caption = [
        img.photo_type,
        img.photo_taken_at ? fmtDate(img.photo_taken_at) : null,
        img.photo_latitude && img.photo_longitude ? `${img.photo_latitude}, ${img.photo_longitude}` : null
      ].filter(Boolean).join(' · ');

      doc.fontSize(7).fillColor('#666666')
        .text(caption, x, y + cellH + 2, { width: cellW, height: 18, ellipsis: true });

      if (col === 1) doc.y = y + cellH + 22;
      else doc.y = y;
      col = col === 0 ? 1 : 0;
    }
    if (col === 1) doc.y += cellH + 22; // close a half-finished row

    if (missingCount > 0) {
      doc.moveDown(0.4);
      para(
        doc,
        `${missingCount} photograph${missingCount === 1 ? '' : 's'} could not be included — `
        + 'the file was not found on the server. See Generation Notes.',
        '#996600', 8
      );
    }
  }

  if (videos.length) {
    // Videos cannot be embedded in a PDF — list them with a link so the record
    // is complete and the reader knows they exist.
    heading(doc, `Videos (${videos.length})`);
    for (const v of videos) {
      row(doc, v.photo_type || 'video',
        `${v.file_url}${v.video_duration_seconds ? ` (${v.video_duration_seconds}s)` : ''}`);
    }
  }

  if (payload.documents?.length) {
    heading(doc, `Documents (${payload.documents.length})`);
    for (const d of payload.documents) {
      row(doc, (d.document_type || 'document').replace(/_/g, ' '), d.document_name || d.file_url);
    }
  }

  if (warnings.length) {
    heading(doc, 'Generation Notes');
    for (const w of warnings) para(doc, `• ${w}`, '#996600', 8);
  }

  doc.end();
  await done;

  let finalBuffer = Buffer.concat(chunks);

  // ---- Append the surveyor's own report PDF -------------------------------
  const reportAbs = resolveUpload(payload.report?.report_file_url);
  if (reportAbs && reportAbs.toLowerCase().endsWith('.pdf')) {
    try {
      const merged = await LibPDFDocument.create();
      const base = await LibPDFDocument.load(finalBuffer);
      const attached = await LibPDFDocument.load(fs.readFileSync(reportAbs));

      const basePages = await merged.copyPages(base, base.getPageIndices());
      basePages.forEach((p) => merged.addPage(p));
      const attachedPages = await merged.copyPages(attached, attached.getPageIndices());
      attachedPages.forEach((p) => merged.addPage(p));

      finalBuffer = Buffer.from(await merged.save());
    } catch (mergeErr) {
      // A malformed surveyor upload must not lose the composite document.
      warnings.push(`Could not append the surveyor report: ${mergeErr.message}`);
    }
  } else if (payload.report?.report_file_url) {
    warnings.push('Surveyor report is not an appendable PDF; it is referenced but not embedded.');
  }

  fs.writeFileSync(filePath, finalBuffer);

  return {
    filePath,
    fileUrl: `/uploads/exports/${filename}`,
    sizeBytes: finalBuffer.length,
    warnings
  };
};

module.exports = { renderSurveyPdf, resolveUpload, EXPORTS_DIR };
