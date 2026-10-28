-- Migration: Add broadcast retry logic and configuration
-- Date: 2026-02-15
-- Description: Adds broadcast_attempt column to surveys and config keys for auto-expanding radius

-- Add broadcast_attempt column to surveys table
ALTER TABLE surveys ADD COLUMN broadcast_attempt INT DEFAULT 1 COMMENT 'Current broadcast attempt number' AFTER broadcast_ends_at;

-- Insert default configuration for broadcast radius expansion
INSERT INTO system_config (config_key, config_value, description, data_type) VALUES
('broadcast_initial_radius_km', '15', 'Initial search radius for surveyor broadcast (km)', 'number'),
('broadcast_radius_step_km', '15', 'Radius expansion step for each retry (km)', 'number'),
('broadcast_max_retries', '3', 'Maximum number of broadcast retries', 'number')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);
