-- Migration 021: Per-session media and notes
-- Surveyors can return to a survey ("Add More Media" mode) and capture
-- additional photos/videos/notes. Without a session marker every batch was
-- piled into one flat list and notes overwrote each other. This migration
-- tags every photo/video with the session it belongs to and stores notes
-- per session in a dedicated table.

ALTER TABLE survey_photos
  ADD COLUMN session_number INT NOT NULL DEFAULT 1 COMMENT 'Visit/session this media belongs to (1 = first visit)'
  AFTER caption,
  ADD INDEX idx_survey_session (survey_id, session_number);

CREATE TABLE IF NOT EXISTS survey_session_notes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  survey_id BIGINT UNSIGNED NOT NULL,
  surveyor_id BIGINT UNSIGNED NOT NULL,
  session_number INT NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_survey_session (survey_id, session_number),
  INDEX idx_survey (survey_id),
  CONSTRAINT fk_session_notes_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
);
