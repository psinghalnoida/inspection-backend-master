/**
 * Self-check for the billing arithmetic (v2 §3).
 * Pure logic, no DB needed. Run: node scripts/test-billing.js
 *
 * This covers a money path, so it is deliberately thorough: rounding, the
 * GST split, the advance credit, and the payout base are all places where a
 * quiet drift produces wrong invoices rather than a crash.
 */

const assert = require('assert');
const b = require('../src/services/billing.service');

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${msg}: expected ${expected}, got ${actual}`);

// --- the worked example from v2.md -------------------------------------------
// Fee 1000 + Conveyance 100km @ 15 = 1500 + DA/Toll 200 + Photos 10 @ 10 = 100
// => 2800 taxable, +18% GST => 3304 total.

const example = b.computeBill({
  fee_amount: 1000,
  conveyance_km: 100,
  conveyance_rate: 15,
  da_toll_amount: 200,
  photo_count: 10,
  photo_rate: 10,
  gst_percent: 18,
  is_intra_state: true,
  advance_adjusted: 0,
  amount_paid: 0
});

near(example.conveyance_amount, 1500, 'conveyance');
near(example.photo_amount, 100, 'photos');
near(example.taxable_value, 2800, 'taxable value');
near(example.gst_total, 504, 'GST');
near(example.total_amount, 3304, 'total with GST');
near(example.balance_due, 3304, 'balance with no advance');

// Intra-state splits into CGST + SGST, no IGST.
near(example.cgst_amount, 252, 'CGST');
near(example.sgst_amount, 252, 'SGST');
near(example.igst_amount, 0, 'IGST must be zero intra-state');

// --- the advance is CREDITED, not added --------------------------------------
// This is the whole point of v2 §3.1. If it ever becomes additive the assigner
// is charged roughly twice.

const withAdvance = b.computeBill({
  ...{ fee_amount: 1000, conveyance_km: 100, conveyance_rate: 15, da_toll_amount: 200,
       photo_count: 10, photo_rate: 10, gst_percent: 18, is_intra_state: true },
  advance_adjusted: 2500,
  amount_paid: 0
});
near(withAdvance.total_amount, 3304, 'total is unaffected by the advance');
near(withAdvance.balance_due, 804, 'balance = total - advance');

// Advance larger than the invoice => NEGATIVE balance, i.e. we owe the assigner.
// This is the "admin has to pay assigner" direction in v2 §4.2 and must not be
// clamped to zero, or the refund case disappears silently.
const overpaid = b.computeBill({
  fee_amount: 500, conveyance_km: 0, conveyance_rate: 15, da_toll_amount: 0,
  photo_count: 0, photo_rate: 10, gst_percent: 18, is_intra_state: true,
  advance_adjusted: 2500, amount_paid: 0
});
assert.ok(overpaid.balance_due < 0, 'overpayment must produce a negative balance');
near(overpaid.balance_due, 590 - 2500, 'refund owed');

// Partial payment reduces the balance.
const partial = b.computeBill({
  fee_amount: 1000, conveyance_km: 100, conveyance_rate: 15, da_toll_amount: 200,
  photo_count: 10, photo_rate: 10, gst_percent: 18, is_intra_state: true,
  advance_adjusted: 2500, amount_paid: 300
});
near(partial.balance_due, 504, 'balance = total - advance - paid');

// --- inter-state => IGST -----------------------------------------------------

const inter = b.computeBill({
  fee_amount: 1000, conveyance_km: 100, conveyance_rate: 15, da_toll_amount: 200,
  photo_count: 10, photo_rate: 10, gst_percent: 18, is_intra_state: false,
  advance_adjusted: 0, amount_paid: 0
});
near(inter.igst_amount, 504, 'IGST is the full rate');
near(inter.cgst_amount, 0, 'no CGST inter-state');
near(inter.sgst_amount, 0, 'no SGST inter-state');
near(inter.total_amount, 3304, 'total is identical either way');

// --- the CGST/SGST halves must re-add EXACTLY to the GST total ---------------
// Halving and rounding twice can lose or gain a paisa. On a tax document that
// is a real defect, so check odd amounts specifically.

for (const taxable of [0.01, 3.33, 99.99, 1234.57, 7777.77, 2800.05]) {
  const r = b.computeBill({
    fee_amount: taxable, conveyance_km: 0, conveyance_rate: 0, da_toll_amount: 0,
    photo_count: 0, photo_rate: 0, gst_percent: 18, is_intra_state: true,
    advance_adjusted: 0, amount_paid: 0
  });
  assert.strictEqual(
    Math.round((r.cgst_amount + r.sgst_amount) * 100),
    Math.round(r.gst_total * 100),
    `CGST + SGST must equal the GST total for taxable ${taxable}`
  );
  assert.strictEqual(
    Math.round((r.taxable_value + r.gst_total) * 100),
    Math.round(r.total_amount * 100),
    `taxable + GST must equal total for taxable ${taxable}`
  );
}

// --- degenerate / hostile inputs ---------------------------------------------

const zero = b.computeBill({
  fee_amount: 0, conveyance_km: 0, conveyance_rate: 0, da_toll_amount: 0,
  photo_count: 0, photo_rate: 0, gst_percent: 18, is_intra_state: true,
  advance_adjusted: 0, amount_paid: 0
});
near(zero.total_amount, 0, 'an all-zero bill totals zero');

const junk = b.computeBill({
  fee_amount: undefined, conveyance_km: null, conveyance_rate: 'abc',
  da_toll_amount: NaN, photo_count: -5, photo_rate: undefined,
  gst_percent: 18, is_intra_state: true, advance_adjusted: undefined, amount_paid: null
});
near(junk.total_amount, 0, 'garbage inputs must coerce to 0, never NaN');
assert.strictEqual(junk.photo_count, 0, 'negative photo count clamps to 0');
assert.ok(!Number.isNaN(junk.balance_due), 'balance must never be NaN');

// Zero GST is legitimate (exempt supply) and must not divide by zero.
const noGst = b.computeBill({
  fee_amount: 1000, conveyance_km: 0, conveyance_rate: 0, da_toll_amount: 0,
  photo_count: 0, photo_rate: 0, gst_percent: 0, is_intra_state: true,
  advance_adjusted: 0, amount_paid: 0
});
near(noGst.total_amount, 1000, 'zero GST leaves the taxable value untouched');

// --- surveyor payout (v2 §4.5) -----------------------------------------------
// ONE percentage on the whole bill, computed on the PRE-GST taxable value.
// Paying out on the GST-inclusive total would hand the surveyor a share of
// collected tax.

near(b.surveyorPayoutFor(2800, 25), 2100, 'surveyor gets 75% of the taxable value');
assert.notStrictEqual(
  b.surveyorPayoutFor(3304, 25), b.surveyorPayoutFor(2800, 25),
  'payout must be computed pre-GST, not on the GST-inclusive total'
);
near(b.surveyorPayoutFor(2800, 0), 2800, 'zero commission pays out everything');
near(b.surveyorPayoutFor(2800, 100), 0, 'full commission pays out nothing');
near(b.surveyorPayoutFor(2800, 40), 1680, 'commission is dynamic, not hardcoded 25');

// --- Indian financial year ---------------------------------------------------
// FY runs 1 Apr - 31 Mar. Getting this wrong restarts the invoice sequence on
// the wrong date, which is a compliance problem, not a cosmetic one.

assert.strictEqual(b.fiscalYearOf(new Date('2026-04-01T00:00:00')), '2026-27', 'Apr 1 starts the new FY');
assert.strictEqual(b.fiscalYearOf(new Date('2026-03-31T23:59:59')), '2025-26', 'Mar 31 is still the old FY');
assert.strictEqual(b.fiscalYearOf(new Date('2026-12-31T12:00:00')), '2026-27');
assert.strictEqual(b.fiscalYearOf(new Date('2027-01-01T12:00:00')), '2026-27', 'Jan does not start a new FY');
assert.strictEqual(b.fiscalYearOf(new Date('2099-04-01T00:00:00')), '2099-00', 'century rollover pads to two digits');

// --- invoice number format ---------------------------------------------------

assert.strictEqual(b.formatInvoiceNumber('CM', '2026-27', 1), 'CM/2026-27/00001');
assert.strictEqual(b.formatInvoiceNumber('CM', '2026-27', 42), 'CM/2026-27/00042');
assert.strictEqual(b.formatInvoiceNumber('CM', '2026-27', 123456), 'CM/2026-27/123456');

// allocateInvoiceNumber must refuse the pool — LAST_INSERT_ID() is
// per-connection, so running it on the pool can return another request's number.
assert.rejects(() => b.allocateInvoiceNumber(null, '2026-27', 'CM'), /requires a single connection/);
assert.rejects(() => b.allocateInvoiceNumber({ execute: () => {} }, '2026-27', 'CM'), /requires a single connection/);

// --- state comparison --------------------------------------------------------
// Both sides are free-text VARCHARs, so a case or whitespace difference must
// not silently flip a bill from CGST+SGST to IGST.

assert.ok(b.sameState('Uttar Pradesh', 'uttar pradesh'), 'case-insensitive');
assert.ok(b.sameState(' Delhi ', 'Delhi'), 'whitespace-insensitive');
assert.ok(!b.sameState('Delhi', 'Haryana'));
assert.ok(!b.sameState('', 'Delhi'), 'unset platform state is never a match');
assert.ok(!b.sameState(null, 'Delhi'));
assert.ok(!b.sameState('Delhi', null), 'assigner with no state is never intra-state');

console.log('✓ billing self-check passed');
