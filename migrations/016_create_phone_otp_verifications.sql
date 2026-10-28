-- -----------------------------------------------------
-- Table: phone_otp_verifications
-- Description: Tracking phone number verifications via OTP
-- -----------------------------------------------------
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
