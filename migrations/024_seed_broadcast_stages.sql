-- Migration 024: Seed admin-editable broadcast radius stages
-- Adds the three broadcast-attempt radii to system_config (category 'broadcast').
-- They surface automatically in the admin Settings page as editable number
-- fields, and drive the survey broadcast retry/escalation (attempt 1 -> stage 1,
-- attempt 2 -> stage 2, attempt 3 -> stage 3).
--
-- Idempotent: ON DUPLICATE KEY UPDATE is a no-op, so re-running won't overwrite
-- values an admin has already customized.

INSERT INTO system_config (config_key, config_value, value_type, description, category, is_editable) VALUES
  ('broadcast_stage_1_km', '15', 'number', 'Radius for the 1st broadcast attempt (km)', 'broadcast', 1),
  ('broadcast_stage_2_km', '30', 'number', 'Radius for the 2nd broadcast attempt (km)', 'broadcast', 1),
  ('broadcast_stage_3_km', '45', 'number', 'Radius for the 3rd broadcast attempt (km)', 'broadcast', 1)
ON DUPLICATE KEY UPDATE config_key = config_key;
