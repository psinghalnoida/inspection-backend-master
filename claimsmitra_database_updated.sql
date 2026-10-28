-- =====================================================
-- ClaimsMitra Platform - COMPLETE Database Schema
-- =====================================================
-- Description: Survey management platform 
-- Combined Version: Base Schema + All Migrations (001-016)
-- Date: 2026-03-08
-- =====================================================

-- Create database
CREATE DATABASE IF NOT EXISTS claimsmitra
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE claimsmitra;

-- -----------------------------------------------------
-- SECTION 1: USER MANAGEMENT TABLES
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS admins (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(10) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    profile_picture_url VARCHAR(500) NULL,
    is_super_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_admins_email (email),
    INDEX idx_admins_phone (phone)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assigners (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(10) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    company_name VARCHAR(200) NULL,
    gst_number VARCHAR(15) NULL,
    contact_person_name VARCHAR(100) NULL,
    profile_picture_url VARCHAR(500) NULL,
    latitude DECIMAL(10, 8) NULL,
    longitude DECIMAL(11, 8) NULL,
    address TEXT NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(6) NULL,
    is_active BOOLEAN DEFAULT FALSE,
    can_assign_surveyor BOOLEAN DEFAULT FALSE,
    allowed_surveyor_ids JSON NULL,
    activated_by BIGINT UNSIGNED NULL,
    activated_at TIMESTAMP NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_assigners_phone (phone),
    INDEX idx_assigners_email (email),
    CONSTRAINT fk_assigners_created_by FOREIGN KEY (created_by) REFERENCES admins(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS surveyors (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(10) NOT NULL UNIQUE,
    profile_picture_url VARCHAR(500) NULL,
    password_hash VARCHAR(255) NOT NULL,
    pin_hash VARCHAR(255) NULL,
    surveyor_license_id VARCHAR(50) NULL,
    business_address TEXT NULL,
    current_latitude DECIMAL(10, 8) NULL,
    current_longitude DECIMAL(11, 8) NULL,
    location_updated_at TIMESTAMP NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(6) NULL,
    is_available BOOLEAN DEFAULT FALSE,
    verification_status ENUM('pending', 'under_review', 'verified', 'rejected') DEFAULT 'pending',
    verified_by BIGINT UNSIGNED NULL,
    verified_at TIMESTAMP NULL,
    rejection_reason TEXT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    activated_by BIGINT UNSIGNED NULL,
    activated_at TIMESTAMP NULL,
    bank_account_number_encrypted VARCHAR(500) NULL,
    bank_ifsc_code VARCHAR(11) NULL,
    bank_account_holder_name VARCHAR(100) NULL,
    upi_id VARCHAR(100) NULL,
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_surveyors_phone (phone),
    INDEX idx_surveyors_location (current_latitude, current_longitude)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS phone_otp_verifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(50) NOT NULL DEFAULT 'registration',
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    verified_at TIMESTAMP NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_otp_phone_purpose (phone, purpose)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_type ENUM('admin', 'assigner', 'surveyor') NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_reset_token (token)
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- SECTION 2: SURVEY CORE & APPLICATIONS
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS surveys (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    laid VARCHAR(16) NOT NULL UNIQUE,
    survey_type ENUM('motor_spot', 'motor_final', 'marine_final', 'marine_cargo_investigation', 'investigation') NOT NULL,
    is_emergency BOOLEAN DEFAULT FALSE,
    assigner_id BIGINT UNSIGNED NOT NULL,
    case_reference VARCHAR(100) NOT NULL,
    contact_person_name VARCHAR(100) NOT NULL,
    contact_person_mobile VARCHAR(10) NOT NULL,
    latitude DECIMAL(10, 8) NULL,
    longitude DECIMAL(11, 8) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(6) NULL,
    address TEXT NULL,
    surveyor_id BIGINT UNSIGNED NULL,
    surveyor_assigned_at TIMESTAMP NULL,
    broadcast_ends_at TIMESTAMP NULL,
    broadcast_attempt INT DEFAULT 1,
    surveyor_arrived_at TIMESTAMP NULL,
    status ENUM('pending', 'location_detected', 'assigned', 'in_transit', 'visit_completed', 'report_submitted', 'finished', 'disputed', 'not_resolved') DEFAULT 'pending',
    timeout_warning_sent_at DATETIME NULL,
    admin_resolved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    INDEX idx_surveys_status (status),
    CONSTRAINT fk_surveys_assigner FOREIGN KEY (assigner_id) REFERENCES assigners(id),
    CONSTRAINT fk_surveys_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS survey_applications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    time_to_start_minutes INT UNSIGNED NOT NULL,
    total_eta_minutes INT UNSIGNED NULL,
    status ENUM('applied', 'selected', 'rejected') DEFAULT 'applied',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_apps_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
    CONSTRAINT fk_apps_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE,
    UNIQUE KEY uk_apps_survey_surveyor (survey_id, surveyor_id)
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- SECTION 3: PAYMENTS, WALLETS & PAYOUTS
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS payments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL UNIQUE,
    assigner_id BIGINT UNSIGNED NOT NULL,
    final_amount DECIMAL(10, 2) NOT NULL,
    platform_commission_amount DECIMAL(10, 2) NOT NULL,
    surveyor_payout_amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'processing', 'completed', 'failed', 'refunded') DEFAULT 'pending',
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payments_survey FOREIGN KEY (survey_id) REFERENCES surveys(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS surveyor_wallets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    surveyor_id BIGINT UNSIGNED NOT NULL UNIQUE,
    balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    total_earned DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    total_withdrawn DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_wallet_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE
) ENGINE=InnoDB;

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
    CONSTRAINT fk_wallet_txn_surveyor FOREIGN KEY (surveyor_id) REFERENCES surveyors(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS surveyor_payouts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    payment_id BIGINT UNSIGNED NOT NULL,
    survey_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    payout_amount DECIMAL(10, 2) NOT NULL,
    payout_type ENUM('full', 'partial', 'balance') DEFAULT 'full',
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payouts_survey FOREIGN KEY (survey_id) REFERENCES surveys(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- SECTION 4: MEDIA & NOTIFICATIONS
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS survey_photos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    photo_type ENUM('selfie', 'live', 'sync_mode', 'gallery') NOT NULL,
    source_type ENUM('camera', 'gallery') DEFAULT 'camera',
    media_type ENUM('image', 'video') DEFAULT 'image',
    video_duration_seconds INT UNSIGNED NULL,
    video_thumbnail_url VARCHAR(500) NULL,
    file_url VARCHAR(500) NOT NULL,
    captured_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_survey_photos_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS device_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    fcm_token VARCHAR(500) NOT NULL,
    device_type ENUM('ios', 'android', 'web') DEFAULT 'android',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_device (user_type, user_id, fcm_token(255))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recipient_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    recipient_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    notification_type VARCHAR(50) NOT NULL DEFAULT 'other',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- SECTION 5: CONFIGURATION & LOGS
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS system_config (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    value_type ENUM('string', 'number', 'boolean', 'json', 'text') DEFAULT 'string',
    category VARCHAR(50) NULL,
    description VARCHAR(500) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS survey_status_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    new_status VARCHAR(50) NOT NULL,
    changed_by_type VARCHAR(20) NOT NULL,
    remarks TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_status_history_survey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- INITIAL CONFIGURATION DATA
-- -----------------------------------------------------

INSERT INTO system_config (config_key, config_value, value_type, description, category) VALUES
('platform_commission_percent', '25', 'number', 'Platform commission percentage', 'pricing'),
('surveyor_payout_percentage', '40', 'number', 'Surveyor payout percentage', 'pricing'),
('broadcast_stage_1_km', '15', 'Radius Stage 1 (km)', 'broadcast', 'number'),
('broadcast_stage_2_km', '30', 'Radius Stage 2 (km)', 'broadcast', 'number'),
('broadcast_stage_3_km', '45', 'Radius Stage 3 (km)', 'broadcast', 'number')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- (Audit log, view, and triggers from base schema can be added here as needed)
