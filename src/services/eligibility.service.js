/**
 * Surveyor Eligibility Service
 * Spec: v2-spec.md §1.4
 *
 * Single source of truth for "may this surveyor be given this survey?".
 *
 * SCOPE (revised): the category rule gates the BROADCAST paths ONLY. Filtering
 * only the fan-out would exclude nobody, because an excluded surveyor could still
 * discover and win the case through the pull path — so all THREE broadcast paths
 * route through this module:
 *
 *   1. services/broadcast.service.js  — broadcast fan-out
 *   2. surveyor/survey.controller.js  — GET /surveyor/available-surveys (pull)
 *   3. surveyor/survey.controller.js  — POST /surveyor/surveys/:id/accept-broadcast
 *
 * Direct assignment (assigner) and admin manual assignment are DELIBERATELY NOT
 * gated by category — those are trust decisions; the assigner/admin may pick any
 * eligible team member regardless of category. See the notes at those call sites.
 * The employee-exclusion rule (openBroadcastEmployeeClause) is likewise broadcast-only.
 */

const { SURVEY_TYPE_REQUIRED_CATEGORY, SURVEYOR_CATEGORY_LIST } = require('../utils/constants');

// Required lazily (same pattern as notification.helper.js) so the pure
// rule-logic in this module can be unit-tested without a DB driver present.
// See scripts/test-eligibility.js.
const getDb = () => require('../config/database');

/**
 * Which category a survey type requires, or null if it is open to all investigators.
 * Unknown/legacy survey types return null (open) rather than throwing — a typo in
 * the enum must not silently make a survey unassignable to everyone.
 * @param {string} surveyType
 * @returns {string|null}
 */
const requiredCategoryFor = (surveyType) =>
  SURVEY_TYPE_REQUIRED_CATEGORY[surveyType] ?? null;

/**
 * SQL fragment restricting a surveyor query to those eligible for a survey type.
 *
 * Returns a clause to AND into an existing WHERE, plus its params. Composable,
 * because the five call sites have very different surrounding queries (haversine
 * HAVING, joins, pagination) and cannot share one whole query.
 *
 * @param {string} surveyType
 * @param {string} alias - table alias for `surveyors` in the caller's query
 * @returns {{ sql: string, params: Array }}
 */
const categoryClause = (surveyType, alias = 'sv') => {
  const category = requiredCategoryFor(surveyType);
  if (!category) return { sql: '', params: [] };

  return {
    sql: ` AND EXISTS (
             SELECT 1 FROM surveyor_categories sc
              WHERE sc.surveyor_id = ${alias}.id
                AND sc.category = ?
                AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
           )`,
    params: [category]
  };
};

/**
 * SQL fragment excluding non-Prime employees from an OPEN BROADCAST. (v2 §2.3)
 *
 * The rule, in full:
 *   - A surveyor who has accepted employment with ANY assigner is excluded...
 *   - ...UNLESS they are Prime (hold >= 1 unexpired category), who are never
 *     excluded by employment and keep receiving open broadcasts from everyone.
 *
 * There is deliberately no "employer pool" term here. Employees reach their
 * assigner's work only through direct assignment, never through a broadcast —
 * so this clause belongs to Route B only. Do NOT apply it to direct assign.
 *
 * @param {string} alias - table alias for `surveyors` in the caller's query
 * @returns {string} SQL to AND into an existing WHERE (no params)
 */
const openBroadcastEmployeeClause = (alias = 'sv') => `
  AND NOT (
    EXISTS (
      SELECT 1 FROM assigner_surveyor_team t
       WHERE t.surveyor_id = ${alias}.id
         AND t.status = 'accepted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM surveyor_categories sc
       WHERE sc.surveyor_id = ${alias}.id
         AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
    )
  )`;

/**
 * Is this surveyor barred from OPEN broadcasts because they are a non-Prime
 * employee? The single-surveyor equivalent of openBroadcastEmployeeClause(),
 * for the pull/accept paths which name one surveyor rather than query a pool.
 *
 * @param {number} surveyorId
 * @returns {Promise<{ excluded: boolean, employers?: string[] }>}
 */
const isExcludedFromOpenBroadcast = async (surveyorId) => {
  const row = await getDb().execute_single(
    `SELECT
       EXISTS (SELECT 1 FROM assigner_surveyor_team t
                WHERE t.surveyor_id = ? AND t.status = 'accepted') AS is_employee,
       EXISTS (SELECT 1 FROM surveyor_categories sc
                WHERE sc.surveyor_id = ?
                  AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())) AS is_prime`,
    [surveyorId, surveyorId]
  );

  if (!row || !row.is_employee || row.is_prime) return { excluded: false };

  const employers = await getDb().execute_query(
    `SELECT a.company_name, a.contact_person_name
       FROM assigner_surveyor_team t
       JOIN assigners a ON a.id = t.assigner_id
      WHERE t.surveyor_id = ? AND t.status = 'accepted'`,
    [surveyorId]
  );

  return {
    excluded: true,
    employers: employers.map((e) => e.company_name || e.contact_person_name).filter(Boolean)
  };
};

/**
 * SELECT fragment exposing the derived Prime flag and the granted category list.
 * Prime is derived (>= 1 unexpired category), never stored — a stored boolean
 * would drift the first time an admin removes the last category, and this
 * codebase has no ORM or trigger layer to keep it in sync.
 *
 * @param {string} alias - table alias for `surveyors`
 * @returns {string} SQL to interpolate into a SELECT list (no user input — safe)
 */
const primeSelect = (alias = 'sv') => `
  EXISTS (
    SELECT 1 FROM surveyor_categories sc
     WHERE sc.surveyor_id = ${alias}.id
       AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
  ) AS is_prime,
  (
    SELECT GROUP_CONCAT(sc.category ORDER BY sc.category)
      FROM surveyor_categories sc
     WHERE sc.surveyor_id = ${alias}.id
       AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
  ) AS categories_csv`;

/**
 * Normalise the `categories_csv` / `is_prime` columns produced by primeSelect()
 * into a clean API shape. Mutates and returns the row for convenience.
 * @param {Object|null} row
 */
const decorateSurveyor = (row) => {
  if (!row) return row;
  row.categories = row.categories_csv ? row.categories_csv.split(',') : [];
  row.is_prime = !!row.is_prime;
  row.is_investigator = row.is_investigator === undefined ? true : !!row.is_investigator;
  delete row.categories_csv;
  return row;
};

const decorateSurveyors = (rows) => (rows || []).map(decorateSurveyor);

/**
 * Assert a specific surveyor may take a specific survey type.
 * Used by the three non-broadcast assignment paths (direct assign, admin manual
 * assign, admin create-with-surveyor), where the caller names one surveyor
 * rather than querying a pool.
 *
 * @param {number} surveyorId
 * @param {string} surveyType
 * @returns {Promise<{ ok: boolean, reason?: string, requiredCategory?: string }>}
 */
const canTakeSurveyType = async (surveyorId, surveyType) => {
  const category = requiredCategoryFor(surveyType);
  if (!category) return { ok: true };

  const row = await getDb().execute_single(
    `SELECT 1 AS ok FROM surveyor_categories
      WHERE surveyor_id = ? AND category = ?
        AND (valid_until IS NULL OR valid_until >= CURDATE())
      LIMIT 1`,
    [surveyorId, category]
  );

  if (row) return { ok: true };

  return {
    ok: false,
    requiredCategory: category,
    reason: `This surveyor does not hold a valid ${category} licence category, which is required for ${surveyType} cases.`
  };
};

/**
 * Fetch a surveyor's granted categories.
 * @param {number} surveyorId
 * @returns {Promise<Array>}
 */
const getCategories = async (surveyorId) =>
  getDb().execute_query(
    `SELECT sc.id, sc.category, sc.license_number, sc.valid_until, sc.document_id,
            sc.granted_at, sc.granted_by_admin_id, a.full_name AS granted_by_name
       FROM surveyor_categories sc
       LEFT JOIN admins a ON a.id = sc.granted_by_admin_id
      WHERE sc.surveyor_id = ?
      ORDER BY sc.category ASC`,
    [surveyorId]
  );

/**
 * Replace a surveyor's category grants wholesale.
 * Used by the admin verify + update flows, which send the full desired set.
 *
 * @param {number} surveyorId
 * @param {Array<string|Object>} categories - 'motor' or { category, license_number, valid_until }
 * @param {number} adminId
 */
const setCategories = async (surveyorId, categories, adminId) => {
  const normalised = (categories || [])
    .map((c) => (typeof c === 'string' ? { category: c } : c))
    .filter((c) => c && SURVEYOR_CATEGORY_LIST.includes(c.category));

  const conn = await getDb().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM surveyor_categories WHERE surveyor_id = ?', [surveyorId]);

    for (const c of normalised) {
      await conn.execute(
        `INSERT INTO surveyor_categories
           (surveyor_id, category, license_number, valid_until, document_id, granted_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          surveyorId,
          c.category,
          c.license_number || null,
          c.valid_until || null,
          c.document_id || null,
          adminId || null
        ]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return normalised.map((c) => c.category);
};

/**
 * Validate a category payload before writing. Returns an error string, or null.
 * @param {Array} categories
 */
const validateCategories = (categories) => {
  if (categories === undefined) return null;
  if (!Array.isArray(categories)) return 'categories must be an array';

  for (const raw of categories) {
    const c = typeof raw === 'string' ? { category: raw } : raw;
    if (!c || !c.category) return 'each category entry needs a `category`';
    if (!SURVEYOR_CATEGORY_LIST.includes(c.category)) {
      return `unknown category "${c.category}" — allowed: ${SURVEYOR_CATEGORY_LIST.join(', ')}`;
    }
    if (c.valid_until && Number.isNaN(Date.parse(c.valid_until))) {
      return `invalid valid_until for "${c.category}"`;
    }
  }

  const seen = new Set();
  for (const raw of categories) {
    const key = typeof raw === 'string' ? raw : raw.category;
    if (seen.has(key)) return `duplicate category "${key}"`;
    seen.add(key);
  }

  return null;
};

module.exports = {
  requiredCategoryFor,
  categoryClause,
  openBroadcastEmployeeClause,
  isExcludedFromOpenBroadcast,
  primeSelect,
  decorateSurveyor,
  decorateSurveyors,
  canTakeSurveyType,
  getCategories,
  setCategories,
  validateCategories
};
