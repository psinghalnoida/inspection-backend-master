-- Migration: Create survey_applications table
-- Date: 2025-12-26
-- Description: This table was missing from the initial database setup

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
    INDEX idx_apps_total_eta (total_eta_minutes),
    
    CONSTRAINT fk_apps_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_apps_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE,
        
    UNIQUE KEY uk_apps_survey_surveyor (survey_id, surveyor_id)
) ENGINE=InnoDB COMMENT='Surveyors applying for a broadcasted survey';
