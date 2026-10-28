-- Fix device_tokens table - add missing column
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP NULL AFTER is_active;

-- Fix app_notifications table - add missing columns
ALTER TABLE app_notifications ADD COLUMN IF NOT EXISTS icon VARCHAR(100) NULL AFTER body;
ALTER TABLE app_notifications ADD COLUMN IF NOT EXISTS data JSON NULL AFTER reference_id;
ALTER TABLE app_notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL AFTER is_read;
ALTER TABLE app_notifications ADD COLUMN IF NOT EXISTS push_sent BOOLEAN DEFAULT FALSE AFTER read_at;
ALTER TABLE app_notifications ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMP NULL AFTER push_sent;
