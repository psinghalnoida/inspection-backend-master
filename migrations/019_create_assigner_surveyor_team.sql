-- Assigner's surveyor team: only assigners with is_direct_assign=TRUE can use direct assignment,
-- and when they do, they must pick a surveyor from their team (set up by admin).
-- One surveyor can belong to multiple assigners' teams.

CREATE TABLE IF NOT EXISTS assigner_surveyor_team (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assigner_id BIGINT UNSIGNED NOT NULL,
  surveyor_id BIGINT UNSIGNED NOT NULL,
  added_by_admin_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_assigner_surveyor (assigner_id, surveyor_id),
  KEY idx_assigner (assigner_id),
  KEY idx_surveyor (surveyor_id),
  CONSTRAINT fk_team_assigner FOREIGN KEY (assigner_id) REFERENCES assigners(id) ON DELETE CASCADE,
  CONSTRAINT fk_team_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE,
  CONSTRAINT fk_team_admin FOREIGN KEY (added_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
