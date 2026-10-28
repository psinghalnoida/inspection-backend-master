-- Migration: Add video support to survey_photos table
-- Also add captured_at timestamp for date/time stamp functionality

-- Add media_type column to distinguish between photos and videos
ALTER TABLE survey_photos 
ADD COLUMN media_type ENUM('image', 'video') DEFAULT 'image' AFTER photo_type;

-- Add video-specific columns
ALTER TABLE survey_photos 
ADD COLUMN video_duration_seconds INT UNSIGNED NULL COMMENT 'Duration of video in seconds' AFTER media_type;

ALTER TABLE survey_photos 
ADD COLUMN video_thumbnail_url VARCHAR(500) NULL COMMENT 'Thumbnail image for video preview' AFTER video_duration_seconds;

-- Add captured_at timestamp for when the media was actually captured (for date/time stamp)
ALTER TABLE survey_photos 
ADD COLUMN captured_at TIMESTAMP NULL COMMENT 'When the photo/video was actually captured on device' AFTER photo_taken_at;

-- Add index on media_type for filtering
ALTER TABLE survey_photos ADD INDEX idx_survey_photos_media_type (media_type);

-- Update existing records to have media_type = 'image'
UPDATE survey_photos SET media_type = 'image' WHERE media_type IS NULL;
