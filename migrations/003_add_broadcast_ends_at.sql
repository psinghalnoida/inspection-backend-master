-- Migration: Add broadcast_ends_at column to surveys table
-- Date: 2025-12-26
-- Description: This column was missing from the initial schema but required by the broadcast service

ALTER TABLE surveys ADD COLUMN broadcast_ends_at TIMESTAMP NULL AFTER surveyor_assigned_at;
