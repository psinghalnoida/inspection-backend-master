/**
 * Survey Timeline Service
 * Spec: v2-spec.md §5.1
 *
 * ONE canonical timeline, used by the export PDF and by the web/admin timeline
 * widgets. Before this, the widgets read three columns that did not exist
 * (`surveyor_started_at`, `visit_completed_at`, `report_submitted_at`) and
 * silently rendered blanks.
 *
 * Two sources, deliberately combined:
 *   - `surveys` timestamp columns — authoritative when present, and cheap.
 *   - `survey_status_history`     — the real audit trail, but incomplete for
 *                                   anything recorded before migration 029.
 *
 * The column wins when both exist, because history rows can be missing; history
 * fills the gaps and supplies the actor.
 */

const getDb = () => require('../config/database');

/**
 * The canonical milestones, in order. `column` is the timestamp on `surveys`;
 * `status` is the matching survey_status_history value.
 */
const MILESTONES = [
  { key: 'created', label: 'Survey Created', column: 'created_at', status: null },
  { key: 'location_detected', label: 'Location Confirmed', column: null, status: 'location_detected' },
  { key: 'assigned', label: 'Surveyor Assigned', column: 'surveyor_assigned_at', status: 'assigned' },
  { key: 'in_transit', label: 'Surveyor In Transit', column: 'in_transit_at', status: 'in_transit' },
  { key: 'arrived', label: 'Surveyor Arrived', column: 'surveyor_arrived_at', status: 'arrived' },
  { key: 'visit_completed', label: 'Inspection Completed', column: 'visit_completed_at', status: 'visit_completed' },
  { key: 'report_submitted', label: 'Report Submitted', column: 'report_submitted_at', status: 'report_submitted' },
  { key: 'finished', label: 'Survey Completed', column: 'completed_at', status: 'finished' }
];

const SURVEY_TIMELINE_COLUMNS = [
  'created_at', 'surveyor_assigned_at', 'in_transit_at', 'surveyor_arrived_at',
  'visit_completed_at', 'report_submitted_at', 'completed_at'
];

/**
 * Build the milestone list for a survey.
 *
 * @param {Object} survey  a `surveys` row (must include the timeline columns)
 * @param {Array}  history survey_status_history rows, oldest first
 * @returns {Array<{key,label,at,reached,actor,remarks}>}
 */
const buildMilestones = (survey, history = []) => {
  // First occurrence of each status wins — a survey can bounce back through a
  // status (resubmission, dispute), and the timeline shows when it was reached.
  const firstByStatus = {};
  for (const h of history) {
    if (h.new_status && !firstByStatus[h.new_status]) firstByStatus[h.new_status] = h;
  }

  return MILESTONES.map((m) => {
    const fromColumn = m.column ? survey?.[m.column] : null;
    const fromHistory = m.status ? firstByStatus[m.status] : null;
    const at = fromColumn || fromHistory?.created_at || null;

    return {
      key: m.key,
      label: m.label,
      at,
      reached: !!at,
      actor: fromHistory?.changed_by_type || null,
      remarks: fromHistory?.remarks || null
    };
  });
};

/**
 * Events that are not milestones but belong on an audit trail: disputes,
 * escalations, re-submissions, anything the survey bounced through.
 */
const buildEvents = (history = []) =>
  (history || []).map((h) => ({
    at: h.created_at,
    from: h.previous_status || null,
    to: h.new_status || null,
    actor: h.changed_by_type,
    actor_id: h.changed_by_id,
    remarks: h.remarks || null
  }));

/**
 * Full timeline for a survey.
 * @param {number} surveyId
 */
const getTimeline = async (surveyId) => {
  const db = getDb();

  const survey = await db.execute_single(
    `SELECT id, laid, status, ${SURVEY_TIMELINE_COLUMNS.join(', ')}
       FROM surveys WHERE id = ?`,
    [surveyId]
  );
  if (!survey) return null;

  const history = await db.execute_query(
    `SELECT previous_status, new_status, changed_by_type, changed_by_id, remarks, created_at
       FROM survey_status_history
      WHERE survey_id = ?
      ORDER BY created_at ASC, id ASC`,
    [surveyId]
  );

  return {
    survey_id: survey.id,
    laid: survey.laid,
    current_status: survey.status,
    milestones: buildMilestones(survey, history),
    events: buildEvents(history)
  };
};

module.exports = {
  MILESTONES,
  SURVEY_TIMELINE_COLUMNS,
  buildMilestones,
  buildEvents,
  getTimeline
};
