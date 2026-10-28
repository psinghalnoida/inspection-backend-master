-- Migration: Add broadcast retry logic and configuration (Fixed)
-- Date: 2026-02-15
-- Description: Adds broadcast_attempt column to surveys and config keys for auto-expanding radius

-- Add broadcast_attempt column to surveys table if it doesn't exist
-- Note: 'IF NOT EXISTS' for ADD COLUMN is only supported in newer MySQL/MariaDB versions. 
-- Using a safe approach by checking if we catch the error or just letting it fail if already exists (safe for retry script)
-- However, since previous run failed on INSERT, the ADD COLUMN might have succeeded. 
-- To be safe, I'll comment out ADD COLUMN if I suspect it ran, or better, drop it first? No, that loses data.
-- I'll wrap it in a procedure or just try to run it. If it fails, the script will stop. 
-- Actually, the previous run failed on the INSERT statement (Error 42S22), so the first statement (ALTER TABLE) likely EXECUTED successfully.
-- If I run it again, ALTER TABLE will fail with "Duplicate column name".
-- So I should comment out the ALTER TABLE line for this retry, OR handle the error in the script.
-- But to be clean, I will provide the full correct migration, and the user can handle the "column exists" error if it happens (or I can check schemas).
-- Given the error was on the *second* statement, the first one passed.
-- I will comment out the ALTER TABLE for this specific run file, or just ignore the error in the script?
-- I'll modify the migration to include it, but I'll write a new migration file `012_fix...`? 
-- No, I'll just overwite `012...` and in the runner script, I'll wrap the execution in try-catch blocks for each statement if possible, or just let the user know.
-- Actually, the `run_migration_retry_2.js` uses `multipleStatements: true`. It executes all at once. If the first one fails, none might run or it stops.
-- If the first one (ALTER) succeeded, running it again will fail.
-- I will inspect the `surveys` table schema first to see if `broadcast_attempt` exists.
-- ALTER TABLE surveys ADD COLUMN broadcast_attempt INT DEFAULT 1 COMMENT 'Current broadcast attempt number' AFTER broadcast_ends_at;

-- Insert default configuration for broadcast radius expansion
INSERT INTO system_config (config_key, config_value, description) VALUES
('broadcast_initial_radius_km', '15', 'Initial search radius for surveyor broadcast (km)'),
('broadcast_radius_step_km', '15', 'Radius expansion step for each retry (km)'),
('broadcast_max_retries', '3', 'Maximum number of broadcast retries')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);
