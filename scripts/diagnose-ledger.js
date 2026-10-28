/**
 * Read-only: dump the full money trail for a survey so a ledger imbalance can be
 * explained exactly. No writes. Run against the PROD db.
 *
 *   node scripts/diagnose-ledger.js 77
 *   node scripts/diagnose-ledger.js CM/2026-27/00003   # by invoice number
 *
 * What to look at:
 *   - BILL.total_amount vs advance_adjusted vs balance_due
 *   - PAYMENTS[*].base_amount / final_amount / status  (the advance)
 *   - LEDGER entries: sum(credit) - sum(debit) should equal the assigner's balance.
 *     A non-zero balance after a fully-paid invoice means advance_adjusted (on the
 *     bill) != the advance credited to the ledger — usually the bill was raised
 *     before the advance was recorded, so the invoice never subtracted it.
 */

const db = require('../src/config/database');

const money = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

(async () => {
  const key = process.argv[2] || '77';
  const byInvoice = /[^0-9]/.test(key);

  const bill = await db.execute_single(
    `SELECT id, survey_id, assigner_id, invoice_number, status, total_amount,
            advance_adjusted, amount_paid, balance_due, settlement_method
       FROM survey_bills
      WHERE ${byInvoice ? 'invoice_number = ?' : 'survey_id = ?'} AND status <> 'cancelled'
      ORDER BY id DESC LIMIT 1`,
    [key]
  );
  if (!bill) { console.error('No bill for', key); process.exit(1); }

  console.log('=== BILL ===');
  console.log(`  total=${money(bill.total_amount)}  advance_adjusted=${money(bill.advance_adjusted)}  amount_paid=${money(bill.amount_paid)}  balance_due=${money(bill.balance_due)}  status=${bill.status}`);

  const pays = await db.query_rows(
    `SELECT id, status, base_amount, discount_amount, final_amount, coupon_code, paid_at
       FROM payments WHERE survey_id = ? ORDER BY id`, [bill.survey_id]);
  console.log('=== PAYMENTS (advance) ===');
  pays.forEach((p) => console.log(`  #${p.id} status=${p.status} base=${money(p.base_amount)} discount=${money(p.discount_amount)} final(cash)=${money(p.final_amount)} coupon=${p.coupon_code || '—'}`));

  const led = await db.query_rows(
    `SELECT id, entry_type, amount, balance_after, reference_type, reference_id, description, created_at
       FROM assigner_ledger_entries WHERE assigner_id = ? ORDER BY id`, [bill.assigner_id]);
  console.log('=== LEDGER (assigner ' + bill.assigner_id + ') ===');
  let credit = 0, debit = 0;
  led.forEach((e) => {
    const a = money(e.amount);
    if (e.entry_type === 'credit') credit += a; else debit += a;
    console.log(`  #${e.id} ${e.entry_type.toUpperCase().padEnd(6)} ${String(a).padStart(9)}  after=${String(money(e.balance_after)).padStart(9)}  [${e.reference_type}/${e.reference_id ?? '-'}]  ${e.description || ''}`);
  });
  console.log(`  ---- sum(credit)=${money(credit)}  sum(debit)=${money(debit)}  net=${money(credit - debit)} (positive = platform owes assigner) ----`);

  // Flag the classic mismatch.
  const advCredited = led.filter((e) => e.reference_type === 'advance_payment' && e.entry_type === 'credit').reduce((s, e) => s + money(e.amount), 0);
  if (money(advCredited) !== money(bill.advance_adjusted)) {
    console.log(`\n>>> MISMATCH: advance credited to ledger = ${money(advCredited)} but the invoice's advance_adjusted = ${money(bill.advance_adjusted)}.`);
    console.log('    The difference is exactly the phantom balance. The invoice did not subtract the advance the assigner actually paid.');
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
