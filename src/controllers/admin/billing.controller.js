/**
 * Admin Billing Controller
 * Spec: v2-spec.md §3
 *
 * Bill lifecycle:  draft -> issued -> settled | cancelled
 *
 *   draft     admin is still editing; assigner cannot see it
 *   issued    invoice number allocated, assigner owes balance_due
 *   settled   nothing outstanding (paid, waived, or nothing was due)
 *   cancelled voided; a replacement bill can be created
 *
 * Only broadcast surveys are billed. Direct-assign surveys are free (v2 §3.6).
 */

const db = require('../../config/database');
const { success, error, notFound, created, paginated } = require('../../utils/response');
const { parsePagination } = require('../../utils/helpers');
const billing = require('../../services/billing.service');
const ledger = require('../../services/ledger.service');
const notificationHelper = require('../../services/notification.helper');

/**
 * Surveys that still need a bill.
 * GET /api/v1/admin/billing/pending
 *
 * v2 §3.5: billing is mandatory for every completed broadcast survey, so this
 * is the admin's work queue.
 */
const listPendingBills = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { search } = req.query;

    // Optional search over LA ID, company name, and surveyor name.
    let searchClause = '';
    const searchParams = [];
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      searchClause = ' AND (s.laid LIKE ? OR a.company_name LIKE ? OR sv.full_name LIKE ?)';
      searchParams.push(q, q, q);
    }

    // The COUNT query must join surveyors too, since search can reference it.
    const baseFrom = `
      FROM surveys s
      JOIN assigners a ON a.id = s.assigner_id
      LEFT JOIN surveyors sv ON sv.id = s.surveyor_id`;
    // v2 §3: admin bills at ANY stage, so this is NOT gated on report submission —
    // every un-billed survey shows here except direct-assign (free) and cancelled
    // (voided). buildDraft applies the same rule when the invoice is drafted.
    const baseWhere = `
      WHERE s.status <> 'cancelled'
        AND s.is_direct_assign = FALSE
        AND s.is_archived = 0
        AND NOT EXISTS (
          SELECT 1 FROM survey_bills b
           WHERE b.survey_id = s.id AND b.status <> 'cancelled'
        )${searchClause}`;

    const [rows, countRow] = await Promise.all([
      db.query_rows(
        `SELECT s.id, s.laid, s.survey_type, s.status, s.city, s.state,
                s.completed_at, s.updated_at, s.created_at,
                DATEDIFF(NOW(), s.updated_at) AS days_waiting,
                a.id AS assigner_id, a.company_name, a.state AS assigner_state,
                a.gst_number,
                sv.full_name AS surveyor_name,
                p.final_amount AS advance_paid
           ${baseFrom}
           LEFT JOIN payments p ON p.survey_id = s.id AND p.status = 'completed'
          ${baseWhere}
          ORDER BY s.updated_at DESC, s.id DESC
          LIMIT ? OFFSET ?`,
        [...searchParams, limit, offset]
      ),
      db.query_single(
        `SELECT COUNT(*) AS total ${baseFrom} ${baseWhere}`,
        searchParams
      )
    ]);

    res.json(paginated(rows, { page, limit, total: countRow.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * All bills, filterable.
 * GET /api/v1/admin/billing/bills?status=issued&assigner_id=
 */
const listBills = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, assigner_id, search } = req.query;

    let where = '1=1';
    const params = [];

    if (status) { where += ' AND b.status = ?'; params.push(status); }
    if (assigner_id) { where += ' AND b.assigner_id = ?'; params.push(assigner_id); }
    if (search) {
      where += ' AND (b.invoice_number LIKE ? OR s.laid LIKE ? OR a.company_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows, countRow] = await Promise.all([
      db.query_rows(
        `SELECT b.*, s.laid, s.survey_type, a.company_name
           FROM survey_bills b
           JOIN surveys s ON s.id = b.survey_id
           JOIN assigners a ON a.id = b.assigner_id
          WHERE ${where}
          ORDER BY b.created_at DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
      db.query_single(
        `SELECT COUNT(*) AS total
           FROM survey_bills b
           JOIN surveys s ON s.id = b.survey_id
           JOIN assigners a ON a.id = b.assigner_id
          WHERE ${where}`,
        params
      )
    ]);

    res.json(paginated(rows, { page, limit, total: countRow.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Prefilled draft for a survey, or the existing bill if one exists.
 * GET /api/v1/admin/billing/surveys/:surveyId/draft
 */
const getDraft = async (req, res, next) => {
  try {
    const existing = await db.execute_single(
      `SELECT * FROM survey_bills WHERE survey_id = ? AND status <> 'cancelled'`,
      [req.params.surveyId]
    );

    const draft = await billing.buildDraft(req.params.surveyId);

    if (existing) {
      // Send the draft context alongside the stored bill: the survey/assigner
      // header, the warnings and the conveyance_km unreliability note must stay
      // on screen right up to the moment the admin issues the invoice, not
      // vanish the second the draft is saved.
      return res.json(success(draft.error
        ? { existing_bill: existing }
        : { ...draft, existing_bill: existing }));
    }

    if (draft.error) return res.status(400).json(error(draft.error));

    res.json(success(draft));
  } catch (err) {
    next(err);
  }
};

/** Shared write path for create and update. `existing` is the stored bill on an update. */
const persistBill = async ({ surveyId, body, adminId, existing }) => {
  const draft = await billing.buildDraft(surveyId);
  if (draft.error) return { error: draft.error };

  // Admin-supplied quantities win. Anything omitted falls back to the STORED
  // bill on an update — falling back to the prefill would silently reset an
  // edited figure to the config default.
  const base = existing || draft;

  // Every quantity must be a real, non-negative number. The admin form sets
  // min="0" but that is UI-only, and computeBill coerces junk to 0 silently —
  // a typo'd '-1500' or 'abc' would ship a wrong invoice rather than fail.
  const rejected = [];
  const pick = (key, fallback) => {
    if (body[key] === undefined || body[key] === null || body[key] === '') return fallback;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0) { rejected.push(key); return fallback; }
    return n;
  };

  const inputs = {
    fee_amount: pick('fee_amount', base.fee_amount),
    conveyance_km: pick('conveyance_km', base.conveyance_km),
    conveyance_rate: pick('conveyance_rate', base.conveyance_rate),
    da_toll_amount: pick('da_toll_amount', base.da_toll_amount),
    photo_count: pick('photo_count', base.photo_count),
    photo_rate: pick('photo_rate', base.photo_rate),
    gst_percent: pick('gst_percent', base.gst_percent),
    is_intra_state: draft.is_intra_state,
    advance_adjusted: draft.advance_adjusted,
    // amount_paid belongs to settleBill and is NEVER taken from the request:
    // accepting it here would move balance_due without recording any payment.
    amount_paid: existing ? Number(existing.amount_paid) : 0
  };

  if (rejected.length) {
    return { error: `These values must be a number of zero or more: ${rejected.join(', ')}` };
  }

  const computed = billing.computeBill(inputs);

  const fields = [
    computed.fee_amount, computed.conveyance_km, computed.conveyance_rate,
    computed.conveyance_amount, computed.da_toll_amount, computed.photo_count,
    computed.photo_rate, computed.photo_amount, computed.taxable_value,
    computed.gst_percent, computed.cgst_amount, computed.sgst_amount,
    computed.igst_amount, draft.place_of_supply_state, computed.total_amount,
    computed.advance_adjusted, computed.balance_due,
    body.notes || null
  ];

  if (existing) {
    await db.execute_query(
      `UPDATE survey_bills SET
         fee_amount = ?, conveyance_km = ?, conveyance_rate = ?, conveyance_amount = ?,
         da_toll_amount = ?, photo_count = ?, photo_rate = ?, photo_amount = ?,
         taxable_value = ?, gst_percent = ?, cgst_amount = ?, sgst_amount = ?,
         igst_amount = ?, place_of_supply_state = ?, total_amount = ?,
         advance_adjusted = ?, balance_due = ?, notes = ?, updated_at = NOW()
       WHERE id = ?`,
      [...fields, existing.id]
    );
    return { id: existing.id, computed };
  }

  const result = await db.execute_query(
    `INSERT INTO survey_bills (
       survey_id, assigner_id,
       fee_amount, conveyance_km, conveyance_rate, conveyance_amount,
       da_toll_amount, photo_count, photo_rate, photo_amount,
       taxable_value, gst_percent, cgst_amount, sgst_amount, igst_amount,
       place_of_supply_state, total_amount, advance_adjusted, balance_due,
       notes, status, created_by_admin_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [surveyId, draft.survey.assigner_id, ...fields, adminId]
  );

  return { id: result.insertId, computed };
};

/**
 * Create a draft bill.
 * POST /api/v1/admin/billing/surveys/:surveyId
 */
const createBill = async (req, res, next) => {
  try {
    const surveyId = req.params.surveyId;

    const existing = await db.execute_single(
      `SELECT id, status FROM survey_bills WHERE survey_id = ? AND status <> 'cancelled'`,
      [surveyId]
    );
    if (existing) {
      return res.status(409).json(error(`This survey already has a ${existing.status} bill`));
    }

    const out = await persistBill({
      surveyId, body: req.body || {}, adminId: req.user.id, existing: null
    });
    if (out.error) return res.status(400).json(error(out.error));

    const bill = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [out.id]);
    res.status(201).json(created(bill, 'Draft bill created. Review and issue it to notify the assigner.'));
  } catch (err) {
    // uq_bills_active_survey: a concurrent submit won the check-then-insert race.
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json(error('This survey already has a bill'));
    }
    next(err);
  }
};

/**
 * Update a draft bill.
 * PUT /api/v1/admin/billing/bills/:id
 */
const updateBill = async (req, res, next) => {
  try {
    const bill = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [req.params.id]);
    if (!bill) return res.status(404).json(notFound('Bill not found'));

    // An issued invoice is a tax document. Editing one in place would silently
    // change a number the assigner has already been told to pay.
    if (bill.status !== 'draft') {
      return res.status(400).json(error(
        `Only draft bills can be edited. This bill is ${bill.status} — cancel it and raise a new one instead.`
      ));
    }

    const out = await persistBill({
      surveyId: bill.survey_id, body: req.body || {}, adminId: req.user.id, existing: bill
    });
    if (out.error) return res.status(400).json(error(out.error));

    const updated = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [bill.id]);
    res.json(success(updated, 'Bill updated'));
  } catch (err) {
    next(err);
  }
};

/**
 * Issue a bill: allocate the invoice number, notify the assigner.
 * POST /api/v1/admin/billing/bills/:id/issue
 */
const issueBill = async (req, res, next) => {
  try {
    const bill = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [req.params.id]);
    if (!bill) return res.status(404).json(notFound('Bill not found'));
    if (bill.status !== 'draft') {
      return res.status(400).json(error(`Bill is already ${bill.status}`));
    }

    const config = await billing.getBillingConfig();
    const fiscalYear = billing.fiscalYearOf(new Date());

    // Invoice number allocation and the status flip share one transaction on one
    // connection — LAST_INSERT_ID() is per-connection state.
    const conn = await db.getConnection();
    let invoiceNumber;
    try {
      await conn.beginTransaction();
      invoiceNumber = await billing.allocateInvoiceNumber(conn, fiscalYear, config.invoicePrefix);
      const [upd] = await conn.execute(
        `UPDATE survey_bills
            SET invoice_number = ?, status = 'issued', issued_at = NOW(), updated_at = NOW()
          WHERE id = ? AND status = 'draft'`,
        [invoiceNumber, bill.id]
      );
      // Someone issued this bill between the read and the UPDATE. Roll back so the
      // sequence bump is undone (no skipped invoice number) and we never report a
      // number the bill does not actually carry.
      if (upd.affectedRows === 0) {
        await conn.rollback();
        return res.status(409).json(error('This bill is no longer a draft — it may have just been issued.'));
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    // Nothing outstanding (advance covered it, or we owe them) settles immediately.
    if (Number(bill.balance_due) <= 0) {
      await db.execute_query(
        `UPDATE survey_bills
            SET status = 'settled', settled_at = NOW(),
                settlement_method = 'advance_covered', updated_at = NOW()
          WHERE id = ?`,
        [bill.id]
      );
    }

    const survey = await db.execute_single(
      'SELECT id, laid, assigner_id FROM surveys WHERE id = ?',
      [bill.survey_id]
    );

    // v2 §4: the invoice is what the assigner owes, so it is a DEBIT of the full
    // total. The advance was already credited when it was paid, so the ledger
    // arrives at the same balance_due without it being posted twice.
    // Idempotent on (bill, bill.id).
    try {
      await ledger.postEntry({
        assignerId: bill.assigner_id,
        entryType: 'debit',
        amount: bill.total_amount,
        referenceType: 'bill',
        referenceId: bill.id,
        surveyId: bill.survey_id,
        description: `Invoice ${invoiceNumber}${survey?.laid ? ` — ${survey.laid}` : ''}`,
        adminId: req.user.id
      });
    } catch (ledgerErr) {
      console.error('Ledger post failed for bill', bill.id, ledgerErr.message);
    }

    notificationHelper
      .notifyAssignerBillIssued(bill.assigner_id, survey, {
        invoice_number: invoiceNumber,
        total_amount: bill.total_amount,
        balance_due: bill.balance_due
      })
      .catch((err) => console.error('Bill issued notification error:', err));

    const updated = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [bill.id]);
    res.json(success(updated, `Invoice ${invoiceNumber} issued`));
  } catch (err) {
    next(err);
  }
};

/**
 * Record settlement (offline receipt, waiver, or a correction).
 * POST /api/v1/admin/billing/bills/:id/settle  { amount?, method?, notes? }
 *
 * This is also the manual release valve when an assigner short-pays — without
 * it a small shortfall would lock a report permanently (v2 §4.4).
 */
const settleBill = async (req, res, next) => {
  try {
    const { amount, method, notes } = req.body || {};

    const bill = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [req.params.id]);
    if (!bill) return res.status(404).json(notFound('Bill not found'));
    if (bill.status !== 'issued') {
      return res.status(400).json(error(
        bill.status === 'draft'
          ? 'Issue the bill before recording a payment against it'
          : bill.status === 'settled'
            ? 'This bill is already settled. Cancel it and raise a new one to change the figures.'
            : 'Bill is cancelled'
      ));
    }

    // No amount = mark fully settled (waiver / write-off / short-payment accepted),
    // clamped at 0 so "settling" an advance-covered (negative) balance never claws
    // money back. An amount = a receipt.
    const isBlankAmount = amount === undefined || amount === null || amount === '';
    const received = isBlankAmount ? Math.max(0, Number(bill.balance_due)) : billing.money(amount);
    if (!Number.isFinite(received) || received < 0) {
      return res.status(400).json(error('Amount received must be a number of zero or more'));
    }
    const settlementMethod = method || (isBlankAmount ? 'waived' : 'offline');

    // Optional admin note, appended before the shared settlement writes the row.
    if (notes) {
      await db.execute_query(
        `UPDATE survey_bills SET notes = CONCAT(COALESCE(notes, ''), '\n', ?) WHERE id = ?`,
        [notes, bill.id]
      );
    }

    // Shared settlement path — ledger credit, "settled" notification, export
    // trigger and report unlock all happen inside, identical to online payment.
    const result = await billing.recordBillPayment(bill.id, {
      received, method: settlementMethod, byAdminId: req.user.id
    });
    if (!result.ok) return res.status(400).json(error(result.error));

    res.json(success(result.bill, result.fullySettled
      ? 'Bill settled'
      : `Payment recorded. ₹${Number(result.bill.balance_due).toFixed(2)} still outstanding.`));
  } catch (err) {
    next(err);
  }
};

/**
 * Cancel a bill.
 * POST /api/v1/admin/billing/bills/:id/cancel  { reason }
 */
const cancelBill = async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json(error('A cancellation reason is required'));

    const bill = await db.execute_single('SELECT * FROM survey_bills WHERE id = ?', [req.params.id]);
    if (!bill) return res.status(404).json(notFound('Bill not found'));
    if (bill.status === 'cancelled') return res.status(400).json(error('Bill is already cancelled'));

    // A replacement bill is rebuilt from scratch, and buildDraft credits only the
    // pricing_tiers advance — anything paid against THIS invoice would vanish and
    // the assigner would be asked for it a second time. There is no refund/credit
    // -note machinery yet, so refuse loudly rather than double-charge.
    if (Number(bill.amount_paid) > 0) {
      return res.status(400).json(error(
        `₹${Number(bill.amount_paid).toFixed(2)} has already been received against this invoice, ` +
        'so it cannot be cancelled — a replacement would bill the assigner for that amount again.'
      ));
    }

    await db.execute_query(
      `UPDATE survey_bills
          SET status = 'cancelled',
              notes = CONCAT(COALESCE(notes, ''), '\nCancelled: ', ?),
              updated_at = NOW()
        WHERE id = ?`,
      [reason, bill.id]
    );

    res.json(success(null, 'Bill cancelled. You can raise a new bill for this survey.'));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listPendingBills,
  listBills,
  getDraft,
  createBill,
  updateBill,
  issueBill,
  settleBill,
  cancelBill
};
