-- Migration: Add gst_number to assigners table
-- Created: 2026-02-13

ALTER TABLE assigners 
ADD COLUMN gst_number VARCHAR(15) NULL COMMENT 'GSTIN of the company' 
AFTER contact_person_name;
