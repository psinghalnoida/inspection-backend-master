-- Migration: Cleanup legacy surveyor notification radius config
-- Date: 2026-02-15
-- Description: Deletes the legacy surveyor_notification_radius_km key as it is replaced by broadcast stages

DELETE FROM system_config WHERE config_key = 'surveyor_notification_radius_km';
