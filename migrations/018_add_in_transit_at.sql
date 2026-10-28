-- Add in_transit_at timestamp to surveys so the 7-day timeout window
-- starts when the surveyor actually enters the transit phase, not at creation.
ALTER TABLE surveys
  ADD COLUMN in_transit_at TIMESTAMP NULL
  AFTER surveyor_arrived_at;

-- Backfill: for surveys already past in_transit, infer the timestamp from
-- the status history (first entry where new_status = 'in_transit').
UPDATE surveys s
LEFT JOIN (
  SELECT survey_id, MIN(created_at) AS first_in_transit_at
  FROM survey_status_history
  WHERE new_status = 'in_transit'
  GROUP BY survey_id
) h ON h.survey_id = s.id
SET s.in_transit_at = h.first_in_transit_at
WHERE s.in_transit_at IS NULL
  AND s.status IN ('in_transit', 'arrived', 'visit_completed', 'report_submitted', 'finished', 'disputed', 'not_resolved');
