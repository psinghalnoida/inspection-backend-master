/**
 * Self-check for the surveyor eligibility rules (v2 §1).
 * Pure-logic only — no DB needed. Run: node scripts/test-eligibility.js
 *
 * Covers the parts that silently break things if they drift: the
 * survey_type -> category map, the SQL clause shape, and payload validation.
 */

const assert = require('assert');
const e = require('../src/services/eligibility.service');
const { SURVEYOR_CATEGORIES } = require('../src/utils/constants');

// --- requiredCategoryFor -----------------------------------------------------

assert.strictEqual(e.requiredCategoryFor('motor_spot'), 'motor');
assert.strictEqual(e.requiredCategoryFor('motor_final'), 'motor');
assert.strictEqual(e.requiredCategoryFor('marine_final'), 'marine');

// marine_cargo_investigation is MARINE, not investigation. The rest of the
// backend branches on survey_type.includes('marine'), so it never matches
// === 'investigation'. If this flips, marine cargo cases silently broadcast to
// every investigator instead of licensed marine surveyors.
assert.strictEqual(e.requiredCategoryFor('marine_cargo_investigation'), 'marine');

// Investigation is open to all investigators — no category gate.
assert.strictEqual(e.requiredCategoryFor('investigation'), null);

// Unknown/legacy types must be OPEN, not unassignable. A typo in the enum must
// never make a survey invisible to everyone.
assert.strictEqual(e.requiredCategoryFor('some_future_type'), null);
assert.strictEqual(e.requiredCategoryFor(undefined), null);
assert.strictEqual(e.requiredCategoryFor(null), null);

// --- categoryClause ----------------------------------------------------------

const open = e.categoryClause('investigation');
assert.strictEqual(open.sql, '', 'investigation must add no WHERE fragment');
assert.deepStrictEqual(open.params, []);

const motor = e.categoryClause('motor_spot', 'sv');
assert.ok(motor.sql.includes('EXISTS'), 'motor must add an EXISTS guard');
assert.ok(motor.sql.includes('sv.id'), 'clause must bind to the caller alias');
assert.ok(motor.sql.trimStart().startsWith('AND'), 'clause must be AND-able into an existing WHERE');
assert.deepStrictEqual(motor.params, ['motor']);

// Exactly one placeholder, or the caller's param array misaligns and MySQL
// binds the radius into the category slot.
assert.strictEqual((motor.sql.match(/\?/g) || []).length, 1);

// Expired grants must not count.
assert.ok(motor.sql.includes('valid_until'), 'expired licences must be excluded');

// Alias is honoured so the clause can drop into differently-shaped queries.
assert.ok(e.categoryClause('marine_final', 's').sql.includes('s.id'));

// --- decorateSurveyor --------------------------------------------------------

assert.deepStrictEqual(
  e.decorateSurveyor({ id: 1, is_prime: 1, categories_csv: 'marine,motor' }),
  { id: 1, is_prime: true, categories: ['marine', 'motor'], is_investigator: true }
);

// No grants -> not Prime, empty list (never null — clients map over this).
assert.deepStrictEqual(
  e.decorateSurveyor({ id: 2, is_prime: 0, categories_csv: null }),
  { id: 2, is_prime: false, categories: [], is_investigator: true }
);

// An explicit false must survive; only `undefined` defaults to true.
assert.strictEqual(
  e.decorateSurveyor({ id: 3, is_prime: 0, categories_csv: null, is_investigator: 0 }).is_investigator,
  false
);

assert.strictEqual(e.decorateSurveyor(null), null);
assert.deepStrictEqual(e.decorateSurveyors([]), []);
assert.deepStrictEqual(e.decorateSurveyors(null), []);

// --- validateCategories ------------------------------------------------------

assert.strictEqual(e.validateCategories(undefined), null, 'omitted = no change, not an error');
assert.strictEqual(e.validateCategories([]), null, 'empty = revoke all, is valid');
assert.strictEqual(e.validateCategories(['motor', 'marine']), null);
assert.strictEqual(e.validateCategories([{ category: 'hull', valid_until: '2027-03-31' }]), null);

assert.ok(e.validateCategories('motor'), 'a bare string is not an array');
assert.ok(e.validateCategories(['investigator']), 'investigator is a flag, never a category');
assert.ok(e.validateCategories(['Motor']), 'categories are case-sensitive');
assert.ok(e.validateCategories(['motor', 'motor']), 'duplicates must be rejected');
assert.ok(e.validateCategories([{ valid_until: '2027-01-01' }]), 'entry without a category');
assert.ok(e.validateCategories([{ category: 'motor', valid_until: 'not-a-date' }]));

// Every declared category must be individually accepted, or the admin UI can
// offer an option the API rejects.
for (const c of Object.values(SURVEYOR_CATEGORIES)) {
  assert.strictEqual(e.validateCategories([c]), null, `category "${c}" must be accepted`);
}

// --- primeSelect -------------------------------------------------------------

const sel = e.primeSelect('sv');
assert.ok(sel.includes('AS is_prime'));
assert.ok(sel.includes('AS categories_csv'));
assert.ok(!sel.includes('?'), 'primeSelect is interpolated, so it must take no params');

// --- openBroadcastEmployeeClause (v2 §2.3) -----------------------------------

const emp = e.openBroadcastEmployeeClause('sv');

assert.ok(emp.trimStart().startsWith('AND'), 'must be AND-able into an existing WHERE');
assert.ok(!emp.includes('?'), 'takes no params — it must not shift the caller param array');
assert.ok(emp.includes('sv.id'), 'must bind to the caller alias');
assert.ok(e.openBroadcastEmployeeClause('s').includes('s.id'), 'alias must be honoured');

// The rule is NOT(employee AND NOT prime) — i.e. Prime employees stay in the pool.
// If this ever becomes plain NOT(employee), every Prime surveyor employed by
// anyone silently stops receiving open broadcasts. That is the exact
// contradiction between v2 point 3 and point 4 that was resolved in favour of
// point 3, so it must not regress.
assert.ok(emp.includes('assigner_surveyor_team'), 'must consult the team table');
assert.ok(emp.includes("t.status = 'accepted'"), 'only ACCEPTED membership excludes');
assert.ok(emp.includes('surveyor_categories'), 'must consult categories for the Prime carve-out');

const norm = emp.replace(/\s+/g, ' ');
assert.ok(
  /AND NOT \( EXISTS \(.*assigner_surveyor_team.*\) AND NOT EXISTS \(.*surveyor_categories.*\) \)/.test(norm),
  'shape must stay NOT(is_employee AND NOT is_prime) — Prime employees keep open broadcasts'
);

// A pending or declined invite must NOT exclude anyone.
assert.ok(!norm.includes("'pending'"), 'pending invites must not exclude');
assert.ok(!norm.includes("'declined'"), 'declined invites must not exclude');

// Expired categories must not count towards the Prime carve-out, or a surveyor
// with a lapsed licence would keep receiving broadcasts they cannot service.
assert.ok(emp.includes('valid_until'), 'expired licences must not confer Prime here either');

console.log('✓ eligibility self-check passed');
