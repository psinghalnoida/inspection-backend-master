-- Migration 028: Assigner ledger, bank details, report gating support
-- Spec: v2-spec.md §4
--
-- SIGN CONVENTION, stated once so nobody has to guess:
--   balance_after > 0  => the ASSIGNER OWES the admin
--   balance_after < 0  => the ADMIN OWES the assigner
--
-- A debit increases what the assigner owes (a bill).
-- A credit decreases it (money received, or a refund we grant).

CREATE TABLE IF NOT EXISTS assigner_ledger_entries (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assigner_id    BIGINT UNSIGNED NOT NULL,
  entry_type     ENUM('debit','credit') NOT NULL,
  amount         DECIMAL(12,2) NOT NULL COMMENT 'Always positive; entry_type carries the direction',
  balance_after  DECIMAL(12,2) NOT NULL COMMENT 'Running net payable after this entry',
  reference_type ENUM('advance_payment','bill','balance_payment','refund','adjustment','opening') NOT NULL,
  reference_id   BIGINT UNSIGNED NULL COMMENT 'payments.id or survey_bills.id',
  survey_id      BIGINT UNSIGNED NULL,
  description    VARCHAR(255) NULL,
  created_by_admin_id BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  KEY idx_ledger_assigner (assigner_id, id),
  KEY idx_ledger_survey (survey_id),
  -- One ledger entry per (reference_type, reference_id) pair. Makes every writer
  -- idempotent at the DB level: a retried callback or a double-clicked settle
  -- cannot post the same money twice. NULL reference_id (adjustments, opening)
  -- is exempt because UNIQUE ignores NULLs.
  UNIQUE KEY uq_ledger_reference (reference_type, reference_id),
  CONSTRAINT fk_ledger_assigner FOREIGN KEY (assigner_id) REFERENCES assigners(id) ON DELETE CASCADE,
  CONSTRAINT fk_ledger_survey   FOREIGN KEY (survey_id)   REFERENCES surveys(id)   ON DELETE SET NULL,
  CONSTRAINT fk_ledger_admin    FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Running account between the platform and an assigner (v2 §4)';

-- Bank details, so an admin-owes-assigner balance can actually be refunded.
-- This is the only reason v2 asks for them.
ALTER TABLE assigners
  ADD COLUMN bank_account_number_encrypted VARCHAR(500) NULL COMMENT 'Encrypted bank account number',
  ADD COLUMN bank_ifsc_code            VARCHAR(11)  NULL,
  ADD COLUMN bank_account_holder_name   VARCHAR(100) NULL,
  ADD COLUMN bank_name                  VARCHAR(100) NULL;

-- Backfill: one CREDIT (money received) and one matching DEBIT (the survey
-- charge it paid for) per historical completed payment.
--
-- Net zero, so every assigner starts at a balance of 0 while their full history
-- stays visible. Backfilling only credits would show every assigner as being owed
-- thousands of rupees on day one.
--
-- Ordered by payment id so balance_after is monotonic and the statement reads
-- correctly. Both legs of a pair carry the same balance_after because they
-- cancel out.
INSERT INTO assigner_ledger_entries
  (assigner_id, entry_type, amount, balance_after, reference_type, reference_id, survey_id, description, created_at)
SELECT p.assigner_id, 'debit', p.final_amount, 0, 'bill', NULL, p.survey_id,
       CONCAT('Survey charge (pre-v2 slab pricing)', IFNULL(CONCAT(' — ', s.laid), '')), p.paid_at
  FROM payments p
  LEFT JOIN surveys s ON s.id = p.survey_id
 WHERE p.status = 'completed';

INSERT INTO assigner_ledger_entries
  (assigner_id, entry_type, amount, balance_after, reference_type, reference_id, survey_id, description, created_at)
SELECT p.assigner_id, 'credit', p.final_amount, 0, 'advance_payment', p.id, p.survey_id,
       CONCAT('Advance payment received', IFNULL(CONCAT(' — ', s.laid), '')), p.paid_at
  FROM payments p
  LEFT JOIN surveys s ON s.id = p.survey_id
 WHERE p.status = 'completed';

-- ---------------------------------------------------------------------------
-- PAYOUT PERCENTAGE — remove the dead config key (v2 §4.5).
--
-- Three values disagreed before this release:
--   platform_commission_percent = 25   <- the only correct one, kept
--   surveyor_payout_percentage  = 40   <- read into a variable and never used
--   a hardcoded 75 in survey.controller.js
--
-- The hardcoded 75 happened to equal 100-25, so nothing looked broken — until an
-- admin edited the percentage, at which point the assigner was charged on the new
-- rate and the surveyor credited on the old one.
DELETE FROM system_config WHERE config_key = 'surveyor_payout_percentage';

-- ---------------------------------------------------------------------------
-- POST-MIGRATION CHECK: every assigner should start at zero.
--
--   SELECT assigner_id,
--          SUM(IF(entry_type='debit', amount, -amount)) AS net_payable
--     FROM assigner_ledger_entries
--    GROUP BY assigner_id
--   HAVING net_payable <> 0;
--
-- Any row returned means a payment row had no matching charge — investigate
-- before letting the report gate go live.
-- ---------------------------------------------------------------------------
