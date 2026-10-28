-- Migration: Add device tokens and in-app notifications tables
-- Created: 2025-12-29

-- Table: device_tokens
-- Stores FCM tokens for push notifications
CREATE TABLE IF NOT EXISTS device_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    user_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    
    fcm_token VARCHAR(500) NOT NULL COMMENT 'Firebase Cloud Messaging token',
    device_type ENUM('ios', 'android', 'web') DEFAULT 'android',
    device_id VARCHAR(255) NULL COMMENT 'Unique device identifier',
    
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_device_tokens_user (user_type, user_id),
    INDEX idx_device_tokens_token (fcm_token(255)),
    INDEX idx_device_tokens_active (is_active),
    
    UNIQUE KEY uk_user_device (user_type, user_id, device_id)
) ENGINE=InnoDB COMMENT='FCM device tokens for push notifications';

-- Table: app_notifications
-- Stores in-app notifications that appear in the notification center
CREATE TABLE IF NOT EXISTS app_notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Recipient
    recipient_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    recipient_id BIGINT UNSIGNED NOT NULL,
    
    -- Notification content
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    icon VARCHAR(100) NULL COMMENT 'Material icon name for display',
    
    -- Type and categorization
    notification_type ENUM(
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
        'system',
        'other'
    ) NOT NULL DEFAULT 'other',
    
    -- Reference to related entity
    reference_type VARCHAR(50) NULL COMMENT 'e.g., survey, payment, chat',
    reference_id BIGINT UNSIGNED NULL,
    
    -- Additional data for navigation
    data JSON NULL COMMENT 'Additional data for deep linking',
    
    -- Status
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP NULL,
    
    -- Push notification status
    push_sent BOOLEAN DEFAULT FALSE,
    push_sent_at TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_app_notif_recipient (recipient_type, recipient_id),
    INDEX idx_app_notif_type (notification_type),
    INDEX idx_app_notif_read (is_read),
    INDEX idx_app_notif_created (created_at DESC),
    INDEX idx_app_notif_reference (reference_type, reference_id)
) ENGINE=InnoDB COMMENT='In-app notifications for notification center';
