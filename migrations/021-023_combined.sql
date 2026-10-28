-- =====================================================
-- Combined migration: 021 + 022 + 023
-- Run this ONCE on the live database. Apply EITHER this combined file
-- OR the individual 021/022/023 files — not both.
-- =====================================================

-- -----------------------------------------------------
-- 021: Allow 'google_maps_link' as a survey location method
-- Lets assigners create a survey using ONLY a Google/Apple Maps URL as the
-- location source. The backend extracts coordinates from the link, flips the
-- survey to 'location_detected', and starts the broadcast.
-- (Idempotent — safe to re-run.)
-- -----------------------------------------------------
ALTER TABLE surveys
  MODIFY COLUMN location_method
    ENUM('gps_auto', 'manual_coordinates', 'sms_link', 'pincode_entry', 'google_maps_link')
    NOT NULL;

-- -----------------------------------------------------
-- 022: Survey archiving (admin)
-- Lets admins move old terminal surveys out of the main list into an archive.
-- NOTE: run once — ADD COLUMN / CREATE INDEX error if they already exist.
-- -----------------------------------------------------
ALTER TABLE surveys
  ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Admin archive flag — hidden from the default surveys list' AFTER status,
  ADD COLUMN archived_at DATETIME NULL COMMENT 'When the survey was archived' AFTER is_archived,
  ADD COLUMN archived_by BIGINT UNSIGNED NULL COMMENT 'Admin user id who archived it (matches admins.id type)' AFTER archived_at;

CREATE INDEX idx_surveys_is_archived ON surveys (is_archived);

-- -----------------------------------------------------
-- 023: Admin-controlled mobile app force-update settings
-- Adds an 'app_update' config category surfaced via the public /config/app
-- endpoint. The mobile app checks its version against these on launch.
-- (Idempotent — ON DUPLICATE KEY makes it safe to re-run.)
-- -----------------------------------------------------
INSERT INTO system_config (config_key, config_value, value_type, description, category, is_editable) VALUES
  ('latest_app_version', '1.0.6', 'string', 'Latest mobile app version available on the stores', 'app_update', 1),
  ('min_supported_version', '1.0.0', 'string', 'Minimum allowed app version. Users below this are FORCED to update.', 'app_update', 1),
  ('force_update', 'false', 'boolean', 'Force every user below the latest version to update immediately', 'app_update', 1),
  ('update_title', 'Update Required', 'string', 'Title shown in the in-app update dialog', 'app_update', 1),
  ('update_message', 'A new version of ClaimsMitra is available. Please update to continue.', 'string', 'Message shown in the in-app update dialog', 'app_update', 1),
  ('android_store_url', 'https://play.google.com/store/apps/details?id=com.xenotix.claimsmitra', 'string', 'Google Play Store URL for the Android app', 'app_update', 1),
  ('ios_store_url', 'https://apps.apple.com/sg/app/claimsmitra/id6760928718', 'string', 'Apple App Store URL for the iOS app', 'app_update', 1)
ON DUPLICATE KEY UPDATE config_key = config_key;
