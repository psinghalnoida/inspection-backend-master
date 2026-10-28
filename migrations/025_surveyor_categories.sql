-- Migration 025: Surveyor categories, Investigator flag, Prime badge
-- Spec: v2-spec.md §1
--
-- Model:
--   * Investigator  = baseline capability on every approved surveyor (surveyors.is_investigator)
--   * Category      = a licensed line of business, granted by admin (surveyor_categories)
--   * Prime         = DERIVED, not stored: a surveyor holding >= 1 category row.
--
-- Investigator is deliberately NOT one of the categories. If it were, every
-- surveyor would hold >= 1 category, every surveyor would be Prime, and the
-- badge would distinguish nobody.

CREATE TABLE IF NOT EXISTS surveyor_categories (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  surveyor_id         BIGINT UNSIGNED NOT NULL,
  category            ENUM('motor','marine','fire','engineering','miscellaneous',
                           'lop','hull','aviation') NOT NULL,
  license_number      VARCHAR(50) NULL COMMENT 'Department-wise IRDAI licence number, if provided',
  valid_until         DATE NULL COMMENT 'Licence expiry — IRDAI licences are renewable',
  document_id         BIGINT UNSIGNED NULL COMMENT 'Optional link to the licence file in surveyor_documents',
  granted_by_admin_id BIGINT UNSIGNED NULL,
  granted_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_surveyor_category (surveyor_id, category),
  KEY idx_sc_surveyor (surveyor_id),
  KEY idx_sc_category (category),
  CONSTRAINT fk_sc_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE,
  CONSTRAINT fk_sc_document FOREIGN KEY (document_id) REFERENCES surveyor_documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_sc_admin    FOREIGN KEY (granted_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Licensed lines of business granted to a surveyor by admin at approval';

-- Every approved surveyor is an investigator by default.
ALTER TABLE surveyors
  ADD COLUMN is_investigator BOOLEAN NOT NULL DEFAULT TRUE
  COMMENT 'Baseline capability — every approved surveyor is an investigator (v2 §1)';

-- Backfill: grant motor + marine to every ALREADY-verified surveyor.
--
-- This is deliberately a ZERO-BEHAVIOUR-CHANGE migration. Only motor and marine
-- gate anything (the other six categories have no matching survey_type), so
-- granting these two keeps every currently-verified surveyor in exactly the same
-- broadcast pool they are in today. Admin prunes afterwards.
--
-- Backfilling nothing would empty the motor/marine broadcast pool on deploy day
-- and no motor survey would be assignable until an admin re-opened every surveyor.
INSERT IGNORE INTO surveyor_categories (surveyor_id, category, granted_by_admin_id)
SELECT id, 'motor', NULL FROM surveyors WHERE verification_status = 'verified';

INSERT IGNORE INTO surveyor_categories (surveyor_id, category, granted_by_admin_id)
SELECT id, 'marine', NULL FROM surveyors WHERE verification_status = 'verified';
