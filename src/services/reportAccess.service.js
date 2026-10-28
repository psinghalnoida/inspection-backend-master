/**
 * Report Access Service
 * Spec: v2-spec.md §4.4
 *
 * Decides whether an assigner may see a survey's report file.
 *
 * FAIL-CLOSED for broadcast surveys: the report is visible ONLY once the survey
 * has a SETTLED invoice. That means it is locked when
 *   - no invoice has been raised yet, OR
 *   - an invoice is raised but still has an outstanding balance.
 * The assigner pays before they get the report; letting an un-billed survey's
 * report through free would defeat the whole point.
 *
 * Direct-assign surveys are never billed (§3.6), so their report is always free.
 */

const getDb = () => require('../config/database');

/**
 * @param {number} surveyId
 * @returns {Promise<{ locked:boolean, reason:string|null, bill:Object|null }>}
 */
const checkReportAccess = async (surveyId) => {
  const db = getDb();

  const survey = await db.execute_single(
    'SELECT id, laid, is_direct_assign FROM surveys WHERE id = ?',
    [surveyId]
  );

  if (!survey) return { locked: false, reason: null, bill: null };

  // Free surveys have no invoice to gate on — report always visible.
  if (survey.is_direct_assign) return { locked: false, reason: null, bill: null };

  const bill = await db.execute_single(
    `SELECT id, invoice_number, status, total_amount, advance_adjusted,
            amount_paid, balance_due
       FROM survey_bills
      WHERE survey_id = ? AND status IN ('issued','settled')`,
    [surveyId]
  );

  // No invoice raised yet → LOCKED. The report is released only after billing.
  if (!bill) {
    return {
      locked: true,
      reason: 'The final invoice for this survey has not been raised yet. '
        + 'The report will be available once it is billed and the balance is settled.',
      bill: null
    };
  }

  const balance = Number(bill.balance_due) || 0;

  // Issued but not fully paid → LOCKED.
  if (bill.status !== 'settled' && balance > 0) {
    return {
      locked: true,
      reason: `₹${balance.toFixed(2)} is outstanding on invoice ${bill.invoice_number}. `
        + 'Pay the balance to download the report.',
      bill
    };
  }

  // Settled → visible.
  return { locked: false, reason: null, bill };
};

/**
 * Strip report file URLs from a payload while keeping the metadata visible.
 *
 * The assigner still sees that a report exists, its version, when it was
 * submitted and the surveyor's notes — they are only blocked from the FILE.
 * Hiding the row entirely would make a paid-for survey look unfinished.
 */
const redactReports = (reports, reason) =>
  (reports || []).map((r) => ({
    ...r,
    report_file_url: null,
    locked: true,
    locked_reason: reason
  }));

module.exports = { checkReportAccess, redactReports };
