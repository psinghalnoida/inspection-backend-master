/**
 * Assigner Ledger Service
 * Spec: v2-spec.md §4
 *
 * A running account between the platform and each assigner.
 *
 * SIGN CONVENTION (the one thing to remember):
 *   balance > 0  =>  the ASSIGNER OWES the admin
 *   balance < 0  =>  the ADMIN OWES the assigner
 *
 *   debit  = the assigner owes more (a bill was raised)
 *   credit = the assigner owes less (money received, or a refund granted)
 *
 * CONCURRENCY: `balance_after` is a running total, so two concurrent writers
 * reading the same "previous balance" would both compute the same next value and
 * silently corrupt the account. Every write therefore happens inside a
 * transaction that takes a row lock on the assigner first. This codebase has no
 * other locking convention, so it is spelled out here rather than assumed.
 */

const getDb = () => require('../config/database');

/** Round to 2dp without float drift. */
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Post an entry and return the new balance.
 *
 * Idempotent on (reference_type, reference_id) — the table has a UNIQUE key on
 * that pair, so a retried payment callback or a double-clicked settle cannot
 * post the same money twice. A duplicate is swallowed and the current balance
 * returned unchanged.
 *
 * @param {Object} entry
 * @param {number} entry.assignerId
 * @param {'debit'|'credit'} entry.entryType
 * @param {number} entry.amount            positive; direction comes from entryType
 * @param {string} entry.referenceType     advance_payment|bill|balance_payment|refund|adjustment|opening
 * @param {number|null} entry.referenceId
 * @param {number|null} [entry.surveyId]
 * @param {string} [entry.description]
 * @param {number|null} [entry.adminId]
 * @param {Object} [conn]  optional existing transaction connection
 * @returns {Promise<{ balance:number, entryId:number|null, duplicate:boolean }>}
 */
const postEntry = async (entry, conn = null) => {
  const db = getDb();
  const amount = money(entry.amount);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Ledger amount must be a non-negative number');
  }
  if (!['debit', 'credit'].includes(entry.entryType)) {
    throw new Error(`Invalid ledger entry_type: ${entry.entryType}`);
  }

  // A zero-amount entry is noise in a statement, not an error.
  if (amount === 0) {
    return { balance: await getBalance(entry.assignerId), entryId: null, duplicate: false };
  }

  const own = !conn;
  const c = conn || (await db.getConnection());

  try {
    if (own) await c.beginTransaction();

    // Lock the assigner row so concurrent posts for the SAME assigner serialise.
    // Locking the assigner (not the ledger) also covers the very first entry,
    // when there is no previous ledger row to lock.
    await c.execute('SELECT id FROM assigners WHERE id = ? FOR UPDATE', [entry.assignerId]);

    const [prevRows] = await c.execute(
      `SELECT balance_after FROM assigner_ledger_entries
        WHERE assigner_id = ? ORDER BY id DESC LIMIT 1`,
      [entry.assignerId]
    );
    const previous = money(prevRows[0]?.balance_after || 0);
    const delta = entry.entryType === 'debit' ? amount : -amount;
    const balanceAfter = money(previous + delta);

    let entryId = null;
    let duplicate = false;

    try {
      const [res] = await c.execute(
        `INSERT INTO assigner_ledger_entries
           (assigner_id, entry_type, amount, balance_after, reference_type,
            reference_id, survey_id, description, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.assignerId, entry.entryType, amount, balanceAfter,
          entry.referenceType, entry.referenceId ?? null,
          entry.surveyId ?? null, entry.description || null,
          entry.adminId ?? null
        ]
      );
      entryId = res.insertId;
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      // Already posted — this is the idempotency guarantee doing its job.
      duplicate = true;
    }

    if (own) await c.commit();

    return {
      balance: duplicate ? previous : balanceAfter,
      entryId,
      duplicate
    };
  } catch (err) {
    if (own) await c.rollback();
    throw err;
  } finally {
    if (own) c.release();
  }
};

/**
 * Current net payable for an assigner.
 * Read from the newest entry rather than SUM() — the running balance is the
 * authoritative figure and is what every statement row shows.
 */
const getBalance = async (assignerId) => {
  const row = await getDb().execute_single(
    `SELECT balance_after FROM assigner_ledger_entries
      WHERE assigner_id = ? ORDER BY id DESC LIMIT 1`,
    [assignerId]
  );
  return money(row?.balance_after || 0);
};

/**
 * Recompute the balance from the entries themselves.
 * Used by the consistency check below — if this disagrees with getBalance(),
 * a running total has drifted and the statement is lying.
 */
const getComputedBalance = async (assignerId) => {
  const row = await getDb().execute_single(
    `SELECT SUM(IF(entry_type = 'debit', amount, -amount)) AS net
       FROM assigner_ledger_entries WHERE assigner_id = ?`,
    [assignerId]
  );
  return money(row?.net || 0);
};

/**
 * Does the stored running balance still agree with the sum of the entries?
 * Cheap enough to expose to admin as a health check.
 */
const verifyIntegrity = async (assignerId) => {
  const [stored, computed] = await Promise.all([
    getBalance(assignerId),
    getComputedBalance(assignerId)
  ]);
  return { stored, computed, consistent: stored === computed };
};

/**
 * Paginated statement for an assigner, newest first.
 */
const getStatement = async (assignerId, { limit = 50, offset = 0 } = {}) => {
  const db = getDb();

  const [entries, countRow] = await Promise.all([
    db.query_rows(
      `SELECT e.*, s.laid, b.invoice_number
         FROM assigner_ledger_entries e
         LEFT JOIN surveys s ON s.id = e.survey_id
         LEFT JOIN survey_bills b
                ON b.id = e.reference_id AND e.reference_type = 'bill'
        WHERE e.assigner_id = ?
        ORDER BY e.id DESC
        LIMIT ? OFFSET ?`,
      [assignerId, limit, offset]
    ),
    db.query_single(
      'SELECT COUNT(*) AS total FROM assigner_ledger_entries WHERE assigner_id = ?',
      [assignerId]
    )
  ]);

  return { entries, total: countRow?.total || 0, balance: await getBalance(assignerId) };
};

/**
 * Human framing of a balance. Kept server-side so all three clients say the same
 * thing and none of them has to re-derive the sign convention.
 */
const describeBalance = (balance) => {
  const v = money(balance);
  if (v > 0) return { direction: 'assigner_owes', amount: v, label: 'You owe' };
  if (v < 0) return { direction: 'admin_owes', amount: Math.abs(v), label: 'Credit in your favour' };
  return { direction: 'settled', amount: 0, label: 'Settled' };
};

module.exports = {
  money,
  postEntry,
  getBalance,
  getComputedBalance,
  verifyIntegrity,
  getStatement,
  describeBalance
};
