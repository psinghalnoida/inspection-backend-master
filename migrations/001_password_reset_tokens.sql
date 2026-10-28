-- Password Reset Tokens Table
-- Run this SQL in your MySQL database to create the required table

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
