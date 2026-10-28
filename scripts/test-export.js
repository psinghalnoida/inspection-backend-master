/**
 * Self-check for the survey export logic (v2 §5).
 * Pure logic — no DB, no PDF toolchain. Run: node scripts/test-export.js
 *
 * Covers the two things that silently break the integration:
 *   - the readiness gate (exporting a survey whose numbers are not final)
 *   - the payload hash (never re-pushing, or re-pushing forever)
 */

const assert = require('assert');
const exp = require('../src/services/export.service');
const timeline = require('../src/services/timeline.service');

// ---------------------------------------------------------------- readiness

const base = {
  survey: { id: 1, laid: 'L2607221200', is_direct_assign: false },
  report: { version: 1, status: 'accepted', report_file_url: '/uploads/reports/a.pdf' },
  bill: { invoice_number: 'CM/2026-27/00001', status: 'settled', total_amount: 3304, balance_due: 0 }
};

assert.strictEqual(exp.isReadyToExport(base).ready, true, 'settled bill + accepted report is ready');

// The composite PDF contains the report, gated until the invoice is SETTLED —
// so the export carries the same gate.
assert.strictEqual(
  exp.isReadyToExport({ ...base, bill: { ...base.bill, status: 'issued', balance_due: 804 } }).ready,
  false, 'an unsettled invoice must block the export'
);

// FAIL-CLOSED: no invoice raised → not ready (report is gated until billed+settled).
assert.strictEqual(
  exp.isReadyToExport({ ...base, bill: null }).ready,
  false, 'no invoice raised → export not ready'
);

// Report must be ACCEPTED, not merely submitted — a rejected or pending report
// can still be replaced by a new version.
for (const status of ['submitted', 'rejected', 'resubmit_required']) {
  assert.strictEqual(
    exp.isReadyToExport({ ...base, report: { ...base.report, status } }).ready,
    false, `report status "${status}" must block the export`
  );
}

assert.strictEqual(exp.isReadyToExport({ ...base, report: null }).ready, false);

// Direct-assign surveys are never billed (§3.6), so the report alone gates them.
// If this ever required a bill, no direct-assign survey would ever export.
assert.strictEqual(
  exp.isReadyToExport({
    survey: { id: 2, laid: 'L2', is_direct_assign: true },
    report: { version: 1, status: 'accepted' },
    bill: null
  }).ready,
  true, 'direct-assign needs only an accepted report'
);

assert.strictEqual(exp.isReadyToExport(null).ready, false);
assert.strictEqual(exp.isReadyToExport({ error: 'Survey not found' }).ready, false);

// A blocked export must always explain itself — the admin UI shows this string.
assert.ok(exp.isReadyToExport({ ...base, report: null }).reason);
assert.ok(exp.isReadyToExport({ ...base, bill: null }).reason);
assert.ok(
  exp.isReadyToExport({ ...base, bill: { ...base.bill, status: 'issued', balance_due: 804 } }).reason
);

// ---------------------------------------------------------------- hash

const payload = {
  survey: { laid: 'L1', status: 'finished' },
  timeline: { milestones: [{ key: 'created', at: '2026-07-01T10:00:00Z' }] },
  bill: { invoice_number: 'CM/1', total_amount: 3304, status: 'settled', balance_due: 0 },
  payment: { final_amount: 2500, status: 'completed' },
  report: { version: 1, report_file_url: '/uploads/reports/a.pdf' },
  media: [{ id: 2 }, { id: 1 }],
  documents: [{ id: 5 }]
};

const h1 = exp.computePayloadHash(payload);

// Stable: same input, same hash. If this drifted, every run would look stale and
// the outbox would re-push forever.
assert.strictEqual(h1, exp.computePayloadHash(payload), 'hash must be deterministic');

// Media order must not matter — the query orders by created_at, and a re-upload
// can reorder rows without changing the substance.
assert.strictEqual(
  exp.computePayloadHash({ ...payload, media: [{ id: 1 }, { id: 2 }] }), h1,
  'media order must not change the hash'
);

// Each of these SHOULD invalidate the export.
const changes = {
  'new report version': { ...payload, report: { version: 2, report_file_url: '/uploads/reports/b.pdf' } },
  'late media arrival': { ...payload, media: [{ id: 1 }, { id: 2 }, { id: 3 }] },
  'new document': { ...payload, documents: [{ id: 5 }, { id: 6 }] },
  'bill re-issued': { ...payload, bill: { ...payload.bill, invoice_number: 'CM/2' } },
  'balance changed': { ...payload, bill: { ...payload.bill, balance_due: 100 } },
  'status changed': { ...payload, survey: { ...payload.survey, status: 'disputed' } },
  'milestone moved': { ...payload, timeline: { milestones: [{ key: 'created', at: '2026-07-02T10:00:00Z' }] } }
};
for (const [what, changed] of Object.entries(changes)) {
  assert.notStrictEqual(exp.computePayloadHash(changed), h1, `${what} must change the hash`);
}

// Events carry free-text remarks that can be edited without changing the
// substance of the document — they must NOT force a re-push.
assert.strictEqual(
  exp.computePayloadHash({ ...payload, timeline: { ...payload.timeline, events: [{ remarks: 'typo fix' }] } }),
  h1, 'editing an event remark must not invalidate the export'
);

// Degenerate payloads must hash, not throw.
assert.ok(exp.computePayloadHash({}));
assert.ok(exp.computePayloadHash({ survey: {}, media: null, documents: undefined }));

// ---------------------------------------------------------------- media split

const { images, videos } = exp.partitionMedia([
  { id: 1, media_type: 'image' },
  { id: 2, media_type: 'video' },
  { id: 3, media_type: 'image' },
  { id: 4 } // legacy row with no media_type — defaults to image in the schema
]);
assert.strictEqual(images.length, 3, 'a missing media_type counts as an image');
assert.strictEqual(videos.length, 1);
assert.deepStrictEqual(exp.partitionMedia([]), { images: [], videos: [] });
assert.deepStrictEqual(exp.partitionMedia(), { images: [], videos: [] });

// ---------------------------------------------------------------- timeline

const survey = {
  created_at: '2026-07-01T09:00:00Z',
  surveyor_assigned_at: '2026-07-01T09:30:00Z',
  in_transit_at: null,
  surveyor_arrived_at: null,
  visit_completed_at: null,
  report_submitted_at: null,
  completed_at: null
};

const history = [
  { new_status: 'location_detected', created_at: '2026-07-01T09:10:00Z', changed_by_type: 'system' },
  { new_status: 'in_transit', created_at: '2026-07-01T10:00:00Z', changed_by_type: 'surveyor' },
  // A second visit to the same status must NOT overwrite the first.
  { new_status: 'in_transit', created_at: '2026-07-02T10:00:00Z', changed_by_type: 'surveyor' }
];

const ms = timeline.buildMilestones(survey, history);
const byKey = Object.fromEntries(ms.map((m) => [m.key, m]));

assert.strictEqual(ms.length, timeline.MILESTONES.length, 'every milestone is always present');
assert.strictEqual(byKey.created.reached, true);
assert.strictEqual(byKey.assigned.at, survey.surveyor_assigned_at, 'the column wins when present');
assert.strictEqual(byKey.location_detected.at, '2026-07-01T09:10:00Z', 'history fills a column-less milestone');
assert.strictEqual(byKey.in_transit.at, '2026-07-01T10:00:00Z', 'FIRST occurrence of a status wins');
assert.strictEqual(byKey.finished.reached, false, 'an unreached milestone is present but not reached');
assert.strictEqual(byKey.finished.at, null);

// A survey with no history at all must still produce a full milestone list.
const bare = timeline.buildMilestones(survey, []);
assert.strictEqual(bare.length, timeline.MILESTONES.length);
assert.strictEqual(bare.find((m) => m.key === 'created').reached, true);

// Rows whose status was lost to the pre-029 ENUM gap ('' instead of a value)
// must not be treated as a milestone.
const withBlank = timeline.buildMilestones(survey, [{ new_status: '', created_at: 'x' }]);
assert.strictEqual(withBlank.find((m) => m.key === 'in_transit').reached, false);

assert.deepStrictEqual(timeline.buildEvents([]), []);
assert.deepStrictEqual(timeline.buildEvents(), []);

console.log('✓ export self-check passed');
