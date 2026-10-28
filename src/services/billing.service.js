/**
 * Billing Service
 * Spec: v2-spec.md §3
 *
 * All money arithmetic for the itemised survey bill lives here, kept free of
 * Express and (where possible) of the DB, so it can be unit-tested without a
 * database. See scripts/test-billing.js.
 *
 * MODEL RECAP
 *   pricing_tiers slab  = ADVANCE, paid before the surveyor travels
 *   survey_bills        = FINAL INVOICE, raised by admin after the visit
 *   balance_due         = total - advance - already paid   (negative => we owe them)
 *
 * Direct-assign surveys are never billed (v2 §3.6).
 */

const { SURVEY_STATUS } = require('../utils/constants');

const getDb = () => require('../config/database');

/** Round to 2dp without float drift (0.1 + 0.2 style errors compound over 4 lines). */
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Indian financial year for a date: 1 Apr – 31 Mar. Returns e.g. '2026-27'.
 * @param {Date} date
 */
const fiscalYearOf = (date) => {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1; // month 3 = April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
};

/**
 * Compute every derived figure on a bill from its quantities and rates.
 *
 * Pure — no DB, no clock. This is the function to test.
 *
 * GST: the worked example in v2.md applies 18% to the WHOLE taxable value
 * (2800 -> 3304), i.e. conveyance and DA/toll are taxable supply, not
 * pass-through reimbursement. Intra-state supply splits into CGST+SGST at half
 * the rate each; inter-state is a single IGST at the full rate.
 *
 * @param {Object} input
 * @param {number} input.fee_amount
 * @param {number} input.conveyance_km
 * @param {number} input.conveyance_rate
 * @param {number} input.da_toll_amount
 * @param {number} input.photo_count
 * @param {number} input.photo_rate
 * @param {number} input.gst_percent
 * @param {boolean} input.is_intra_state  platform state === assigner state
 * @param {number} input.advance_adjusted amount already collected as advance
 * @param {number} [input.amount_paid]    balance received so far
 */
const computeBill = (input) => {
  const fee = money(input.fee_amount);
  const conveyanceKm = money(input.conveyance_km);
  const conveyanceRate = money(input.conveyance_rate);
  const conveyanceAmount = money(conveyanceKm * conveyanceRate);
  const daToll = money(input.da_toll_amount);
  const photoCount = Math.max(0, parseInt(input.photo_count, 10) || 0);
  const photoRate = money(input.photo_rate);
  const photoAmount = money(photoCount * photoRate);

  const taxableValue = money(fee + conveyanceAmount + daToll + photoAmount);

  const gstPercent = money(input.gst_percent);
  const gstTotal = money((taxableValue * gstPercent) / 100);

  // Split so the halves always re-add to gstTotal exactly — halving and
  // rounding twice can lose or gain a paisa on odd amounts.
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (input.is_intra_state) {
    cgst = money(gstTotal / 2);
    sgst = money(gstTotal - cgst);
  } else {
    igst = gstTotal;
  }

  const totalAmount = money(taxableValue + gstTotal);
  const advanceAdjusted = money(input.advance_adjusted);
  const amountPaid = money(input.amount_paid);
  const balanceDue = money(totalAmount - advanceAdjusted - amountPaid);

  return {
    fee_amount: fee,
    conveyance_km: conveyanceKm,
    conveyance_rate: conveyanceRate,
    conveyance_amount: conveyanceAmount,
    da_toll_amount: daToll,
    photo_count: photoCount,
    photo_rate: photoRate,
    photo_amount: photoAmount,
    taxable_value: taxableValue,
    gst_percent: gstPercent,
    cgst_amount: cgst,
    sgst_amount: sgst,
    igst_amount: igst,
    gst_total: gstTotal,
    total_amount: totalAmount,
    advance_adjusted: advanceAdjusted,
    amount_paid: amountPaid,
    balance_due: balanceDue
  };
};

/**
 * Surveyor payout for a bill. (v2 §4.5)
 *
 * ONE dynamic percentage applied to the whole bill — Conveyance and DA/Toll are
 * NOT pass-through. Computed on the PRE-GST taxable value, never the
 * GST-inclusive total: the GST is collected tax owed to the government, not
 * revenue to split.
 *
 * @param {number} taxableValue
 * @param {number} platformCommissionPercent  system_config.platform_commission_percent
 */
const surveyorPayoutFor = (taxableValue, platformCommissionPercent) => {
  const commission = money(platformCommissionPercent);
  return money((money(taxableValue) * (100 - commission)) / 100);
};

/** Load the billing rate defaults from system_config. */
const getBillingConfig = async () => {
  const rows = await getDb().query_rows(
    `SELECT config_key, config_value FROM system_config
      WHERE config_key IN (
        'bill_fee_default','bill_conveyance_rate_per_km','bill_photo_rate',
        'bill_gst_percent','platform_state','platform_gstin',
        'invoice_number_prefix','bill_reminder_after_days','platform_commission_percent'
      )`
  );
  const map = rows.reduce((acc, r) => ({ ...acc, [r.config_key]: r.config_value }), {});

  return {
    fee: parseFloat(map.bill_fee_default ?? 1000),
    conveyanceRate: parseFloat(map.bill_conveyance_rate_per_km ?? 15),
    photoRate: parseFloat(map.bill_photo_rate ?? 10),
    gstPercent: parseFloat(map.bill_gst_percent ?? 18),
    platformState: (map.platform_state || '').trim(),
    platformGstin: (map.platform_gstin || '').trim(),
    invoicePrefix: (map.invoice_number_prefix || 'CM').trim(),
    reminderAfterDays: parseInt(map.bill_reminder_after_days ?? 3, 10),
    commissionPercent: parseFloat(map.platform_commission_percent ?? 25)
  };
};

/** Case-insensitive state comparison; both sides are free-text VARCHARs. */
const sameState = (a, b) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Count the photos that should be billed on a survey. (v2 §3.3)
 *
 * `survey_photos` is one table for everything: selfies, live photos, gallery
 * uploads AND videos. A naive COUNT(*) would bill the surveyor's mandatory
 * selfie and every video as a photo.
 */
const countBillablePhotos = async (surveyId) => {
  const row = await getDb().execute_single(
    `SELECT COUNT(*) AS n FROM survey_photos
      WHERE survey_id = ?
        AND media_type = 'image'
        AND photo_type <> 'selfie'`,
    [surveyId]
  );
  return row?.n || 0;
};

/**
 * Build the prefilled draft an admin edits. Nothing here is authoritative —
 * the admin types the final quantities (v2 §3.3).
 *
 * @param {number} surveyId
 * @returns {Promise<Object|{error:string}>}
 */
const buildDraft = async (surveyId) => {
  const db = getDb();

  const survey = await db.execute_single(
    `SELECT s.id, s.laid, s.survey_type, s.status, s.is_direct_assign,
            s.distance_from_assigner_km, s.assigner_id, s.completed_at, s.created_at,
            a.company_name, a.state AS assigner_state, a.gst_number
       FROM surveys s
       JOIN assigners a ON a.id = s.assigner_id
      WHERE s.id = ?`,
    [surveyId]
  );

  if (!survey) return { error: 'Survey not found' };

  // v2 §3.6: direct-assign surveys are free. Guard here so every caller
  // inherits it rather than each endpoint remembering.
  if (survey.is_direct_assign) {
    return { error: 'Direct-assign surveys are not billed' };
  }

  // v2 §3: admin may raise the invoice at ANY stage — report submission is not a
  // prerequisite. Only a cancelled survey (voided, no service rendered) is off
  // limits. Quantities the survey hasn't produced yet (photos, conveyance) default
  // to 0 in the draft and the admin fills them in.
  if (survey.status === SURVEY_STATUS.CANCELLED) {
    return { error: 'This survey is cancelled — it cannot be billed' };
  }

  const config = await getBillingConfig();

  // Advance credit = the survey's BASE price, regardless of any coupon. A 100%
  // coupon means the assigner prepaid the advance in value (the platform bore the
  // cash), so it must count as an advance against this invoice — otherwise the
  // coupon would be worthless (they'd owe the full bill). base_amount == the cash
  // paid when there is no coupon, so nothing changes for ordinary advances.
  // Deterministic: the ORIGINAL completed advance (lowest id). Without ORDER BY,
  // a survey with more than one completed payment row would pick an arbitrary one,
  // so the invoice could credit a different advance than the ledger did — the exact
  // source of a stray ₹X credit after settlement.
  const advanceRow = await db.execute_single(
    `SELECT base_amount, final_amount FROM payments
      WHERE survey_id = ? AND status = 'completed' ORDER BY id ASC LIMIT 1`,
    [surveyId]
  );

  const photoCount = await countBillablePhotos(surveyId);

  // Conveyance km is a HINT ONLY. surveys.distance_from_assigner_km is written
  // by three code paths with two different meanings (assigner-office->incident
  // at creation, and surveyor->incident overwritten in place on a GET), so
  // existing rows are an untagged mix and it is NULL whenever the assigner has
  // no coordinates. Billing directly off it would produce wrong invoices.
  const oneWayKm = survey.distance_from_assigner_km
    ? money(survey.distance_from_assigner_km)
    : 0;

  const isIntraState = sameState(config.platformState, survey.assigner_state);

  const computed = computeBill({
    fee_amount: config.fee,
    conveyance_km: money(oneWayKm * 2), // round trip
    conveyance_rate: config.conveyanceRate,
    da_toll_amount: 0,
    photo_count: photoCount,
    photo_rate: config.photoRate,
    gst_percent: config.gstPercent,
    is_intra_state: isIntraState,
    advance_adjusted: advanceRow ? money(advanceRow.base_amount ?? advanceRow.final_amount) : 0,
    amount_paid: 0
  });

  return {
    survey: {
      id: survey.id,
      laid: survey.laid,
      survey_type: survey.survey_type,
      status: survey.status,
      assigner_id: survey.assigner_id,
      company_name: survey.company_name,
      assigner_state: survey.assigner_state,
      gst_number: survey.gst_number
    },
    ...computed,
    place_of_supply_state: survey.assigner_state || null,
    is_intra_state: isIntraState,
    prefill_notes: {
      conveyance_km: survey.distance_from_assigner_km
        ? 'Estimated round trip from the stored survey distance. This value is unreliable — confirm the actual distance before issuing.'
        : 'No distance on record for this survey. Enter the actual distance travelled.',
      photo_count: `Auto-counted from uploaded photos (excludes selfies and videos).`,
      da_toll_amount: 'Not tracked by the system — enter manually.'
    },
    warnings: [
      ...(config.platformState ? [] : ['platform_state is not configured, so GST defaults to IGST. Set it in Settings before issuing invoices.']),
      ...(survey.assigner_state ? [] : ['This assigner has no state on record, so the place of supply cannot be determined.']),
      ...(survey.gst_number ? [] : ['This assigner has no GSTIN on record.'])
    ]
  };
};

/**
 * Allocate the next invoice number for a financial year.
 *
 * Atomic: the counter bump and its read are the standard LAST_INSERT_ID trick,
 * so two admins issuing simultaneously cannot collide.
 *
 * ⚠️ `conn` is REQUIRED and must be a single pooled connection, never the pool.
 * LAST_INSERT_ID() is per-connection state — issuing the INSERT and the SELECT
 * through the pool can route them to two different connections and silently
 * return another request's number.
 *
 * @param {Object} conn a mysql2 connection (from pool.getConnection())
 * @param {string} fiscalYear e.g. '2026-27'
 * @param {string} prefix
 */
const allocateInvoiceNumber = async (conn, fiscalYear, prefix) => {
  if (!conn || typeof conn.execute !== 'function' || typeof conn.release !== 'function') {
    throw new Error('allocateInvoiceNumber requires a single connection, not the pool');
  }

  await conn.execute(
    `INSERT INTO invoice_sequences (fiscal_year, last_number)
     VALUES (?, 1)
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    [fiscalYear]
  );

  const [rows] = await conn.execute('SELECT LAST_INSERT_ID() AS n');
  // On a fresh INSERT there is no AUTO_INCREMENT column, so LAST_INSERT_ID()
  // is 0 — that case is the first invoice of the year.
  const n = Number(rows[0]?.n) || 1;

  return `${prefix}/${fiscalYear}/${String(n).padStart(5, '0')}`;
};

/** Format the invoice number for a given sequence value (used by tests). */
const formatInvoiceNumber = (prefix, fiscalYear, n) =>
  `${prefix}/${fiscalYear}/${String(n).padStart(5, '0')}`;

/** Statuses at which a survey is finished enough to bill. */
const BILLABLE_STATUSES = [
  SURVEY_STATUS.REPORT_SUBMITTED,
  SURVEY_STATUS.FINISHED,
  SURVEY_STATUS.COMPLETED
];

/**
 * Record a payment against an ISSUED bill — the single settlement path shared by
 * the admin "Record payment" action and the assigner's verified online payment.
 *
 * Keeping one path means the ledger credit, the "settled" notification, the
 * export trigger and the report unlock all happen identically no matter who paid.
 *
 * @param {number} billId
 * @param {Object} opts
 * @param {number} opts.received   amount received (>= 0)
 * @param {string} opts.method     'sabpaisa' | 'offline' | 'waived' | ...
 * @param {number|null} [opts.byAdminId]
 * @returns {Promise<{ ok, bill?, fullySettled?, error?, code? }>}
 */
const recordBillPayment = async (billId, { received, method, byAdminId = null }) => {
  const db = getDb();

  const bill = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [billId]);
  if (!bill) return { ok: false, error: 'Bill not found', code: 'BILL_NOT_FOUND' };
  if (bill.status === 'draft') return { ok: false, error: 'Issue the bill before recording a payment.', code: 'BILL_DRAFT' };
  if (bill.status === 'cancelled') return { ok: false, error: 'Bill is cancelled.', code: 'BILL_CANCELLED' };
  // 'settled' is terminal — never stack a second payment onto a closed invoice.
  if (bill.status === 'settled') return { ok: false, error: 'Bill is already settled.', code: 'BILL_ALREADY_SETTLED' };

  const amt = money(received);
  if (!Number.isFinite(amt) || amt < 0) return { ok: false, error: 'Amount must be zero or more.', code: 'BAD_AMOUNT' };

  const newPaid = money(Number(bill.amount_paid) + amt);
  const newBalance = money(Number(bill.total_amount) - Number(bill.advance_adjusted) - newPaid);
  const fullySettled = newBalance <= 0;

  await db.execute_query(
    `UPDATE survey_bills
        SET amount_paid = ?, balance_due = ?,
            status = ?, settled_at = ?, settled_by_admin_id = ?, settlement_method = ?,
            updated_at = NOW()
      WHERE id = ? AND status = 'issued'`,
    [newPaid, newBalance, fullySettled ? 'settled' : 'issued',
     fullySettled ? new Date() : null, fullySettled ? byAdminId : null, method, billId]
  );

  const updated = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [billId]);

  // Ledger credit (money received reduces what the assigner owes). Idempotent on
  // (balance_payment, bill.id) — a retried verify cannot double-credit.
  if (amt > 0) {
    try {
      const ledger = require('./ledger.service');
      await ledger.postEntry({
        assignerId: bill.assigner_id,
        entryType: 'credit',
        amount: amt,
        referenceType: 'balance_payment',
        referenceId: bill.id,
        surveyId: bill.survey_id,
        description: `${method === 'waived' ? 'Balance waived' : 'Balance payment received'}`
          + (bill.invoice_number ? ` — ${bill.invoice_number}` : ''),
        adminId: byAdminId
      });
    } catch (err) {
      console.error('Ledger post failed for bill payment', billId, err.message);
    }
  }

  if (fullySettled) {
    try {
      const survey = await db.execute_single('SELECT id, laid, assigner_id FROM surveys WHERE id = ?', [bill.survey_id]);
      if (survey) {
        require('./notification.helper')
          .notifyAssignerBillSettled(bill.assigner_id, survey, updated)
          .catch((e) => console.error('Bill settled notification error:', e.message));
      }
      // Settling can complete export readiness (report accepted + invoice settled).
      require('./cmSync.service').triggerExportAsync(bill.survey_id, 'invoice settled');
    } catch (err) {
      console.error('Post-settlement side-effect failed for bill', billId, err.message);
    }
  }

  return { ok: true, bill: updated, fullySettled };
};

module.exports = {
  money,
  fiscalYearOf,
  computeBill,
  surveyorPayoutFor,
  getBillingConfig,
  sameState,
  countBillablePhotos,
  buildDraft,
  allocateInvoiceNumber,
  formatInvoiceNumber,
  recordBillPayment,
  BILLABLE_STATUSES
};
