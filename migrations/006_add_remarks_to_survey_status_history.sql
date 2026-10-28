-- Migration: Add remarks column to survey_status_history
-- Description: The remarks column was defined in the schema but may be missing from the database
-- Date: 2025-12-29

-- Add remarks column (check if exists first: SHOW COLUMNS FROM survey_status_history LIKE 'remarks')
ALTER TABLE survey_status_history 
ADD COLUMN remarks TEXT NULL COMMENT 'Optional notes about the change' 
AFTER changed_by_id;
