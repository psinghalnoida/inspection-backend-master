-- Migration 027: Itemised survey billing
-- Spec: v2-spec.md §3
--
-- MODEL: the existing pricing_tiers charge stays as an ADVANCE, paid before the
-- surveyor travels. The admin's itemised bill is the FINAL INVOICE. The advance
-- is credited against it, and the difference is the "balance payment".
--
--   Advance paid (slab)            2,500
--   Final invoice (incl. GST)      3,304
--   -------------------------------------
--   Balance due from assigner        804
--
-- A NEW TABLE is required rather than a second `payments` row, because
-- `payments.survey_id` is UNIQUE — the schema structurally cannot hold two.
--
-- SCOPE: only broadcast surveys are billed. Direct-assign surveys stay free
-- (v2 §3.6) — no advance, no bill, no report gate, no payout.

CREATE TABLE IF NOT EXISTS survey_bills (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- NOT unique on its own: a cancelled bill must be replaceable (see
  -- active_survey_id below), otherwise "cancel and re-raise" is impossible.
  survey_id           BIGINT UNSIGNED NOT NULL,
  assigner_id         BIGINT UNSIGNED NOT NULL,
  invoice_number      VARCHAR(32) NULL UNIQUE COMMENT 'Assigned on issue, e.g. CM/2026-27/00042',

  -- Line items. Quantities are SNAPSHOTTED at issue time so that media added
  -- later (the mobile offline queue can flush days after the visit) never
  -- silently changes an already-issued tax invoice.
  fee_amount          DECIMAL(10,2) NOT NULL DEFAULT 0,
  conveyance_km       DECIMAL(10,2) NOT NULL DEFAULT 0,
  conveyance_rate     DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'INR per km, snapshotted',
  conveyance_amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
  da_toll_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
  photo_count         INT UNSIGNED  NOT NULL DEFAULT 0,
  photo_rate          DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'INR per photo, snapshotted',
  photo_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Tax. Full CGST/SGST/IGST split stored from day one: recording only a single
  -- gst_amount means re-issuing every tax document the first time an auditor
  -- asks for the split.
  taxable_value       DECIMAL(10,2) NOT NULL DEFAULT 0,
  gst_percent         DECIMAL(5,2)  NOT NULL DEFAULT 18.00,
  cgst_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  sgst_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  igst_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  place_of_supply_state VARCHAR(100) NULL COMMENT 'Assigner state at issue time',
  total_amount        DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'taxable_value + GST',

  -- Settlement against the advance already collected via pricing_tiers.
  advance_adjusted    DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_paid         DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Balance received after issue',
  balance_due         DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'total - advance - paid; negative = refund owed',

  status              ENUM('draft','issued','settled','cancelled') NOT NULL DEFAULT 'draft',

  -- At most ONE live bill per survey, unlimited cancelled ones. NULL rows are
  -- ignored by a UNIQUE index, so this enforces the rule the controllers assume
  -- ("this survey already has a X bill") at the DB level, where a concurrent
  -- double-submit cannot slip past a check-then-insert.
  active_survey_id    BIGINT UNSIGNED GENERATED ALWAYS AS
                        (IF(status = 'cancelled', NULL, survey_id)) STORED,

  notes               TEXT NULL,
  created_by_admin_id BIGINT UNSIGNED NULL,
  settled_by_admin_id BIGINT UNSIGNED NULL,
  settlement_method   VARCHAR(50) NULL COMMENT 'online | offline | waived | credit_adjustment',
  issued_at           TIMESTAMP NULL,
  settled_at          TIMESTAMP NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_bills_assigner (assigner_id),
  KEY idx_bills_status (status),
  KEY idx_bills_survey (survey_id),
  UNIQUE KEY uq_bills_active_survey (active_survey_id),
  -- RESTRICT, not CASCADE: survey_id is the base column of the STORED generated
  -- column active_survey_id, and MySQL rejects a referential action on it
  -- (errno 1215). RESTRICT is also correct for a tax document.
  CONSTRAINT fk_bill_survey   FOREIGN KEY (survey_id)   REFERENCES surveys(id)   ON DELETE RESTRICT,
  CONSTRAINT fk_bill_assigner FOREIGN KEY (assigner_id) REFERENCES assigners(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bill_admin    FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT fk_bill_settler  FOREIGN KEY (settled_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Itemised final invoice per survey (v2 §3)';

-- GST requires a consecutive serial number per financial year, so the invoice
-- number cannot just be survey_bills.id. This is the standard atomic counter:
--   INSERT ... ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)
-- then SELECT LAST_INSERT_ID() — allocation is a single statement, no race.
CREATE TABLE IF NOT EXISTS invoice_sequences (
  fiscal_year VARCHAR(9) NOT NULL PRIMARY KEY COMMENT 'Indian FY, e.g. 2026-27 (Apr 1 - Mar 31)',
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-financial-year invoice number counter (v2 §3.2)';

-- Default rates. Snapshotted onto each bill at issue, so changing these never
-- mutates an invoice that has already gone out.
INSERT INTO system_config (config_key, config_value, value_type, description, category) VALUES
  ('bill_fee_default',            '1000', 'number', 'Default professional fee on a survey bill (INR)', 'billing'),
  ('bill_conveyance_rate_per_km', '15',   'number', 'Conveyance rate per km (INR)',                    'billing'),
  ('bill_photo_rate',             '10',   'number', 'Rate per billable photo (INR)',                   'billing'),
  ('bill_gst_percent',            '18',   'number', 'GST percentage applied to the taxable value',     'billing'),
  ('platform_state',              '',     'string', 'Platform state of supply — drives CGST+SGST vs IGST', 'billing'),
  ('platform_gstin',              '',     'string', 'Platform GSTIN printed on the invoice',           'billing'),
  ('invoice_number_prefix',       'CM',   'string', 'Invoice number prefix',                           'billing'),
  ('bill_reminder_after_days',    '3',    'number', 'Nag admins about unbilled completed surveys after N days', 'billing')
ON DUPLICATE KEY UPDATE config_key = config_key;

-- Notification types for the billing flow. Must repeat the full list — MySQL
-- ENUM changes are a whole-column replacement. Keep in sync with migration 026.
ALTER TABLE app_notifications
  MODIFY COLUMN notification_type ENUM(
      'survey_created',
      'survey_assigned',
      'survey_started',
      'surveyor_arrived',
      'report_submitted',
      'report_accepted',
      'report_rejected',
      'payment_received',
      'payment_released',
      'new_chat_message',
      'broadcast_request',
      'broadcast_expired',
      'payment_completed',
      'timeout_warning',
      'employee_invite',
      'employee_invite_response',
      'bill_issued',
      'bill_settled',
      'system',
      'other'
  ) NOT NULL DEFAULT 'other';

-- ---------------------------------------------------------------------------
-- IF AN EARLIER REVISION OF THIS FILE WAS ALREADY APPLIED, survey_id still
-- carries a plain UNIQUE key, which makes cancel-and-re-raise fail with a
-- duplicate-key error. Run these three statements once; skip them on a fresh
-- install (CREATE TABLE above already has the right shape):
--
-- The plain key MUST be added before the UNIQUE one is dropped: fk_bill_survey
-- needs an index on survey_id, and MySQL refuses to drop the last one that
-- serves it (errno 150).
--
--   ALTER TABLE survey_bills
--     ADD COLUMN active_survey_id BIGINT UNSIGNED GENERATED ALWAYS AS
--       (IF(status = 'cancelled', NULL, survey_id)) STORED AFTER status,
--     ADD KEY idx_bills_survey (survey_id);
--   ALTER TABLE survey_bills DROP INDEX survey_id;
--   ALTER TABLE survey_bills ADD UNIQUE KEY uq_bills_active_survey (active_survey_id);
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- BEFORE GOING LIVE: set platform_state and platform_gstin.
--
-- place_of_supply is derived from platform_state vs assigners.state. With
-- platform_state empty, every bill falls back to IGST, which is wrong for
-- intra-state supply and produces incorrect tax documents.
--
--   UPDATE system_config SET config_value = 'Uttar Pradesh' WHERE config_key = 'platform_state';
--   UPDATE system_config SET config_value = '09XXXXXXXXXXXZX' WHERE config_key = 'platform_gstin';
--
-- Also check for assigners with a NULL state — they cannot be billed correctly:
--   SELECT id, company_name, state, gst_number FROM assigners WHERE state IS NULL OR state = '';
-- ---------------------------------------------------------------------------
