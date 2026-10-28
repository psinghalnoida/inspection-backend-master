-- Migration: Separate broadcast stages into individual keys
-- Date: 2026-02-15
-- Description: Replaces single list config with 3 separate keys for admin inputs

-- Delete old configuration key
DELETE FROM system_config WHERE config_key = 'broadcast_stages_km';

-- Insert new configuration keys for separate stages
INSERT INTO system_config (config_key, config_value, description, category, value_type) VALUES
('broadcast_stage_1_km', '15', 'Radius for 1st broadcast attempt (km)', 'broadcast', 'number'),
('broadcast_stage_2_km', '30', 'Radius for 2nd broadcast attempt (km)', 'broadcast', 'number'),
('broadcast_stage_3_km', '45', 'Radius for 3rd broadcast attempt (km)', 'broadcast', 'number')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), description = VALUES(description), category = VALUES(category), value_type = VALUES(value_type);
