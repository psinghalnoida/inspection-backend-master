-- Migration: Add assigner permission fields
-- Date: 2026-01-16

ALTER TABLE assigners
ADD COLUMN can_assign_surveyor BOOLEAN DEFAULT FALSE COMMENT 'Can this assigner assign surveyors to their surveys?',
ADD COLUMN allowed_surveyor_ids JSON NULL COMMENT 'JSON array of surveyor IDs this assigner can assign (null = all)';
