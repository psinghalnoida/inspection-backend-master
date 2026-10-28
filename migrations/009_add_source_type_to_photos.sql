-- Migration: Add source_type column to survey_photos
-- This tracks whether a photo was taken from the camera or selected from gallery
-- Note: This is different from photo_type which indicates selfie/live/sync_mode/gallery

-- Add source_type column
ALTER TABLE survey_photos 
ADD COLUMN source_type ENUM('camera', 'gallery') DEFAULT 'camera' 
COMMENT 'Whether photo was taken from camera or selected from gallery'
AFTER photo_type;

-- Add index for querying by source type
ALTER TABLE survey_photos ADD INDEX idx_survey_photos_source_type (source_type);
