-- Migration: Consolidate escalation config keys
-- Date: 2025-12-26
-- Description: Remove duplicate unresolved_survey_followup_days config and update dispute_escalation_days description

-- Delete the duplicate config
DELETE FROM system_config WHERE config_key = 'unresolved_survey_followup_days';

-- Update the description of the remaining config to cover both use cases
UPDATE system_config 
SET description = 'Days for dispute auto-escalation and unresolved survey follow-up'
WHERE config_key = 'dispute_escalation_days';
