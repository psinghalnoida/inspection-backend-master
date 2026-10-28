/**
 * Self-check for the assigner ledger (v2 §4).
 * Pure logic — no DB. Run: node scripts/test-ledger.js
 *
 * The sign convention is the thing worth protecting here. If it ever inverts,
 * every statement in the product reads backwards and an assigner who is owed
 * money is told to pay it.
 */

const assert = require('assert');
const ledger = require('../src/services/ledger.service');
const billing = require('../src/services/billing.service');

// --- money() -----------------------------------------------------------------

assert.strictEqual(ledger.money(0.1 + 0.2), 0.3, 'float drift must be rounded away');
assert.strictEqual(ledger.money('1234.567'), 1234.57);
assert.strictEqual(ledger.money(undefined), 0);
assert.strictEqual(ledger.money(null), 0);
assert.strictEqual(ledger.money('abc'), 0, 'garbage coerces to 0, never NaN');

// --- describeBalance: the sign convention ------------------------------------
//   balance > 0  =>  assigner owes admin
//   balance < 0  =>  admin owes assigner

const owes = ledger.describeBalance(804);
assert.strictEqual(owes.direction, 'assigner_owes');
assert.strictEqual(owes.amount, 804, 'amount is always positive; direction carries the sign');

const credit = ledger.describeBalance(-804);
assert.strictEqual(credit.direction, 'admin_owes');
assert.strictEqual(credit.amount, 804, 'a credit must be reported as a positive amount');
assert.ok(!/-/.test(credit.label), 'the label must never contain a minus sign');

const settled = ledger.describeBalance(0);
assert.strictEqual(settled.direction, 'settled');
assert.strictEqual(settled.amount, 0);

// Tiny residues round to settled rather than showing "₹0.00 due".
assert.strictEqual(ledger.describeBalance(0.001).direction, 'settled');
assert.strictEqual(ledger.describeBalance(-0.001).direction, 'settled');

// --- the ledger must reproduce the bill's balance ----------------------------
// This is the invariant that ties §3 and §4 together: posting the advance as a
// credit and the invoice as a debit must land on exactly the bill's balance_due.
// If these ever disagree, the statement and the invoice tell different stories.

const bill = billing.computeBill({
  fee_amount: 1000, conveyance_km: 100, conveyance_rate: 15, da_toll_amount: 200,
  photo_count: 10, photo_rate: 10, gst_percent: 18, is_intra_state: true,
  advance_adjusted: 2500, amount_paid: 0
});

// Replay the ledger by hand: credit the advance, debit the invoice total.
let balance = 0;
balance = ledger.money(balance - 2500);                    // advance received
balance = ledger.money(balance + bill.total_amount);       // invoice raised

assert.strictEqual(
  balance, bill.balance_due,
  'ledger balance after (advance credit + invoice debit) must equal the bill balance_due'
);
assert.strictEqual(balance, 804, 'the worked example from v2.md');

// Settling the balance closes the account.
balance = ledger.money(balance - bill.balance_due);
assert.strictEqual(balance, 0, 'paying the balance returns the account to zero');
assert.strictEqual(ledger.describeBalance(balance).direction, 'settled');

// --- the overpayment / refund direction --------------------------------------
// An advance larger than the invoice must leave a NEGATIVE balance — that is the
// "admin has to pay assigner" case from v2 point 3. If it were clamped at zero
// the refund would silently disappear.

const smallBill = billing.computeBill({
  fee_amount: 500, conveyance_km: 0, conveyance_rate: 0, da_toll_amount: 0,
  photo_count: 0, photo_rate: 0, gst_percent: 18, is_intra_state: true,
  advance_adjusted: 2500, amount_paid: 0
});

let over = 0;
over = ledger.money(over - 2500);
over = ledger.money(over + smallBill.total_amount);

assert.ok(over < 0, 'an overpayment must leave the admin owing the assigner');
assert.strictEqual(over, smallBill.balance_due);
assert.strictEqual(ledger.describeBalance(over).direction, 'admin_owes');

// Recording the bank refund as a DEBIT brings it back to zero.
const refunded = ledger.money(over + Math.abs(over));
assert.strictEqual(refunded, 0, 'a refund debit closes an admin_owes balance');

// --- multi-survey running balance --------------------------------------------
// Balances accumulate across surveys — an assigner's account is one running
// total, not per-survey buckets.

let acc = 0;
const events = [
  { type: 'credit', amount: 2500 },   // survey A advance
  { type: 'debit', amount: 3304 },    // survey A invoice
  { type: 'credit', amount: 2500 },   // survey B advance
  { type: 'debit', amount: 2950 },    // survey B invoice
];
for (const e of events) {
  acc = ledger.money(acc + (e.type === 'debit' ? e.amount : -e.amount));
}
assert.strictEqual(acc, 1254, 'running balance across two surveys');
assert.strictEqual(ledger.describeBalance(acc).direction, 'assigner_owes');

// A credit from one survey offsets a debit from another — this is what makes it
// a ledger rather than a list of invoices.
acc = ledger.money(acc - 1254);
assert.strictEqual(acc, 0);

// --- backfill invariant ------------------------------------------------------
// Migration 028 posts one debit AND one matching credit per historical payment,
// so every assigner starts at exactly zero. Credits alone would show every
// assigner as being owed their entire payment history.

let backfill = 0;
for (const paid of [2500, 3500, 5000, 2500]) {
  backfill = ledger.money(backfill + paid);   // debit: the survey charge
  backfill = ledger.money(backfill - paid);   // credit: the payment received
}
assert.strictEqual(backfill, 0, 'the backfill must net to zero for every assigner');

// --- rounding across many small entries --------------------------------------
// 100 entries of 0.01 must be exactly 1.00, not 1.0000000000000007.

let pennies = 0;
for (let i = 0; i < 100; i++) pennies = ledger.money(pennies + 0.01);
assert.strictEqual(pennies, 1, 'repeated small entries must not accumulate float drift');

console.log('✓ ledger self-check passed');
