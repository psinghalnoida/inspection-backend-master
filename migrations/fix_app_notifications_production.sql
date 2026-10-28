-- ============================================================
-- Production Fix: app_notifications table missing columns
-- Date: 2026-04-02
-- Run this on production MySQL server
-- ============================================================

-- Add missing columns and fix notification_type from VARCHAR to ENUM
ALTER TABLE app_notifications
  ADD COLUMN icon VARCHAR(100) NULL COMMENT 'Material icon name for display' AFTER body,
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
    'system',
    'other'
  ) NOT NULL DEFAULT 'other',
  ADD COLUMN data JSON NULL COMMENT 'Additional data for deep linking' AFTER reference_id,
  ADD COLUMN read_at TIMESTAMP NULL AFTER is_read,
  ADD COLUMN push_sent BOOLEAN DEFAULT FALSE AFTER read_at,
  ADD COLUMN push_sent_at TIMESTAMP NULL AFTER push_sent;

-- Add performance indexes
ALTER TABLE app_notifications
  ADD INDEX idx_app_notif_recipient (recipient_type, recipient_id),
  ADD INDEX idx_app_notif_type (notification_type),
  ADD INDEX idx_app_notif_read (is_read),
  ADD INDEX idx_app_notif_created (created_at DESC),
  ADD INDEX idx_app_notif_reference (reference_type, reference_id);
