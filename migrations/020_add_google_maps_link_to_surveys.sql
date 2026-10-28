-- Migration 020: Add optional Google Maps link to surveys
-- Lets assigners attach a maps URL during survey creation regardless of
-- the chosen location method (manual_coordinates, pincode_entry, sms_link).
-- Surfaced as an "Open in Google Maps" CTA on assigner + surveyor detail screens.

ALTER TABLE surveys
  ADD COLUMN google_maps_link VARCHAR(2048) NULL COMMENT 'Optional Google/Apple Maps URL provided by assigner'
  AFTER address;
