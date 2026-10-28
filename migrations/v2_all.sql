SET NAMES utf8mb4;

DELIMITER $$

DROP PROCEDURE IF EXISTS _v2_migrate $$
CREATE PROCEDURE _v2_migrate()
BEGIN
  DECLARE v_db VARCHAR(64) DEFAULT DATABASE();

  CREATE TABLE IF NOT EXISTS surveyor_categories (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    surveyor_id         BIGINT UNSIGNED NOT NULL,
    category            ENUM('motor','marine','fire','engineering','miscellaneous',
                             'lop','hull','aviation') NOT NULL,
    license_number      VARCHAR(50) NULL,
    valid_until         DATE NULL,
    document_id         BIGINT UNSIGNED NULL,
    granted_by_admin_id BIGINT UNSIGNED NULL,
    granted_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_surveyor_category (surveyor_id, category),
    KEY idx_sc_surveyor (surveyor_id),
    KEY idx_sc_category (category),
    CONSTRAINT fk_sc_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE,
    CONSTRAINT fk_sc_document FOREIGN KEY (document_id) REFERENCES surveyor_documents(id) ON DELETE SET NULL,
    CONSTRAINT fk_sc_admin    FOREIGN KEY (granted_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Licensed lines of business granted to a surveyor by admin (v2 s1)';

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='surveyors' AND COLUMN_NAME='is_investigator') THEN
    ALTER TABLE surveyors
      ADD COLUMN is_investigator BOOLEAN NOT NULL DEFAULT TRUE
      COMMENT 'Every approved surveyor is an investigator by default (v2 s1)';
  END IF;

  IF (SELECT COUNT(*) FROM surveyor_categories) = 0 THEN
    INSERT IGNORE INTO surveyor_categories (surveyor_id, category)
      SELECT id, 'motor'  FROM surveyors WHERE verification_status = 'verified';
    INSERT IGNORE INTO surveyor_categories (surveyor_id, category)
      SELECT id, 'marine' FROM surveyors WHERE verification_status = 'verified';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='assigner_surveyor_team' AND COLUMN_NAME='status') THEN
    ALTER TABLE assigner_surveyor_team
      ADD COLUMN status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending'
        COMMENT 'Surveyor consent to employment (v2 s2)',
      ADD COLUMN invited_by ENUM('admin','assigner') NOT NULL DEFAULT 'admin'
        COMMENT 'Who initiated the invite',
      ADD COLUMN responded_at TIMESTAMP NULL
        COMMENT 'When the surveyor accepted or declined';

    UPDATE assigner_surveyor_team SET status = 'accepted', responded_at = created_at;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='assigner_surveyor_team'
                   AND INDEX_NAME='idx_team_surveyor_status') THEN
    ALTER TABLE assigner_surveyor_team ADD INDEX idx_team_surveyor_status (surveyor_id, status);
  END IF;

  CREATE TABLE IF NOT EXISTS survey_bills (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id           BIGINT UNSIGNED NOT NULL,
    assigner_id         BIGINT UNSIGNED NOT NULL,
    invoice_number      VARCHAR(32) NULL UNIQUE,

    fee_amount          DECIMAL(10,2) NOT NULL DEFAULT 0,
    conveyance_km       DECIMAL(10,2) NOT NULL DEFAULT 0,
    conveyance_rate     DECIMAL(10,2) NOT NULL DEFAULT 0,
    conveyance_amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
    da_toll_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
    photo_count         INT UNSIGNED  NOT NULL DEFAULT 0,
    photo_rate          DECIMAL(10,2) NOT NULL DEFAULT 0,
    photo_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,

    taxable_value       DECIMAL(10,2) NOT NULL DEFAULT 0,
    gst_percent         DECIMAL(5,2)  NOT NULL DEFAULT 18.00,
    cgst_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
    sgst_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
    igst_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
    place_of_supply_state VARCHAR(100) NULL,
    total_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,

    advance_adjusted    DECIMAL(10,2) NOT NULL DEFAULT 0,
    amount_paid         DECIMAL(10,2) NOT NULL DEFAULT 0,
    balance_due         DECIMAL(10,2) NOT NULL DEFAULT 0,

    status              ENUM('draft','issued','settled','cancelled') NOT NULL DEFAULT 'draft',

    active_survey_id    BIGINT UNSIGNED GENERATED ALWAYS AS
                          (IF(status = 'cancelled', NULL, survey_id)) STORED,

    notes               TEXT NULL,
    created_by_admin_id BIGINT UNSIGNED NULL,
    settled_by_admin_id BIGINT UNSIGNED NULL,
    settlement_method   VARCHAR(50) NULL,
    issued_at           TIMESTAMP NULL,
    settled_at          TIMESTAMP NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    KEY idx_bills_assigner (assigner_id),
    KEY idx_bills_status (status),
    KEY idx_bills_survey (survey_id),
    UNIQUE KEY uq_bills_active_survey (active_survey_id),
    CONSTRAINT fk_bill_survey   FOREIGN KEY (survey_id)   REFERENCES surveys(id)   ON DELETE RESTRICT,
    CONSTRAINT fk_bill_assigner FOREIGN KEY (assigner_id) REFERENCES assigners(id) ON DELETE RESTRICT,
    CONSTRAINT fk_bill_admin    FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL,
    CONSTRAINT fk_bill_settler  FOREIGN KEY (settled_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Itemised final invoice per survey (v2 s3)';

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='survey_bills' AND COLUMN_NAME='active_survey_id') THEN
    ALTER TABLE survey_bills
      ADD COLUMN active_survey_id BIGINT UNSIGNED GENERATED ALWAYS AS
        (IF(status = 'cancelled', NULL, survey_id)) STORED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='survey_bills' AND INDEX_NAME='idx_bills_survey') THEN
    ALTER TABLE survey_bills ADD INDEX idx_bills_survey (survey_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='survey_bills'
               AND INDEX_NAME='survey_id' AND NON_UNIQUE=0) THEN
    ALTER TABLE survey_bills DROP INDEX survey_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='survey_bills' AND INDEX_NAME='uq_bills_active_survey') THEN
    ALTER TABLE survey_bills ADD UNIQUE KEY uq_bills_active_survey (active_survey_id);
  END IF;

  CREATE TABLE IF NOT EXISTS invoice_sequences (
    fiscal_year VARCHAR(9) NOT NULL PRIMARY KEY,
    last_number INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Per-financial-year invoice number counter (v2 s3.2)';

  CREATE TABLE IF NOT EXISTS assigner_ledger_entries (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    assigner_id    BIGINT UNSIGNED NOT NULL,
    entry_type     ENUM('debit','credit') NOT NULL,
    amount         DECIMAL(12,2) NOT NULL,
    balance_after  DECIMAL(12,2) NOT NULL,
    reference_type ENUM('advance_payment','bill','balance_payment','refund','adjustment','opening') NOT NULL,
    reference_id   BIGINT UNSIGNED NULL,
    survey_id      BIGINT UNSIGNED NULL,
    description    VARCHAR(255) NULL,
    created_by_admin_id BIGINT UNSIGNED NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ledger_assigner (assigner_id, id),
    KEY idx_ledger_survey (survey_id),
    UNIQUE KEY uq_ledger_reference (reference_type, reference_id),
    CONSTRAINT fk_ledger_assigner FOREIGN KEY (assigner_id) REFERENCES assigners(id) ON DELETE CASCADE,
    CONSTRAINT fk_ledger_survey   FOREIGN KEY (survey_id)   REFERENCES surveys(id)   ON DELETE SET NULL,
    CONSTRAINT fk_ledger_admin    FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Running account between the platform and an assigner (v2 s4)';

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='assigners' AND COLUMN_NAME='bank_ifsc_code') THEN
    ALTER TABLE assigners
      ADD COLUMN bank_account_number_encrypted VARCHAR(500) NULL COMMENT 'Encrypted bank account number',
      ADD COLUMN bank_ifsc_code            VARCHAR(11)  NULL,
      ADD COLUMN bank_account_holder_name   VARCHAR(100) NULL,
      ADD COLUMN bank_name                  VARCHAR(100) NULL;
  END IF;

  IF (SELECT COUNT(*) FROM assigner_ledger_entries) = 0 THEN
    INSERT INTO assigner_ledger_entries
      (assigner_id, entry_type, amount, balance_after, reference_type, reference_id, survey_id, description, created_at)
    SELECT p.assigner_id, 'debit', p.final_amount, 0, 'opening', p.id, p.survey_id,
           CONCAT('Survey charge (pre-v2 slab pricing)', IFNULL(CONCAT(' - ', s.laid), '')), p.paid_at
      FROM payments p LEFT JOIN surveys s ON s.id = p.survey_id
     WHERE p.status = 'completed';

    INSERT INTO assigner_ledger_entries
      (assigner_id, entry_type, amount, balance_after, reference_type, reference_id, survey_id, description, created_at)
    SELECT p.assigner_id, 'credit', p.final_amount, 0, 'advance_payment', p.id, p.survey_id,
           CONCAT('Advance payment received', IFNULL(CONCAT(' - ', s.laid), '')), p.paid_at
      FROM payments p LEFT JOIN surveys s ON s.id = p.survey_id
     WHERE p.status = 'completed';
  END IF;

  IF (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='survey_status_history'
          AND COLUMN_NAME='new_status') NOT LIKE '%escalated%' THEN
    ALTER TABLE survey_status_history
      MODIFY COLUMN previous_status ENUM(
        'pending','location_detected','assigned','in_transit','arrived',
        'visit_completed','report_submitted','finished','completed',
        'disputed','not_resolved','cancelled','escalated') NULL,
      MODIFY COLUMN new_status ENUM(
        'pending','location_detected','assigned','in_transit','arrived',
        'visit_completed','report_submitted','finished','completed',
        'disputed','not_resolved','cancelled','escalated') NOT NULL;
  END IF;

  UPDATE survey_status_history
     SET remarks = CONCAT(COALESCE(remarks, ''), ' [status not recorded - pre-v2 ENUM gap]')
   WHERE (new_status = '' OR previous_status = '')
     AND (remarks IS NULL OR remarks NOT LIKE '%pre-v2 ENUM gap%');

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='surveys' AND COLUMN_NAME='visit_completed_at') THEN
    ALTER TABLE surveys
      ADD COLUMN visit_completed_at  TIMESTAMP NULL COMMENT 'When the surveyor completed the visit',
      ADD COLUMN report_submitted_at TIMESTAMP NULL COMMENT 'When the report was first submitted';

    UPDATE surveys s SET visit_completed_at = (
      SELECT MIN(h.created_at) FROM survey_status_history h
       WHERE h.survey_id = s.id AND h.new_status = 'visit_completed')
     WHERE visit_completed_at IS NULL;

    UPDATE surveys s SET report_submitted_at = (
      SELECT MIN(h.created_at) FROM survey_status_history h
       WHERE h.survey_id = s.id AND h.new_status = 'report_submitted')
     WHERE report_submitted_at IS NULL;

    UPDATE surveys s SET report_submitted_at = (
      SELECT MIN(r.submitted_at) FROM survey_reports r WHERE r.survey_id = s.id)
     WHERE report_submitted_at IS NULL;
  END IF;

  CREATE TABLE IF NOT EXISTS survey_export_documents (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id      BIGINT UNSIGNED NOT NULL,
    laid           VARCHAR(16) NOT NULL,
    file_url       VARCHAR(500) NULL,
    file_size_bytes INT UNSIGNED NULL,
    bill_id        BIGINT UNSIGNED NULL,
    report_version INT UNSIGNED NULL,
    payload_hash   CHAR(64) NULL,
    generated_at   TIMESTAMP NULL,
    generation_error TEXT NULL,
    sync_status    ENUM('not_sent','pending','sent','failed','disabled') NOT NULL DEFAULT 'not_sent',
    sync_attempts  INT UNSIGNED NOT NULL DEFAULT 0,
    last_error     TEXT NULL,
    external_id    VARCHAR(100) NULL,
    sent_at        TIMESTAMP NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_export_survey (survey_id),
    KEY idx_export_sync (sync_status, sync_attempts),
    KEY idx_export_laid (laid),
    CONSTRAINT fk_export_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
    CONSTRAINT fk_export_bill   FOREIGN KEY (bill_id)   REFERENCES survey_bills(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    COMMENT='Composite survey PDF + outbound sync state (v2 s5)';

END $$

DELIMITER ;

CALL _v2_migrate();
DROP PROCEDURE _v2_migrate;

INSERT INTO system_config (config_key, config_value, value_type, description, category) VALUES
  ('bill_fee_default',            '1000', 'number', 'Default professional fee on a survey bill (INR)', 'billing'),
  ('bill_conveyance_rate_per_km', '15',   'number', 'Conveyance rate per km (INR)',                    'billing'),
  ('bill_photo_rate',             '10',   'number', 'Rate per billable photo (INR)',                   'billing'),
  ('bill_gst_percent',            '18',   'number', 'GST percentage applied to the taxable value',     'billing'),
  ('platform_state',              '',     'string', 'Platform state of supply - drives CGST+SGST vs IGST', 'billing'),
  ('platform_gstin',              '',     'string', 'Platform GSTIN printed on the invoice',           'billing'),
  ('invoice_number_prefix',       'CM',   'string', 'Invoice number prefix',                           'billing'),
  ('bill_reminder_after_days',    '3',    'number', 'Nag admins about unbilled completed surveys after N days', 'billing'),
  ('cm_sync_enabled',      'false', 'boolean', 'Push completed surveys to main ClaimsMitra. Leave false until the API contract exists.', 'integration'),
  ('cm_sync_base_url',     '',      'string',  'Main ClaimsMitra API base URL',                    'integration'),
  ('cm_sync_api_key',      '',      'string',  'API key for the main ClaimsMitra endpoint',        'integration'),
  ('cm_sync_max_attempts', '5',     'number',  'Give up pushing after this many failed attempts',  'integration')
ON DUPLICATE KEY UPDATE config_key = config_key;

SET @an_type := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_notifications'
                   AND COLUMN_NAME='notification_type');
SET @an_sql := IF(@an_type NOT LIKE '%bill_settled%',
  "ALTER TABLE app_notifications MODIFY COLUMN notification_type ENUM(
     'survey_created','survey_assigned','survey_started','surveyor_arrived',
     'report_submitted','report_accepted','report_rejected','payment_received',
     'payment_released','new_chat_message','broadcast_request','broadcast_expired',
     'payment_completed','timeout_warning','employee_invite','employee_invite_response',
     'bill_issued','bill_settled','system','other') NOT NULL DEFAULT 'other'",
  'SELECT 1');
PREPARE _an FROM @an_sql; EXECUTE _an; DEALLOCATE PREPARE _an;

DELETE FROM system_config WHERE config_key = 'surveyor_payout_percentage';

DROP PROCEDURE IF EXISTS sp_generate_laid;
