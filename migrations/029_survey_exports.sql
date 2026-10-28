-- Migration 029: Composite export PDF, sync outbox, and timeline repair
-- Spec: v2-spec.md §5
--
-- §5 depends on the survey timeline being trustworthy, and it currently is not.
-- The first half of this migration repairs that; the second half adds the export.

-- ---------------------------------------------------------------------------
-- 1. TIMELINE REPAIR (v2 §5.1)
--
-- Both ENUMs omit 'disputed', so assigner/survey.controller.js writes an EMPTY
-- STRING for every escalation — MySQL coerces an out-of-range ENUM value to ''.
-- They also omit 'arrived', 'cancelled' and 'escalated', all of which exist in
-- SURVEY_STATUS. Any status transition the ENUM cannot represent is silently
-- lost, which makes the history unusable as an audit trail.
--
-- Widened to match src/utils/constants.js SURVEY_STATUS exactly.
ALTER TABLE survey_status_history
  MODIFY COLUMN previous_status ENUM(
      'pending','location_detected','assigned','in_transit','arrived',
      'visit_completed','report_submitted','finished','completed',
      'disputed','not_resolved','cancelled','escalated'
  ) NULL COMMENT 'NULL for initial creation',
  MODIFY COLUMN new_status ENUM(
      'pending','location_detected','assigned','in_transit','arrived',
      'visit_completed','report_submitted','finished','completed',
      'disputed','not_resolved','cancelled','escalated'
  ) NOT NULL;

-- Rows written before this fix carry '' where a real status belonged. They
-- cannot be recovered — the original value was never stored — so mark them
-- rather than leaving a blank that reads as a bug in the PDF.
UPDATE survey_status_history
   SET remarks = CONCAT(COALESCE(remarks, ''), ' [status not recorded — pre-migration-029 ENUM gap]')
 WHERE new_status = '' OR previous_status = '';

-- The two timestamps the web and admin timeline widgets have always read but
-- which never existed. They rendered blank.
--
-- Backfilled from survey_status_history where it survived; NULL where the
-- transition predates the fix or was one of the values the ENUM dropped.
ALTER TABLE surveys
  ADD COLUMN visit_completed_at  TIMESTAMP NULL COMMENT 'When the surveyor completed the visit',
  ADD COLUMN report_submitted_at TIMESTAMP NULL COMMENT 'When the report was first submitted';

UPDATE surveys s
   SET visit_completed_at = (
     SELECT MIN(h.created_at) FROM survey_status_history h
      WHERE h.survey_id = s.id AND h.new_status = 'visit_completed'
   )
 WHERE visit_completed_at IS NULL;

UPDATE surveys s
   SET report_submitted_at = (
     SELECT MIN(h.created_at) FROM survey_status_history h
      WHERE h.survey_id = s.id AND h.new_status = 'report_submitted'
   )
 WHERE report_submitted_at IS NULL;

-- Fall back to the report row itself where history is missing.
UPDATE surveys s
   SET report_submitted_at = (
     SELECT MIN(r.submitted_at) FROM survey_reports r WHERE r.survey_id = s.id
   )
 WHERE report_submitted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. EXPORT DOCUMENT + SYNC OUTBOX (v2 §5.3)
--
-- One table serves both roles. The sync state lives in MySQL rather than only in
-- BullMQ because the queue is instantiated CONDITIONALLY — when Redis is absent
-- the app logs "Survey broadcast queue disabled" and carries on, which would
-- turn a queue-only outbox into silent fire-and-forget.
CREATE TABLE IF NOT EXISTS survey_export_documents (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  survey_id      BIGINT UNSIGNED NOT NULL,
  laid           VARCHAR(16) NOT NULL COMMENT 'Denormalised: the key main CM may join on',

  file_url       VARCHAR(500) NULL,
  file_size_bytes INT UNSIGNED NULL,
  bill_id        BIGINT UNSIGNED NULL,
  report_version INT UNSIGNED NULL,

  -- Detects whether a regenerate/re-push is needed. Survey data is NOT immutable
  -- after completion: reports are versioned, and the mobile offline queue can
  -- flush media days after the visit.
  payload_hash   CHAR(64) NULL,

  generated_at   TIMESTAMP NULL,
  generation_error TEXT NULL,

  sync_status    ENUM('not_sent','pending','sent','failed','disabled') NOT NULL DEFAULT 'not_sent',
  sync_attempts  INT UNSIGNED NOT NULL DEFAULT 0,
  last_error     TEXT NULL,
  external_id    VARCHAR(100) NULL COMMENT "Main CM's own id, if they return one",
  sent_at        TIMESTAMP NULL,

  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_export_survey (survey_id),
  KEY idx_export_sync (sync_status, sync_attempts),
  KEY idx_export_laid (laid),
  CONSTRAINT fk_export_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
  CONSTRAINT fk_export_bill   FOREIGN KEY (bill_id)   REFERENCES survey_bills(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Composite survey PDF + outbound sync state to main ClaimsMitra (v2 §5)';

-- Integration config. The push is STUBBED until main CM publishes a contract:
-- with cm_sync_enabled = false the outbox is populated and the PDF generated,
-- but nothing leaves the building.
INSERT INTO system_config (config_key, config_value, value_type, description, category) VALUES
  ('cm_sync_enabled',      'false', 'boolean', 'Push completed surveys to main ClaimsMitra. Leave false until the API contract exists.', 'integration'),
  ('cm_sync_base_url',     '',      'string',  'Main ClaimsMitra API base URL',                    'integration'),
  ('cm_sync_api_key',      '',      'string',  'API key for the main ClaimsMitra endpoint',        'integration'),
  ('cm_sync_max_attempts', '5',     'number',  'Give up pushing after this many failed attempts',  'integration')
ON DUPLICATE KEY UPDATE config_key = config_key;

-- ---------------------------------------------------------------------------
-- 3. DEAD CODE: the stored procedure that generates a SECOND, INCOMPATIBLE LAID.
--
-- src/utils/helpers.js generateLAID() produces L{YYMMDDHHMMSS}{2 ms digits}
-- (15 chars). sp_generate_laid produces L{yy-mm-dd HH:ii} — 16 chars, minute
-- granular, and therefore COLLIDES for two surveys created in the same minute.
-- Nothing calls it, but if main CM keys records on LAID the format has to be
-- pinned and the alternative removed.
DROP PROCEDURE IF EXISTS sp_generate_laid;

-- ---------------------------------------------------------------------------
-- POST-MIGRATION CHECK — how much history was lost to the ENUM gap:
--
--   SELECT COUNT(*) AS unrecoverable
--     FROM survey_status_history
--    WHERE remarks LIKE '%pre-migration-029 ENUM gap%';
--
-- Those rows are gone for good. Every transition AFTER this migration is
-- recorded correctly, so the PDF timeline is reliable going forward.
-- ---------------------------------------------------------------------------
