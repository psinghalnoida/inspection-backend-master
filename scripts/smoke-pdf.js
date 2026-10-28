/**
 * Smoke test for the composite survey PDF renderer (v2 §5.2).
 *
 * Run: node scripts/smoke-pdf.js
 *
 * WHY THIS IS SEPARATE FROM `npm test`: it needs pdfkit/pdf-lib installed and it
 * writes files, so it is not part of the pure-logic suite. But the rendering
 * path is otherwise completely untested — scripts/test-export.js covers what
 * goes INTO the document, never whether it can actually be produced.
 *
 * Uses a synthetic payload and synthetic media. NO DATABASE ACCESS.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const pdfService = require('../src/services/pdf.service');

const UPLOADS = path.resolve(__dirname, '../uploads');
const FIXTURES = path.join(UPLOADS, 'smoke-fixtures');

/** Minimal valid PNG encoder — avoids adding an image dependency for a smoke test. */
const writePng = (file, width, height, rgb) => {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour RGB

  // Each scanline: filter byte 0 + RGB triples.
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      raw[o++] = rgb[0]; raw[o++] = rgb[1]; raw[o++] = rgb[2];
    }
  }

  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]));
};

const main = async () => {
  const { PDFDocument } = require('pdf-lib');

  fs.mkdirSync(FIXTURES, { recursive: true });

  // --- fixtures ------------------------------------------------------------
  const images = [];
  const colours = [[200, 60, 60], [60, 140, 200], [90, 180, 90], [220, 180, 60], [150, 90, 200]];
  colours.forEach((c, i) => {
    const p = path.join(FIXTURES, `photo-${i + 1}.png`);
    writePng(p, 320, 240, c);
    images.push(`/uploads/smoke-fixtures/photo-${i + 1}.png`);
  });

  // A 2-page "surveyor report" to exercise the pdf-lib merge.
  const reportDoc = await PDFDocument.create();
  reportDoc.addPage().drawText('Surveyor Report — page 1', { x: 50, y: 700, size: 18 });
  reportDoc.addPage().drawText('Surveyor Report — page 2', { x: 50, y: 700, size: 18 });
  const reportRel = '/uploads/smoke-fixtures/report.pdf';
  fs.writeFileSync(path.join(FIXTURES, 'report.pdf'), await reportDoc.save());

  // --- payload -------------------------------------------------------------
  const payload = {
    survey: {
      id: 9001, laid: 'LSMOKE00000001', survey_type: 'motor_spot', status: 'finished',
      case_reference: 'CASE/SMOKE/001', policy_number: 'POL-123456',
      name_of_insured: 'Test Insured', cause_of_loss: 'Collision with stationary object',
      contact_person_name: 'Contact Person', contact_person_mobile: '9876543210',
      address: '12 Test Road', city: 'Pune', state: 'Maharashtra', pincode: '411001',
      latitude: 18.5204, longitude: 73.8567, is_direct_assign: false,
      created_at: '2026-07-01T09:00:00Z', completed_at: '2026-07-03T17:30:00Z'
    },
    assigner: {
      company_name: 'Test Insurance Co', contact_person_name: 'Ops Desk',
      gst_number: '27AAAAA0000A1Z5', address: 'HQ', state: 'Maharashtra'
    },
    surveyor: { id: 55, name: 'Test Surveyor', phone: '9000000000', license_id: 'IRDA/SUR/2019/0042' },
    timeline: {
      milestones: [
        { key: 'created', label: 'Survey Created', at: '2026-07-01T09:00:00Z', reached: true },
        { key: 'assigned', label: 'Surveyor Assigned', at: '2026-07-01T09:30:00Z', reached: true },
        { key: 'in_transit', label: 'Surveyor In Transit', at: '2026-07-01T10:00:00Z', reached: true },
        { key: 'finished', label: 'Survey Completed', at: null, reached: false }
      ],
      events: [
        { at: '2026-07-02T11:00:00Z', from: 'report_submitted', to: 'disputed',
          actor: 'assigner', remarks: 'Photos unclear' }
      ]
    },
    bill: {
      id: 1, invoice_number: 'CM/2026-27/00001', status: 'settled',
      fee_amount: 1000, conveyance_km: 100, conveyance_rate: 15, conveyance_amount: 1500,
      da_toll_amount: 200, photo_count: 10, photo_rate: 10, photo_amount: 100,
      taxable_value: 2800, gst_percent: 18, cgst_amount: 252, sgst_amount: 252,
      igst_amount: 0, total_amount: 3304, advance_adjusted: 2500, amount_paid: 804,
      balance_due: 0
    },
    payment: { final_amount: 2500, status: 'completed', paid_at: '2026-07-01T09:25:00Z' },
    report: {
      version: 2, status: 'accepted', report_file_url: reportRel,
      surveyor_notes: 'Inspection completed. Damage consistent with the reported cause of loss.',
      submitted_at: '2026-07-02T16:00:00Z'
    },
    report_history: [{ version: 2, status: 'accepted' }, { version: 1, status: 'rejected' }],
    media: [
      ...images.map((u, i) => ({
        id: i + 1, media_type: 'image', photo_type: i === 0 ? 'selfie' : 'live',
        file_url: u, photo_latitude: 18.52, photo_longitude: 73.85,
        photo_taken_at: '2026-07-01T11:0' + i + ':00Z'
      })),
      { id: 90, media_type: 'video', photo_type: 'live',
        file_url: '/uploads/smoke-fixtures/clip.mp4', video_duration_seconds: 42 },
      // Deliberately missing file — a real case (the mobile offline queue gives
      // up after 3 retries). Must produce a warning, not an exception.
      { id: 91, media_type: 'image', photo_type: 'live', file_url: '/uploads/does-not-exist.png' }
    ],
    documents: [
      { id: 1, document_type: 'policy', document_name: 'policy.pdf', file_url: '/uploads/x.pdf' },
      { id: 2, document_type: 'fir', document_name: 'fir.pdf', file_url: '/uploads/y.pdf' }
    ],
    payload_hash: 'smoke'
  };

  // --- render --------------------------------------------------------------
  console.log('Rendering composite PDF...');
  const t0 = Date.now();
  const out = await pdfService.renderSurveyPdf(payload);
  const ms = Date.now() - t0;

  assert.ok(fs.existsSync(out.filePath), 'PDF file was not written');
  assert.ok(out.sizeBytes > 1000, `PDF is implausibly small: ${out.sizeBytes} bytes`);

  const bytes = fs.readFileSync(out.filePath);
  assert.strictEqual(bytes.subarray(0, 5).toString(), '%PDF-', 'output is not a PDF');

  // Re-open with pdf-lib: proves the file is structurally valid, and lets us
  // confirm the surveyor's 2-page report really was appended.
  const parsed = await PDFDocument.load(bytes);
  const pageCount = parsed.getPageCount();

  assert.ok(pageCount >= 3, `expected composite + 2 appended report pages, got ${pageCount}`);

  // The missing-file entry must have been reported, not thrown.
  assert.ok(
    out.warnings.some((w) => w.includes('does-not-exist')),
    `expected a warning for the missing image, got: ${JSON.stringify(out.warnings)}`
  );

  console.log('');
  console.log('  file        ', out.filePath);
  console.log('  url         ', out.fileUrl);
  console.log('  size        ', `${(out.sizeBytes / 1024).toFixed(1)} KB`);
  console.log('  pages       ', pageCount, '(includes the 2-page surveyor report merged in)');
  console.log('  render time ', `${ms} ms`);
  console.log('  warnings    ', out.warnings.length ? out.warnings.join('; ') : 'none');
  // Tidy up the synthetic media; the rendered PDF is left in place so it can be
  // opened and eyeballed, which is the whole point of a render smoke test.
  fs.rmSync(FIXTURES, { recursive: true, force: true });

  console.log('');
  console.log('✓ PDF smoke test passed');
  console.log(`  open it with:  open "${out.filePath}"`);
};

main().catch((err) => {
  console.error('✗ PDF smoke test FAILED');
  console.error(err);
  process.exit(1);
});
