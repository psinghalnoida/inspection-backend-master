-- Migration: Refine broadcast configuration to use explicit stages (Fixed)
-- Date: 2026-02-15
-- Description: Replaces dynamic step calculation configs with a comma-separated list of stages

-- Alter ENUM to include 'text' (use MODIFY COLUMN)
ALTER TABLE system_config MODIFY COLUMN value_type ENUM('string','number','boolean','json','text') DEFAULT 'string';

-- Delete old configuration keys
DELETE FROM system_config WHERE config_key IN ('broadcast_initial_radius_km', 'broadcast_radius_step_km', 'broadcast_max_retries');

-- Insert new configuration key for explicit stages
INSERT INTO system_config (config_key, config_value, description, category, value_type) VALUES
('broadcast_stages_km', '15, 30, 45', 'Comma-separated list of broadcast radius stages in km (e.g. 15, 30, 45)', 'broadcast', 'text')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), description = VALUES(description), category = VALUES(category), value_type = VALUES(value_type);
