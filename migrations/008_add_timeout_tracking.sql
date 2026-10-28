ALTER TABLE surveys 
ADD COLUMN timeout_warning_sent_at DATETIME NULL AFTER completed_at,
ADD COLUMN admin_resolved_at DATETIME NULL AFTER timeout_warning_sent_at;
