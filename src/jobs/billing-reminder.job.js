/**
 * Billing Reminder Job
 * Spec: v2-spec.md §3.5 — billing is mandatory for every completed broadcast survey.
 *
 * Runs daily at 09:30 (just after the existing timeout check at 09:00).
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: an unbilled survey does not just mean
 * uncollected revenue. Under v2 §4.6 the surveyor's payout is released only
 * after the bill is settled — so an admin forgetting to raise a bill silently
 * withholds a surveyor's money for work they have already done.
 */

const cron = require('node-cron');
const db = require('../config/database');
const notificationHelper = require('../services/notification.helper');
const billing = require('../services/billing.service');

const findUnbilledSurveys = async (afterDays) => {
  const statuses = billing.BILLABLE_STATUSES;
  const placeholders = statuses.map(() => '?').join(',');

  return db.query_rows(
    `SELECT s.id, s.laid, DATEDIFF(NOW(), s.updated_at) AS days_waiting
       FROM surveys s
      WHERE s.status IN (${placeholders})
        AND s.is_direct_assign = FALSE
        AND s.is_archived = 0
        AND DATEDIFF(NOW(), s.updated_at) >= ?
        AND NOT EXISTS (
          SELECT 1 FROM survey_bills b
           WHERE b.survey_id = s.id AND b.status <> 'cancelled'
        )
      ORDER BY s.updated_at ASC`,
    [...statuses, afterDays]
  );
};

const runOnce = async () => {
  const config = await billing.getBillingConfig();
  const pending = await findUnbilledSurveys(config.reminderAfterDays);

  if (pending.length === 0) {
    console.log('🧾 Billing reminder: nothing pending');
    return { count: 0 };
  }

  const oldestDays = pending[0].days_waiting;
  console.log(`🧾 Billing reminder: ${pending.length} unbilled survey(s), oldest ${oldestDays}d`);

  await notificationHelper.notifyAdminBillsPending(pending.length, oldestDays);

  return { count: pending.length, oldestDays };
};

const initBillingReminder = () => {
  cron.schedule('30 9 * * *', async () => {
    console.log('🕐 Running billing reminder check...');
    try {
      await runOnce();
    } catch (err) {
      // Never let a reminder failure take the process down.
      console.error('Billing reminder job error:', err.message);
    }
  });

  console.log('✅ Billing reminder job scheduled (daily 09:30)');
};

module.exports = initBillingReminder;
module.exports.runOnce = runOnce;
module.exports.findUnbilledSurveys = findUnbilledSurveys;
