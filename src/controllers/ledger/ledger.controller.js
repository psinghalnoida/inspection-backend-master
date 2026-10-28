/**
 * Ledger Controller
 * Spec: v2-spec.md §4
 *
 * The assigner-facing half is read-only. Only an admin can post an adjustment or
 * record a refund, and both are recorded against the admin who did it.
 */

const db = require('../../config/database');
const { success, error, notFound, paginated } = require('../../utils/response');
const { parsePagination } = require('../../utils/helpers');
const ledger = require('../../services/ledger.service');

/**
 * My statement.
 * GET /api/v1/assigner/ledger
 */
const getMyLedger = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { entries, total, balance } = await ledger.getStatement(req.user.id, { limit, offset });

    res.json(paginated(entries, { page, limit, total }));
    // paginated() does not carry extra fields, so the balance summary rides on a
    // dedicated endpoint below rather than being bolted onto this response.
  } catch (err) {
    next(err);
  }
};

/**
 * My current balance and what it means.
 * GET /api/v1/assigner/ledger/summary
 */
const getMySummary = async (req, res, next) => {
  try {
    const balance = await ledger.getBalance(req.user.id);
    const outstanding = await db.query_rows(
      `SELECT b.id, b.invoice_number, b.balance_due, b.total_amount, b.issued_at,
              s.id AS survey_id, s.laid
         FROM survey_bills b
         JOIN surveys s ON s.id = b.survey_id
        WHERE b.assigner_id = ? AND b.status = 'issued' AND b.balance_due > 0
        ORDER BY b.issued_at ASC`,
      [req.user.id]
    );

    res.json(success({
      balance,
      ...ledger.describeBalance(balance),
      outstanding_invoices: outstanding
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: statement for one assigner.
 * GET /api/v1/admin/assigners/:id/ledger
 */
const getAssignerLedger = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const assigner = await db.execute_single(
      'SELECT id, company_name, contact_person_name, gst_number, state FROM assigners WHERE id = ?',
      [req.params.id]
    );
    if (!assigner) return res.status(404).json(notFound('Assigner not found'));

    const { entries, total } = await ledger.getStatement(req.params.id, { limit, offset });

    res.json(paginated(entries, { page, limit, total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: balance + integrity check for one assigner.
 * GET /api/v1/admin/assigners/:id/ledger/summary
 */
const getAssignerLedgerSummary = async (req, res, next) => {
  try {
    const assigner = await db.execute_single(
      `SELECT id, company_name, contact_person_name, gst_number, state,
              bank_account_holder_name, bank_ifsc_code, bank_name
         FROM assigners WHERE id = ?`,
      [req.params.id]
    );
    if (!assigner) return res.status(404).json(notFound('Assigner not found'));

    const integrity = await ledger.verifyIntegrity(req.params.id);

    res.json(success({
      assigner,
      balance: integrity.stored,
      ...ledger.describeBalance(integrity.stored),
      // If these disagree a running total has drifted and the statement is
      // lying. Surfaced rather than hidden.
      integrity
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: post a manual adjustment or record a refund.
 * POST /api/v1/admin/assigners/:id/ledger  { entry_type, amount, description, reference_type? }
 *
 * This is how "admin has to pay assigner" is actually settled: either the credit
 * is carried forward (no entry needed — it already sits as a negative balance),
 * or a real bank transfer is made and recorded here as a DEBIT, bringing the
 * account back to zero.
 */
const createAdjustment = async (req, res, next) => {
  try {
    const { entry_type, amount, description, reference_type } = req.body || {};

    if (!['debit', 'credit'].includes(entry_type)) {
      return res.status(400).json(error("entry_type must be 'debit' or 'credit'"));
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json(error('amount must be a positive number'));
    }
    if (!description || !String(description).trim()) {
      return res.status(400).json(error('A description is required so the statement is auditable'));
    }
    if (reference_type && !['adjustment', 'refund'].includes(reference_type)) {
      return res.status(400).json(error("reference_type must be 'adjustment' or 'refund'"));
    }

    const assigner = await db.execute_single('SELECT id FROM assigners WHERE id = ?', [req.params.id]);
    if (!assigner) return res.status(404).json(notFound('Assigner not found'));

    const result = await ledger.postEntry({
      assignerId: Number(req.params.id),
      entryType: entry_type,
      amount: amt,
      referenceType: reference_type || 'adjustment',
      referenceId: null,
      description: String(description).trim(),
      adminId: req.user.id
    });

    res.status(201).json(success(
      { balance: result.balance, ...ledger.describeBalance(result.balance) },
      'Ledger entry recorded'
    ));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMyLedger,
  getMySummary,
  getAssignerLedger,
  getAssignerLedgerSummary,
  createAdjustment
};
