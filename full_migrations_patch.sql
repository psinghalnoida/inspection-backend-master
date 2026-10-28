-- =====================================================
-- ClaimsMitra - Full Database Schema Patch (2026-03-08)
-- =====================================================
-- This file consolidates all missing tables and schema updates.
-- Run this on your production database to ensure compatibility.
-- =====================================================

-- 1. Phone OTP Verification (Registration/Login)
CREATE TABLE IF NOT EXISTS phone_otp_verifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL COMMENT 'Hashed OTP or verification token',
    purpose VARCHAR(50) NOT NULL DEFAULT 'registration' COMMENT 'e.g., registration, reset_password',
    attempts INT DEFAULT 0 COMMENT 'Number of failed verification attempts',
    max_attempts INT DEFAULT 3 COMMENT 'Maximum allowed attempts before expiry',
    verified_at TIMESTAMP NULL COMMENT 'When the OTP was successfully verified',
    expires_at TIMESTAMP NOT NULL COMMENT 'When the OTP or verification token expires',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_otp_phone_purpose (phone, purpose),
    INDEX idx_otp_expires (expires_at),
    INDEX idx_otp_verified (verified_at)
) ENGINE=InnoDB COMMENT='Phone OTP verification tracking';

-- 2. Password Reset Tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_type ENUM('admin', 'assigner', 'surveyor') NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_reset_token (token),
    INDEX idx_reset_user (user_type, user_id),
    INDEX idx_reset_expires (expires_at)
) ENGINE=InnoDB COMMENT='Password reset tokens for all user types';

-- 3. Survey Applications & Broadcast Update
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS broadcast_ends_at TIMESTAMP NULL AFTER surveyor_assigned_at;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS broadcast_attempt INT DEFAULT 1 COMMENT 'Current broadcast attempt number' AFTER broadcast_ends_at;

CREATE TABLE IF NOT EXISTS survey_applications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    time_to_start_minutes INT UNSIGNED NOT NULL COMMENT 'Minutes to start provided by surveyor',
    estimated_travel_time_minutes INT UNSIGNED NULL COMMENT 'Travel time from Google Maps',
    total_eta_minutes INT UNSIGNED NULL COMMENT 'time_to_start + estimated_travel_time',
    status ENUM('applied', 'selected', 'rejected') DEFAULT 'applied',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_apps_survey (survey_id),
    INDEX idx_apps_surveyor (surveyor_id),
    CONSTRAINT fk_apps_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_apps_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE KEY uk_apps_survey_surveyor (survey_id, surveyor_id)
) ENGINE=InnoDB COMMENT='Surveyors applying for a broadcasted survey';

-- 4. In-App Notifications & Device Tokens
CREATE TABLE IF NOT EXISTS device_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    fcm_token VARCHAR(500) NOT NULL COMMENT 'Firebase Cloud Messaging token',
    device_type ENUM('ios', 'android', 'web') DEFAULT 'android',
    device_id VARCHAR(255) NULL COMMENT 'Unique device identifier',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_device (user_type, user_id, device_id)
) ENGINE=InnoDB COMMENT='FCM device tokens for push notifications';

CREATE TABLE IF NOT EXISTS app_notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recipient_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    recipient_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    notification_type VARCHAR(50) NOT NULL DEFAULT 'other',
    reference_type VARCHAR(50) NULL,
    reference_id BIGINT UNSIGNED NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_app_notif_recipient (recipient_type, recipient_id)
) ENGINE=InnoDB COMMENT='In-app notifications for notification center';

-- 5. Surveyor Wallet & Transactions
CREATE TABLE IF NOT EXISTS surveyor_wallets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    surveyor_id BIGINT UNSIGNED NOT NULL UNIQUE,
    balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    total_earned DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    total_withdrawn DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_wallet_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Surveyor wallet balances';

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    type ENUM('credit', 'debit') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    balance_after DECIMAL(12, 2) NOT NULL,
    reference_type ENUM('survey_payout', 'withdrawal', 'adjustment', 'bonus', 'refund') NOT NULL,
    reference_id BIGINT UNSIGNED NULL,
    status ENUM('completed', 'pending', 'failed') DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_wallet_txn_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Wallet transaction history';

-- 6. Important Schema Updates
-- Add GST to assigners
ALTER TABLE assigners ADD COLUMN IF NOT EXISTS gst_number VARCHAR(15) NULL COMMENT 'GSTIN of the company' AFTER contact_person_name;

-- Add permissions to assigners
ALTER TABLE assigners ADD COLUMN IF NOT EXISTS can_assign_surveyor BOOLEAN DEFAULT FALSE;
ALTER TABLE assigners ADD COLUMN IF NOT EXISTS allowed_surveyor_ids JSON NULL;

-- Add remarks to status history
ALTER TABLE survey_status_history ADD COLUMN IF NOT EXISTS remarks TEXT NULL AFTER changed_by_id;

-- Add payout type to payouts
ALTER TABLE surveyor_payouts ADD COLUMN IF NOT EXISTS payout_type ENUM('full', 'partial', 'balance') DEFAULT 'full';

-- Add media features to photos
ALTER TABLE survey_photos ADD COLUMN IF NOT EXISTS source_type ENUM('camera', 'gallery') DEFAULT 'camera' AFTER photo_type;
ALTER TABLE survey_photos ADD COLUMN IF NOT EXISTS media_type ENUM('image', 'video') DEFAULT 'image' AFTER photo_type;
ALTER TABLE survey_photos ADD COLUMN IF NOT EXISTS video_duration_seconds INT UNSIGNED NULL AFTER media_type;
ALTER TABLE survey_photos ADD COLUMN IF NOT EXISTS video_thumbnail_url VARCHAR(500) NULL AFTER video_duration_seconds;
ALTER TABLE survey_photos ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP NULL AFTER photo_taken_at;

-- Add timeout tracking to surveys
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS timeout_warning_sent_at DATETIME NULL AFTER completed_at;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS admin_resolved_at DATETIME NULL AFTER timeout_warning_sent_at;

-- 7. System Configuration Updates
ALTER TABLE system_config MODIFY COLUMN IF NOT EXISTS value_type ENUM('string','number','boolean','json','text') DEFAULT 'string';

INSERT INTO system_config (config_key, config_value, value_type, description, category) 
VALUES 
('surveyor_payout_percentage', '40', 'number', 'Percentage of assigner payment to transfer to surveyor', 'pricing'),
('survey_satisfaction_timeout_days', '7', 'number', 'Days after which a survey prompts for satisfaction', 'timing'),
('broadcast_stage_1_km', '15', 'Radius for 1st broadcast (km)', 'broadcast', 'number'),
('broadcast_stage_2_km', '30', 'Radius for 2nd broadcast (km)', 'broadcast', 'number'),
('broadcast_stage_3_km', '45', 'Radius for 3rd broadcast (km)', 'broadcast', 'number')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

DELETE FROM system_config WHERE config_key IN ('surveyor_notification_radius_km', 'broadcast_stages_km', 'broadcast_initial_radius_km', 'broadcast_radius_step_km', 'broadcast_max_retries');
