-- Migration 026: Employee consent on assigner_surveyor_team
-- Spec: v2-spec.md §2
--
-- MODEL: team membership IS employment. There is deliberately no `is_employee`
-- column and no "employer broadcast" concept. A row in assigner_surveyor_team
-- means: this assigner may direct-assign this surveyor, and this surveyor is
-- their employee. The only thing the table was missing is CONSENT.
--
-- Two routes to a surveyor, cleanly separated:
--   Route A — direct assignment: only to this assigner's ACCEPTED team members.
--   Route B — open broadcast:    everyone EXCEPT non-Prime accepted employees.
-- Prime surveyors are never excluded by employment.

ALTER TABLE assigner_surveyor_team
  ADD COLUMN status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending'
    COMMENT 'Surveyor consent to being this assigner''s employee (v2 §2.2)',
  ADD COLUMN invited_by ENUM('admin','assigner') NOT NULL DEFAULT 'admin'
    COMMENT 'Who initiated the invite',
  ADD COLUMN responded_at TIMESTAMP NULL
    COMMENT 'When the surveyor accepted or declined';

ALTER TABLE assigner_surveyor_team
  ADD INDEX idx_team_surveyor_status (surveyor_id, status);

-- Backfill: grandfather every existing row as accepted.
--
-- Backfilling 'pending' instead would instantly break direct assignment for
-- every current team member, because the direct-assign gate becomes
-- `AND status = 'accepted'` in the same release.
UPDATE assigner_surveyor_team SET status = 'accepted', responded_at = created_at;

-- New notification type for the invite (v2 §2.4).
-- An unlisted type silently falls back to 'other' and renders unstyled — which
-- is exactly what already happens to dispute notifications today.
ALTER TABLE app_notifications
  MODIFY COLUMN notification_type ENUM(
      'survey_created',
      'survey_assigned',
      'survey_started',
      'surveyor_arrived',
      'report_submitted',
      'report_accepted',
      'report_rejected',
      'payment_received',
      'payment_released',
      'new_chat_message',
      'broadcast_request',
      'broadcast_expired',
      'payment_completed',
      'timeout_warning',
      'employee_invite',
      'employee_invite_response',
      'system',
      'other'
  ) NOT NULL DEFAULT 'other';

-- ---------------------------------------------------------------------------
-- PRE-DEPLOY CHECK — run this BEFORE applying the migration.
--
-- Because team membership now means employment, every existing NON-PRIME team
-- member drops out of open broadcasts on deploy day. That is a silent income
-- cut for people who were never asked. Count them first; if the number is
-- material, invite them (status='pending') instead of grandfathering.
--
--   SELECT sv.id, sv.full_name, sv.phone, a.company_name
--     FROM assigner_surveyor_team t
--     JOIN surveyors sv ON sv.id = t.surveyor_id
--     JOIN assigners a  ON a.id = t.assigner_id
--    WHERE NOT EXISTS (
--            SELECT 1 FROM surveyor_categories sc
--             WHERE sc.surveyor_id = sv.id
--               AND (sc.valid_until IS NULL OR sc.valid_until >= CURDATE())
--          );
-- ---------------------------------------------------------------------------
