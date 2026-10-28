-- =====================================================
-- ClaimsMitra Platform - Complete Database Schema
-- =====================================================
-- Description: Survey management platform connecting 
--              Assigners (insurance companies) with 
--              Surveyors (field inspectors)
-- Database: MySQL 8.0+
-- Character Set: utf8mb4
-- Collation: utf8mb4_unicode_ci
-- Created: 2025-12-05
-- =====================================================

-- Create database
DROP DATABASE IF EXISTS claimsmitra;
CREATE DATABASE claimsmitra
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE claimsmitra;

-- =====================================================
-- SECTION 1: USER MANAGEMENT TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: admins
-- Description: Platform administrators with super access
-- -----------------------------------------------------
CREATE TABLE admins (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL COMMENT 'Full name of admin',
    email VARCHAR(255) NOT NULL UNIQUE COMMENT 'Email address (unique)',
    phone VARCHAR(10) NOT NULL UNIQUE COMMENT '10-digit phone number',
    password_hash VARCHAR(255) NOT NULL COMMENT 'Bcrypt hashed password',
    profile_picture_url VARCHAR(500) NULL COMMENT 'URL to profile picture in cloud storage',
    is_super_admin BOOLEAN DEFAULT FALSE COMMENT 'Super admin has all privileges',
    is_active BOOLEAN DEFAULT TRUE COMMENT 'Account active status',
    last_login_at TIMESTAMP NULL COMMENT 'Last login timestamp',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_admins_email (email),
    INDEX idx_admins_phone (phone),
    INDEX idx_admins_active (is_active)
) ENGINE=InnoDB COMMENT='Platform administrators';

-- -----------------------------------------------------
-- Table: assigners
-- Description: Insurance companies/agencies who create surveys
-- Note: Only added by admin (no self-registration)
-- -----------------------------------------------------
CREATE TABLE assigners (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(10) NOT NULL UNIQUE COMMENT '10-digit phone number (unique)',
    email VARCHAR(255) NOT NULL UNIQUE COMMENT 'Email address (unique)',
    password_hash VARCHAR(255) NOT NULL COMMENT 'Bcrypt hashed password',
    company_name VARCHAR(200) NULL COMMENT 'Company/agency name',
    contact_person_name VARCHAR(100) NULL COMMENT 'Primary contact person',
    profile_picture_url VARCHAR(500) NULL COMMENT 'URL to profile picture',
    
    -- Location for distance calculations
    latitude DECIMAL(10, 8) NULL COMMENT 'Office latitude',
    longitude DECIMAL(11, 8) NULL COMMENT 'Office longitude',
    address TEXT NULL COMMENT 'Full address',
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(6) NULL COMMENT '6-digit pincode',
    
    -- Status
    is_active BOOLEAN DEFAULT FALSE COMMENT 'Inactive until admin activates',
    activated_by BIGINT UNSIGNED NULL COMMENT 'Admin who activated this account',
    activated_at TIMESTAMP NULL COMMENT 'When account was activated',
    
    -- Audit
    created_by BIGINT UNSIGNED NOT NULL COMMENT 'Admin who created this account',
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_assigners_phone (phone),
    INDEX idx_assigners_email (email),
    INDEX idx_assigners_active (is_active),
    INDEX idx_assigners_location (latitude, longitude),
    
    CONSTRAINT fk_assigners_created_by FOREIGN KEY (created_by) 
        REFERENCES admins(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_assigners_activated_by FOREIGN KEY (activated_by) 
        REFERENCES admins(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Insurance companies/agencies who create surveys';

-- -----------------------------------------------------
-- Table: surveyors
-- Description: Field inspectors who conduct surveys
-- Note: Self-registration, but admin must verify and activate
-- -----------------------------------------------------
CREATE TABLE surveyors (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Personal Details
    full_name VARCHAR(100) NOT NULL COMMENT 'Full name (alphabetic only)',
    email VARCHAR(255) NOT NULL UNIQUE COMMENT 'Email address (unique)',
    phone VARCHAR(10) NOT NULL UNIQUE COMMENT '10-digit phone number (unique)',
    profile_picture_url VARCHAR(500) NULL COMMENT 'Professional headshot URL',
    
    -- Authentication
    password_hash VARCHAR(255) NOT NULL COMMENT 'Bcrypt hashed password',
    pin_hash VARCHAR(255) NULL COMMENT 'Hashed 4-digit PIN for quick login (set after first login)',
    
    -- Professional Details
    surveyor_license_id VARCHAR(50) NULL COMMENT 'Optional license ID (alphanumeric)',
    business_address TEXT NULL COMMENT 'Business/operating address',
    
    -- Current Location (updated periodically for radius calculations)
    current_latitude DECIMAL(10, 8) NULL COMMENT 'Current GPS latitude',
    current_longitude DECIMAL(11, 8) NULL COMMENT 'Current GPS longitude',
    location_updated_at TIMESTAMP NULL COMMENT 'When location was last updated',
    
    -- Static Location
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(6) NULL,
    
    -- Availability Status
    is_available BOOLEAN DEFAULT FALSE COMMENT 'Online/offline toggle in app',
    
    -- Verification Status
    verification_status ENUM('pending', 'under_review', 'verified', 'rejected') 
        DEFAULT 'pending' COMMENT 'KYC verification status',
    verified_by BIGINT UNSIGNED NULL COMMENT 'Admin who verified',
    verified_at TIMESTAMP NULL COMMENT 'Verification timestamp',
    rejection_reason TEXT NULL COMMENT 'If rejected, reason why',
    
    -- Account Status
    is_active BOOLEAN DEFAULT FALSE COMMENT 'Inactive until admin activates',
    activated_by BIGINT UNSIGNED NULL,
    activated_at TIMESTAMP NULL,
    
    -- Bank Details for Payouts
    bank_account_number_encrypted VARCHAR(500) NULL COMMENT 'Encrypted bank account',
    bank_ifsc_code VARCHAR(11) NULL COMMENT 'IFSC code',
    bank_account_holder_name VARCHAR(100) NULL,
    upi_id VARCHAR(100) NULL COMMENT 'UPI ID for payouts',
    
    -- Audit
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_surveyors_phone (phone),
    INDEX idx_surveyors_email (email),
    INDEX idx_surveyors_active (is_active),
    INDEX idx_surveyors_available (is_available),
    INDEX idx_surveyors_verification (verification_status),
    INDEX idx_surveyors_location (current_latitude, current_longitude),
    
    CONSTRAINT fk_surveyors_verified_by FOREIGN KEY (verified_by) 
        REFERENCES admins(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_surveyors_activated_by FOREIGN KEY (activated_by) 
        REFERENCES admins(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Field inspectors who conduct surveys';

-- -----------------------------------------------------
-- Table: surveyor_documents
-- Description: KYC documents uploaded by surveyors
-- -----------------------------------------------------
CREATE TABLE surveyor_documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    
    document_type ENUM(
        'government_id',      -- Aadhar, Driver's License, etc.
        'proof_of_address',   -- Utility Bill, etc.
        'surveyor_license'    -- Optional license document
    ) NOT NULL,
    document_name VARCHAR(255) NULL COMMENT 'Original filename',
    file_url VARCHAR(500) NOT NULL COMMENT 'URL to document in cloud storage',
    file_type ENUM('jpg', 'png', 'pdf') NOT NULL,
    file_size_bytes INT UNSIGNED NULL COMMENT 'File size in bytes',
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by BIGINT UNSIGNED NULL,
    verified_at TIMESTAMP NULL,
    rejection_reason TEXT NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_surveyor_docs_surveyor (surveyor_id),
    INDEX idx_surveyor_docs_type (document_type),
    INDEX idx_surveyor_docs_verified (is_verified),
    
    CONSTRAINT fk_surveyor_docs_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_surveyor_docs_verified_by FOREIGN KEY (verified_by) 
        REFERENCES admins(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='KYC documents uploaded by surveyors';

-- =====================================================
-- SECTION 2: SURVEY CORE TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: surveys
-- Description: Main survey table with common fields
-- Supports: Motor Spot, Motor Final, Marine Final, 
--           Marine Cargo Investigation, Investigation
-- -----------------------------------------------------
CREATE TABLE surveys (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- LAID (Live Assignment ID) - Auto-generated
    -- Format: LYY-MM-DD HH:MM (e.g., L25-12-05 19:32)
    laid VARCHAR(16) NOT NULL UNIQUE COMMENT 'Live Assignment ID',
    
    -- Survey Type
    survey_type ENUM(
        'motor_spot',
        'motor_final',
        'marine_final',
        'marine_cargo_investigation',
        'investigation'
    ) NOT NULL,
    
    -- Timing
    is_emergency BOOLEAN DEFAULT FALSE COMMENT 'Emergency survey (after 5 PM)',
    
    -- Assigner Info
    assigner_id BIGINT UNSIGNED NOT NULL,
    case_reference VARCHAR(100) NOT NULL COMMENT 'Unique case reference number',
    
    -- Contact Person at Incident Location
    contact_person_name VARCHAR(100) NOT NULL COMMENT 'Alphabetic only',
    contact_person_mobile VARCHAR(10) NOT NULL COMMENT '10-digit WhatsApp number',
    contact_person_available BOOLEAN DEFAULT TRUE,
    alternate_whatsapp_number VARCHAR(10) NULL COMMENT 'If contact not available',
    
    -- Location Detection Method
    location_method ENUM(
        'gps_auto',         -- Auto-detect GPS
        'manual_coordinates', -- User entered lat/long
        'sms_link',         -- SMS link clicked by person at location
        'pincode_entry'     -- User entered pincode
    ) NOT NULL,
    
    -- Location Details
    latitude DECIMAL(10, 8) NULL COMMENT 'Incident latitude',
    longitude DECIMAL(11, 8) NULL COMMENT 'Incident longitude',
    pincode VARCHAR(6) NULL COMMENT '6-digit pincode',
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    address TEXT NULL COMMENT 'Full address',
    
    -- SMS Link for Location (if method = sms_link)
    sms_link_token VARCHAR(64) NULL UNIQUE COMMENT 'Unique token for SMS link',
    sms_link_sent_at TIMESTAMP NULL,
    sms_link_clicked_at TIMESTAMP NULL,
    
    -- Assigned Surveyor
    surveyor_id BIGINT UNSIGNED NULL COMMENT 'Assigned surveyor',
    surveyor_eta_minutes INT UNSIGNED NULL COMMENT 'ETA provided by surveyor',
    surveyor_assigned_at TIMESTAMP NULL,
    broadcast_ends_at TIMESTAMP NULL COMMENT 'When broadcast window ends',
    surveyor_arrived_at TIMESTAMP NULL COMMENT 'When surveyor reached spot',
    
    -- Distance Calculation
    distance_from_assigner_km DECIMAL(10, 2) NULL COMMENT 'Distance from assigner to incident',
    
    -- Common Survey Fields
    name_of_insured VARCHAR(100) NULL COMMENT 'Alphabetic only',
    policy_number VARCHAR(50) NULL COMMENT 'Alphanumeric',
    cause_of_loss TEXT NULL COMMENT 'Free text description',
    instructions TEXT NULL COMMENT 'Instructions for surveyor',
    
    -- Status
    status ENUM(
        'pending',           -- 1. Survey created, awaiting location
        'location_detected', -- 2. Location confirmed, broadcasting
        'assigned',          -- 3. Surveyor accepted with ETA
        'in_transit',        -- 4. Payment done, surveyor traveling
        'visit_completed',   -- 5. On-site inspection done (Arrived)
        'report_submitted',  -- 6. Report awaiting review
        'finished',          -- 7. Report accepted, payment released
        'disputed',          -- 8. Dispute raised
        'not_resolved'       -- 9. Legacy/Other dispute
    ) DEFAULT 'pending',
    
    -- QR Code (generated after payment)
    qr_code_url VARCHAR(500) NULL COMMENT 'URL to QR code for tracking',
    qr_code_generated_at TIMESTAMP NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL COMMENT 'When survey finished',
    
    INDEX idx_surveys_laid (laid),
    INDEX idx_surveys_type (survey_type),
    INDEX idx_surveys_assigner (assigner_id),
    INDEX idx_surveys_surveyor (surveyor_id),
    INDEX idx_surveys_status (status),
    INDEX idx_surveys_location (latitude, longitude),
    INDEX idx_surveys_created (created_at),
    INDEX idx_surveys_case_ref (case_reference),
    INDEX idx_surveys_sms_token (sms_link_token),
    
    CONSTRAINT fk_surveys_assigner FOREIGN KEY (assigner_id) 
        REFERENCES assigners(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_surveys_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Main survey table with common fields across all types';

-- -----------------------------------------------------
-- Table: survey_status_history
-- Description: Complete audit trail of status changes
-- -----------------------------------------------------
CREATE TABLE survey_status_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    
    previous_status ENUM(
        'pending', 'location_detected', 'assigned', 'in_transit',
        'visit_completed', 'report_submitted', 'finished', 'not_resolved'
    ) NULL COMMENT 'NULL for initial creation',
    new_status ENUM(
        'pending', 'location_detected', 'assigned', 'in_transit',
        'visit_completed', 'report_submitted', 'finished', 'not_resolved'
    ) NOT NULL,
    
    -- Who made the change
    changed_by_type ENUM('system', 'admin', 'assigner', 'surveyor') NOT NULL,
    changed_by_id BIGINT UNSIGNED NULL COMMENT 'ID of user who changed (NULL if system)',
    
    remarks TEXT NULL COMMENT 'Optional notes about the change',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_status_history_survey (survey_id),
    INDEX idx_status_history_status (new_status),
    INDEX idx_status_history_created (created_at),
    
    CONSTRAINT fk_status_history_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Audit trail for all survey status changes';

-- -----------------------------------------------------
-- Table: survey_applications
-- Description: Surveyors applying for a broadcasted survey
-- -----------------------------------------------------
CREATE TABLE survey_applications (
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

-- =====================================================
-- SECTION 3: SURVEY TYPE-SPECIFIC TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: motor_survey_details
-- Description: Motor Spot & Motor Final survey specific fields
-- -----------------------------------------------------
CREATE TABLE motor_survey_details (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL UNIQUE,
    
    -- Vehicle Category
    vehicle_category ENUM('private', 'commercial') NOT NULL,
    
    -- Vehicle Type
    vehicle_type ENUM(
        'motor_car',
        'tractor',
        'motorcycle',
        'construction_equipment', -- Commercial only
        'bus',                    -- Commercial only
        'goods_carrier',          -- Commercial only
        'others'
    ) NOT NULL,
    vehicle_type_other VARCHAR(100) NULL COMMENT 'If type is others',
    
    -- Vehicle Number (stored in ALL CAPS)
    vehicle_number VARCHAR(20) NOT NULL COMMENT 'Format: UP32 AB 1234',
    
    -- Motor Final Survey Only
    workshop_name VARCHAR(200) NULL,
    workshop_advisor_name VARCHAR(100) NULL,
    workshop_advisor_contact VARCHAR(10) NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_motor_vehicle_number (vehicle_number),
    
    CONSTRAINT fk_motor_details_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Motor survey specific fields';

-- -----------------------------------------------------
-- Table: marine_survey_details
-- Description: Marine Final & Marine Cargo Investigation fields
-- -----------------------------------------------------
CREATE TABLE marine_survey_details (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL UNIQUE,
    
    name_of_consignee VARCHAR(100) NOT NULL COMMENT 'Alphabetic only',
    name_of_consignor VARCHAR(100) NOT NULL COMMENT 'Alphabetic only',
    commodity TEXT NOT NULL COMMENT 'Free text - Electronics, Auto Parts, etc.',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_marine_details_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Marine survey specific fields';

-- -----------------------------------------------------
-- Table: marine_invoices
-- Description: Multiple invoices per marine survey
-- -----------------------------------------------------
CREATE TABLE marine_invoices (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    marine_survey_id BIGINT UNSIGNED NOT NULL,
    
    invoice_number VARCHAR(50) NOT NULL COMMENT 'Alphanumeric, hyphens/slashes allowed',
    invoice_date DATE NOT NULL COMMENT 'Format: YYYY-MM-DD (displayed as DD-MM-YYYY)',
    invoice_amount DECIMAL(15, 2) NULL COMMENT 'Must be > 0 if provided',
    
    -- Invoice Document
    invoice_file_url VARCHAR(500) NULL COMMENT 'Optional invoice image/PDF',
    invoice_file_type ENUM('jpg', 'png', 'pdf') NULL,
    invoice_file_size_bytes INT UNSIGNED NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_marine_invoices_survey (marine_survey_id),
    
    CONSTRAINT fk_marine_invoices_survey FOREIGN KEY (marine_survey_id) 
        REFERENCES marine_survey_details(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Multiple invoice entries per marine survey';

-- -----------------------------------------------------
-- Table: marine_gr_entries
-- Description: Multiple GR (Goods Receipt) entries per marine survey
-- -----------------------------------------------------
CREATE TABLE marine_gr_entries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    marine_survey_id BIGINT UNSIGNED NOT NULL,
    
    gr_number VARCHAR(50) NOT NULL COMMENT 'Alphanumeric, hyphens/slashes allowed',
    gr_date DATE NOT NULL COMMENT 'Format: YYYY-MM-DD',
    
    -- GR Document
    gr_file_url VARCHAR(500) NULL COMMENT 'Optional GR copy',
    gr_file_type ENUM('jpg', 'png', 'pdf') NULL,
    gr_file_size_bytes INT UNSIGNED NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_marine_gr_survey (marine_survey_id),
    
    CONSTRAINT fk_marine_gr_survey FOREIGN KEY (marine_survey_id) 
        REFERENCES marine_survey_details(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Multiple GR entries per marine survey';

-- -----------------------------------------------------
-- Table: investigation_survey_details
-- Description: Investigation survey specific fields
-- -----------------------------------------------------
CREATE TABLE investigation_survey_details (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL UNIQUE,
    
    -- Loss Item Type with Dynamic Fields
    loss_item_type ENUM('vehicle', 'cattle', 'human', 'others') NOT NULL,
    
    -- If Vehicle
    vehicle_number VARCHAR(20) NULL COMMENT 'Standard format e.g., UP32 AB 1234',
    
    -- If Cattle
    cattle_tag_number VARCHAR(50) NULL COMMENT 'Alphanumeric, hyphens/slashes',
    cattle_name VARCHAR(100) NULL COMMENT 'Alphabetic only',
    
    -- If Human
    human_name VARCHAR(100) NULL COMMENT 'Alphabetic only',
    human_contact_number VARCHAR(10) NULL COMMENT '10 digits',
    human_relation VARCHAR(100) NULL COMMENT 'Relation with insured',
    
    -- If Others
    other_loss_item_name VARCHAR(200) NULL COMMENT 'Free text',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_investigation_vehicle (vehicle_number),
    INDEX idx_investigation_loss_type (loss_item_type),
    
    CONSTRAINT fk_investigation_details_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Investigation survey specific fields';

-- =====================================================
-- SECTION 4: DOCUMENT & PHOTO MANAGEMENT
-- =====================================================

-- -----------------------------------------------------
-- Table: survey_documents
-- Description: Documents uploaded for surveys (RC, DL, Policy, etc.)
-- -----------------------------------------------------
CREATE TABLE survey_documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    
    -- Uploader
    uploaded_by_type ENUM('assigner', 'surveyor') NOT NULL,
    uploaded_by_id BIGINT UNSIGNED NOT NULL,
    
    -- Document Type
    document_type ENUM('rc', 'dl', 'policy', 'fir', 'gr', 'invoice', 'others') NOT NULL,
    document_type_other VARCHAR(100) NULL COMMENT 'If type is others',
    
    -- File Details
    original_file_name VARCHAR(255) NULL,
    file_url VARCHAR(500) NOT NULL COMMENT 'URL to file in cloud storage',
    file_type ENUM('jpg', 'png', 'pdf', 'video') NOT NULL,
    
    -- Size tracking
    original_size_bytes INT UNSIGNED NULL,
    compressed_size_bytes INT UNSIGNED NULL COMMENT 'After compression (max 300KB)',
    is_compressed BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_survey_docs_survey (survey_id),
    INDEX idx_survey_docs_type (document_type),
    INDEX idx_survey_docs_uploader (uploaded_by_type, uploaded_by_id),
    
    CONSTRAINT fk_survey_docs_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Documents uploaded for surveys';

-- -----------------------------------------------------
-- Table: survey_photos
-- Description: Photos uploaded by surveyors with location metadata
-- -----------------------------------------------------
CREATE TABLE survey_photos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    
    -- Photo Type
    photo_type ENUM(
        'selfie',        -- Presence verification selfie
        'live',          -- Live photos from camera
        'sync_mode',     -- Sync mode photos
        'gallery'        -- From phone gallery (with watermark)
    ) NOT NULL,
    
    -- File Details
    file_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500) NULL COMMENT 'Smaller version for preview',
    original_size_bytes INT UNSIGNED NULL,
    compressed_size_bytes INT UNSIGNED NULL COMMENT 'Max 500KB',
    
    -- Location Badge Data
    photo_latitude DECIMAL(10, 8) NULL,
    photo_longitude DECIMAL(11, 8) NULL,
    photo_taken_at TIMESTAMP NULL COMMENT 'When photo was actually taken',
    
    -- Watermark Status
    has_location_badge BOOLEAN DEFAULT TRUE COMMENT 'Date-time-location badge',
    has_gallery_watermark BOOLEAN DEFAULT FALSE COMMENT 'Gallery Attached watermark',
    
    -- Notes
    caption TEXT NULL COMMENT 'Optional photo description',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_survey_photos_survey (survey_id),
    INDEX idx_survey_photos_surveyor (surveyor_id),
    INDEX idx_survey_photos_type (photo_type),
    
    CONSTRAINT fk_survey_photos_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_survey_photos_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Photos uploaded by surveyors with location metadata';

-- -----------------------------------------------------
-- Table: survey_reports
-- Description: Final survey reports with version tracking
-- -----------------------------------------------------
CREATE TABLE survey_reports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    
    -- Version tracking for resubmissions
    version INT UNSIGNED DEFAULT 1 COMMENT 'Incremented on resubmission',
    
    -- Report File
    report_file_url VARCHAR(500) NOT NULL COMMENT 'PDF report URL',
    file_size_bytes INT UNSIGNED NULL,
    
    -- Report Status
    status ENUM(
        'submitted',
        'accepted',
        'rejected',
        'resubmit_required'
    ) DEFAULT 'submitted',
    
    -- For rejections
    rejection_reason TEXT NULL,
    rejected_by BIGINT UNSIGNED NULL COMMENT 'Assigner who rejected',
    rejected_at TIMESTAMP NULL,
    
    -- For acceptance
    accepted_by BIGINT UNSIGNED NULL,
    accepted_at TIMESTAMP NULL,
    
    -- Surveyor notes
    surveyor_notes TEXT NULL COMMENT 'Observations and remarks',
    
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_survey_reports_survey (survey_id),
    INDEX idx_survey_reports_surveyor (surveyor_id),
    INDEX idx_survey_reports_status (status),
    INDEX idx_survey_reports_version (survey_id, version),
    
    CONSTRAINT fk_survey_reports_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_survey_reports_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Final survey reports with version tracking';

-- =====================================================
-- SECTION 5: PAYMENT & TRANSACTION TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: coupons
-- Description: Discount coupon codes
-- -----------------------------------------------------
CREATE TABLE coupons (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Coupon code (case insensitive)',
    description VARCHAR(255) NULL,
    
    -- Discount Type
    discount_type ENUM('percentage', 'fixed') NOT NULL,
    discount_value DECIMAL(10, 2) NOT NULL COMMENT 'Percentage (0-100) or fixed amount',
    
    -- Limits
    min_order_amount DECIMAL(10, 2) DEFAULT 0 COMMENT 'Minimum order to apply',
    max_discount_amount DECIMAL(10, 2) NULL COMMENT 'Cap on discount (for percentage)',
    
    -- Usage Limits
    usage_limit INT UNSIGNED NULL COMMENT 'NULL = unlimited',
    usage_count INT UNSIGNED DEFAULT 0 COMMENT 'How many times used',
    
    -- Validity
    valid_from TIMESTAMP NOT NULL,
    valid_until TIMESTAMP NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    created_by BIGINT UNSIGNED NOT NULL COMMENT 'Admin who created',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_coupons_code (code),
    INDEX idx_coupons_active (is_active),
    INDEX idx_coupons_validity (valid_from, valid_until),
    
    CONSTRAINT fk_coupons_created_by FOREIGN KEY (created_by) 
        REFERENCES admins(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Discount coupon codes';

-- -----------------------------------------------------
-- Table: payments
-- Description: Payments from assigners for surveys
-- -----------------------------------------------------
CREATE TABLE payments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL UNIQUE,
    assigner_id BIGINT UNSIGNED NOT NULL,
    
    -- Amount Calculation
    distance_km DECIMAL(10, 2) NOT NULL COMMENT 'Distance used for pricing',
    base_amount DECIMAL(10, 2) NOT NULL COMMENT 'Based on distance tier',
    
    -- Coupon Applied
    coupon_id BIGINT UNSIGNED NULL,
    coupon_code VARCHAR(50) NULL COMMENT 'Stored for reference',
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    
    -- Final Amount
    final_amount DECIMAL(10, 2) NOT NULL COMMENT 'base_amount - discount',
    
    -- Commission & Payout
    platform_commission_percent DECIMAL(5, 2) NOT NULL DEFAULT 25.00,
    platform_commission_amount DECIMAL(10, 2) NOT NULL,
    surveyor_payout_amount DECIMAL(10, 2) NOT NULL COMMENT '75% of final_amount',
    
    -- Payment Details
    payment_method ENUM('card', 'upi', 'net_banking', 'wallet') NULL,
    payment_gateway VARCHAR(50) NULL COMMENT 'Razorpay, Paytm, etc.',
    gateway_transaction_id VARCHAR(100) NULL COMMENT 'Transaction ID from gateway',
    gateway_order_id VARCHAR(100) NULL COMMENT 'Order ID from gateway',
    gateway_response JSON NULL COMMENT 'Full response from gateway',
    
    -- Status
    status ENUM(
        'pending',      -- Awaiting payment
        'processing',   -- Payment in progress
        'completed',    -- Payment successful
        'failed',       -- Payment failed
        'refunded',     -- Fully refunded
        'partially_refunded'
    ) DEFAULT 'pending',
    
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_payments_survey (survey_id),
    INDEX idx_payments_assigner (assigner_id),
    INDEX idx_payments_status (status),
    INDEX idx_payments_gateway_txn (gateway_transaction_id),
    
    CONSTRAINT fk_payments_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_assigner FOREIGN KEY (assigner_id) 
        REFERENCES assigners(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_coupon FOREIGN KEY (coupon_id) 
        REFERENCES coupons(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Payments from assigners for surveys';

-- -----------------------------------------------------
-- Table: surveyor_payouts
-- Description: Payouts from platform to surveyors
-- -----------------------------------------------------
CREATE TABLE surveyor_payouts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    payment_id BIGINT UNSIGNED NOT NULL,
    survey_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    
    payout_amount DECIMAL(10, 2) NOT NULL,
    
    -- Bank/UPI Details (snapshot at time of payout)
    payout_method ENUM('bank_transfer', 'upi', 'wallet') NOT NULL,
    bank_account_last4 VARCHAR(4) NULL COMMENT 'Last 4 digits for reference',
    bank_ifsc_code VARCHAR(11) NULL,
    upi_id VARCHAR(100) NULL,
    
    -- Transfer Details
    utr_number VARCHAR(50) NULL COMMENT 'UTR for bank transfer',
    transfer_reference VARCHAR(100) NULL,
    
    -- Status
    status ENUM(
        'pending',      -- Awaiting initiation
        'processing',   -- Transfer initiated
        'completed',    -- Transfer successful
        'failed'        -- Transfer failed
    ) DEFAULT 'pending',
    
    failure_reason TEXT NULL,
    
    initiated_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_payouts_payment (payment_id),
    INDEX idx_payouts_survey (survey_id),
    INDEX idx_payouts_surveyor (surveyor_id),
    INDEX idx_payouts_status (status),
    INDEX idx_payouts_utr (utr_number),
    
    CONSTRAINT fk_payouts_payment FOREIGN KEY (payment_id) 
        REFERENCES payments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payouts_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payouts_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Payouts from platform to surveyors';

-- -----------------------------------------------------
-- Table: transaction_logs
-- Description: Complete audit trail for all financial transactions
-- -----------------------------------------------------
CREATE TABLE transaction_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Reference to payment or payout
    reference_type ENUM('payment', 'payout', 'refund') NOT NULL,
    reference_id BIGINT UNSIGNED NOT NULL COMMENT 'ID from payments or surveyor_payouts',
    
    -- Event Details
    event_type VARCHAR(50) NOT NULL COMMENT 'e.g., initiated, completed, failed',
    event_description TEXT NULL,
    
    -- Amount involved
    amount DECIMAL(10, 2) NULL,
    
    -- Actor
    actor_type ENUM('system', 'admin', 'assigner', 'surveyor', 'gateway') NOT NULL,
    actor_id BIGINT UNSIGNED NULL,
    
    -- Additional Data
    metadata JSON NULL COMMENT 'Any additional data as JSON',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_txn_logs_reference (reference_type, reference_id),
    INDEX idx_txn_logs_event (event_type),
    INDEX idx_txn_logs_created (created_at)
) ENGINE=InnoDB COMMENT='Complete audit trail for all financial transactions';

-- =====================================================
-- SECTION 6: COMMUNICATION TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: surveyor_notifications
-- Description: Notifications sent to surveyors for survey requests
-- -----------------------------------------------------
CREATE TABLE surveyor_notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    
    -- Distance from surveyor to incident
    distance_from_incident_km DECIMAL(10, 2) NOT NULL,
    
    -- Surveyor Response
    response_status ENUM(
        'pending',      -- Awaiting response
        'accepted',     -- Surveyor accepted with ETA
        'declined',     -- Surveyor declined
        'expired',      -- No response in time
        'selected'      -- This surveyor was assigned
    ) DEFAULT 'pending',
    
    eta_minutes INT UNSIGNED NULL COMMENT 'ETA provided if accepted',
    decline_reason TEXT NULL,
    
    responded_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL COMMENT 'When notification expires',
    
    -- Delivery Status
    is_delivered BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_surveyor_notif_survey (survey_id),
    INDEX idx_surveyor_notif_surveyor (surveyor_id),
    INDEX idx_surveyor_notif_status (response_status),
    
    CONSTRAINT fk_surveyor_notif_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_surveyor_notif_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE,
        
    UNIQUE KEY uk_survey_surveyor (survey_id, surveyor_id)
) ENGINE=InnoDB COMMENT='Survey request notifications to surveyors';

-- -----------------------------------------------------
-- Table: chat_messages
-- Description: In-app chat between assigner and surveyor
-- -----------------------------------------------------
CREATE TABLE chat_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL COMMENT 'Chat is per survey',
    
    -- Sender
    sender_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    
    -- Message Content
    message_type ENUM('text', 'file', 'image') DEFAULT 'text',
    message_text TEXT NULL,
    
    -- File Attachment (if any)
    attachment_url VARCHAR(500) NULL,
    attachment_name VARCHAR(255) NULL,
    attachment_type VARCHAR(50) NULL COMMENT 'MIME type',
    attachment_size_bytes INT UNSIGNED NULL,
    
    -- Read Status
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP NULL,
    
    -- Chat Status
    is_deleted BOOLEAN DEFAULT FALSE,
    
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_chat_survey (survey_id),
    INDEX idx_chat_sender (sender_type, sender_id),
    INDEX idx_chat_sent (sent_at),
    INDEX idx_chat_read (is_read),
    
    CONSTRAINT fk_chat_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='In-app chat messages between assigner and surveyor';

-- -----------------------------------------------------
-- Table: sms_logs
-- Description: Track all SMS sent
-- -----------------------------------------------------
CREATE TABLE sms_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    phone_number VARCHAR(15) NOT NULL,
    message_content TEXT NOT NULL,
    
    sms_type ENUM(
        'location_link',
        'survey_assignment',
        'payment_confirmation',
        'report_submission',
        'payout_confirmation',
        'dispute_escalation',
        'otp',
        'other'
    ) NOT NULL,
    
    -- Reference
    reference_type VARCHAR(50) NULL COMMENT 'e.g., survey, payment',
    reference_id BIGINT UNSIGNED NULL,
    
    -- Delivery Status
    status ENUM('pending', 'sent', 'delivered', 'failed') DEFAULT 'pending',
    gateway_response JSON NULL,
    gateway_message_id VARCHAR(100) NULL,
    
    sent_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_sms_phone (phone_number),
    INDEX idx_sms_type (sms_type),
    INDEX idx_sms_reference (reference_type, reference_id),
    INDEX idx_sms_status (status)
) ENGINE=InnoDB COMMENT='Track all SMS sent from platform';

-- -----------------------------------------------------
-- Table: email_logs
-- Description: Track all emails sent
-- -----------------------------------------------------
CREATE TABLE email_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    to_email VARCHAR(255) NOT NULL,
    cc_emails JSON NULL COMMENT 'Array of CC emails',
    subject VARCHAR(500) NOT NULL,
    body_html TEXT NULL,
    body_text TEXT NULL,
    
    email_type ENUM(
        'registration_confirmation',
        'account_verification',
        'account_activation',
        'survey_status_update',
        'payment_receipt',
        'report_submission',
        'dispute_resolution',
        'other'
    ) NOT NULL,
    
    -- Reference
    reference_type VARCHAR(50) NULL,
    reference_id BIGINT UNSIGNED NULL,
    
    -- Delivery Status
    status ENUM('pending', 'sent', 'delivered', 'bounced', 'failed') DEFAULT 'pending',
    provider_response JSON NULL,
    provider_message_id VARCHAR(100) NULL,
    
    sent_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    opened_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_email_to (to_email),
    INDEX idx_email_type (email_type),
    INDEX idx_email_reference (reference_type, reference_id),
    INDEX idx_email_status (status)
) ENGINE=InnoDB COMMENT='Track all emails sent from platform';

-- -----------------------------------------------------
-- Table: push_notification_logs
-- Description: Track app push notifications
-- -----------------------------------------------------
CREATE TABLE push_notification_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Recipient
    recipient_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    recipient_id BIGINT UNSIGNED NOT NULL,
    device_token VARCHAR(500) NULL COMMENT 'FCM/APNs device token',
    
    -- Content
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    data JSON NULL COMMENT 'Additional data payload',
    
    notification_type ENUM(
        'survey_assignment',
        'payment_confirmation',
        'status_change',
        'chat_message',
        'report_accepted',
        'report_rejected',
        'dispute_escalation',
        'other'
    ) NOT NULL,
    
    -- Reference
    reference_type VARCHAR(50) NULL,
    reference_id BIGINT UNSIGNED NULL,
    
    -- Delivery Status
    status ENUM('pending', 'sent', 'delivered', 'failed') DEFAULT 'pending',
    provider_response JSON NULL,
    provider_message_id VARCHAR(100) NULL,
    
    sent_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    clicked_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_push_recipient (recipient_type, recipient_id),
    INDEX idx_push_type (notification_type),
    INDEX idx_push_reference (reference_type, reference_id),
    INDEX idx_push_status (status)
) ENGINE=InnoDB COMMENT='Track app push notifications';

-- =====================================================
-- SECTION 7: DISPUTE & ESCALATION TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: disputes
-- Description: Disputes when assigner rejects report
-- -----------------------------------------------------
CREATE TABLE disputes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    survey_id BIGINT UNSIGNED NOT NULL,
    
    -- Parties
    assigner_id BIGINT UNSIGNED NOT NULL,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    
    -- Initial Rejection
    rejection_reason TEXT NOT NULL,
    report_version_rejected INT UNSIGNED NOT NULL COMMENT 'Which report version was rejected',
    
    -- Status
    status ENUM(
        'open',             -- Dispute raised
        'in_discussion',    -- Parties are communicating
        'resubmitted',      -- Surveyor resubmitted report
        'escalated',        -- Escalated to admin
        'resolved',         -- Dispute resolved
        'closed'            -- Admin closed dispute
    ) DEFAULT 'open',
    
    -- Escalation
    is_escalated BOOLEAN DEFAULT FALSE,
    escalated_at TIMESTAMP NULL,
    escalation_reason VARCHAR(255) NULL COMMENT 'e.g., 7 days without resolution',
    
    -- Resolution
    resolved_by_type ENUM('assigner', 'admin') NULL,
    resolved_by_id BIGINT UNSIGNED NULL,
    resolution_notes TEXT NULL,
    
    -- Admin Decision (if escalated)
    admin_decision ENUM(
        'full_payment',
        'partial_payment',
        'no_payment',
        'pending'
    ) DEFAULT 'pending',
    admin_partial_amount DECIMAL(10, 2) NULL COMMENT 'If partial payment decided',
    admin_decision_notes TEXT NULL,
    admin_decided_by BIGINT UNSIGNED NULL,
    admin_decided_at TIMESTAMP NULL,
    
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_disputes_survey (survey_id),
    INDEX idx_disputes_assigner (assigner_id),
    INDEX idx_disputes_surveyor (surveyor_id),
    INDEX idx_disputes_status (status),
    INDEX idx_disputes_escalated (is_escalated),
    
    CONSTRAINT fk_disputes_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_disputes_assigner FOREIGN KEY (assigner_id) 
        REFERENCES assigners(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_disputes_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_disputes_admin_decided FOREIGN KEY (admin_decided_by) 
        REFERENCES admins(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Disputes when assigner rejects report';

-- -----------------------------------------------------
-- Table: dispute_messages
-- Description: Conversation thread for dispute resolution
-- -----------------------------------------------------
CREATE TABLE dispute_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    dispute_id BIGINT UNSIGNED NOT NULL,
    
    -- Sender
    sender_type ENUM('assigner', 'surveyor', 'admin') NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    
    message_text TEXT NOT NULL,
    
    -- Attachment
    attachment_url VARCHAR(500) NULL,
    attachment_name VARCHAR(255) NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_dispute_msg_dispute (dispute_id),
    INDEX idx_dispute_msg_sender (sender_type, sender_id),
    
    CONSTRAINT fk_dispute_msg_dispute FOREIGN KEY (dispute_id) 
        REFERENCES disputes(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Conversation thread for dispute resolution';

-- =====================================================
-- SECTION 8: SYSTEM CONFIGURATION TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: system_config
-- Description: Key-value configuration settings
-- -----------------------------------------------------
CREATE TABLE system_config (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    config_key VARCHAR(100) NOT NULL UNIQUE COMMENT 'Configuration key',
    config_value TEXT NOT NULL COMMENT 'Configuration value',
    value_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    
    description VARCHAR(500) NULL COMMENT 'What this config does',
    category VARCHAR(50) NULL COMMENT 'Grouping: pricing, limits, timing, etc.',
    
    is_editable BOOLEAN DEFAULT TRUE COMMENT 'Can be edited by admin',
    
    updated_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_config_key (config_key),
    INDEX idx_config_category (category),
    
    CONSTRAINT fk_config_updated_by FOREIGN KEY (updated_by) 
        REFERENCES admins(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Key-value configuration settings';

-- -----------------------------------------------------
-- Table: pricing_tiers
-- Description: Distance-based pricing configuration
-- -----------------------------------------------------
CREATE TABLE pricing_tiers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    tier_name VARCHAR(50) NOT NULL COMMENT 'e.g., Tier 1, Tier 2, Tier 3',
    min_distance_km DECIMAL(10, 2) NOT NULL COMMENT 'Minimum distance (inclusive)',
    max_distance_km DECIMAL(10, 2) NULL COMMENT 'Maximum distance (exclusive), NULL = unlimited',
    price_amount DECIMAL(10, 2) NOT NULL COMMENT 'Price in INR',
    
    is_active BOOLEAN DEFAULT TRUE,
    
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_pricing_distance (min_distance_km, max_distance_km),
    INDEX idx_pricing_active (is_active),
    
    CONSTRAINT fk_pricing_created_by FOREIGN KEY (created_by) 
        REFERENCES admins(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Distance-based pricing configuration';

-- =====================================================
-- SECTION 9: INITIAL DATA INSERTS
-- =====================================================

-- Insert default system configuration
INSERT INTO system_config (config_key, config_value, value_type, description, category) VALUES
-- Pricing
('platform_commission_percent', '25', 'number', 'Platform commission percentage (surveyor gets 100 - this)', 'pricing'),

-- Notification
('surveyor_notification_radius_km', '15', 'number', 'Radius in km to notify surveyors', 'notification'),
('max_surveyors_to_notify', '5', 'number', 'Maximum surveyors to notify per survey', 'notification'),
('broadcast_duration_minutes', '5', 'number', 'Duration in minutes to broadcast survey to surveyors', 'notification'),

-- File Limits
('max_image_size_kb', '500', 'number', 'Maximum image size in KB after compression', 'limits'),
('max_document_size_kb', '300', 'number', 'Maximum document size in KB after compression', 'limits'),
('max_video_duration_seconds', '120', 'number', 'Maximum video duration in seconds (2 minutes)', 'limits'),
('video_warning_at_seconds', '60', 'number', 'Show warning after this many seconds of video', 'limits'),

-- Timing
('regular_survey_start_hour', '7', 'number', 'Regular surveys allowed from this hour (24h format)', 'timing'),
('emergency_survey_start_hour', '17', 'number', 'Emergency surveys allowed from this hour (24h format)', 'timing'),

-- Escalation
('dispute_escalation_days', '7', 'number', 'Days for dispute auto-escalation and unresolved survey follow-up', 'escalation'),

-- QR Code
('qr_code_base_url', 'https://claimsmitra.com/track/', 'string', 'Base URL for QR code tracking', 'system');

-- Insert default pricing tiers
INSERT INTO pricing_tiers (tier_name, min_distance_km, max_distance_km, price_amount) VALUES
('Short range: Within 25 km', 0, 25, 2500.00),
('Mid range: 25-50 km', 25, 50, 3500.00),
('Long range: Beyond 50 km', 50, NULL, 5000.00);

-- =====================================================
-- SECTION 10: VIEWS FOR COMMON QUERIES
-- =====================================================

-- View: Active surveys with details
CREATE OR REPLACE VIEW vw_active_surveys AS
SELECT 
    s.id,
    s.laid,
    s.survey_type,
    s.status,
    s.case_reference,
    s.contact_person_name,
    s.contact_person_mobile,
    s.latitude,
    s.longitude,
    s.city,
    s.state,
    s.created_at,
    a.company_name AS assigner_company,
    a.email AS assigner_email,
    sv.full_name AS surveyor_name,
    sv.phone AS surveyor_phone,
    p.status AS payment_status,
    p.final_amount AS payment_amount
FROM surveys s
LEFT JOIN assigners a ON s.assigner_id = a.id
LEFT JOIN surveyors sv ON s.surveyor_id = sv.id
LEFT JOIN payments p ON s.id = p.survey_id
WHERE s.status NOT IN ('finished', 'not_resolved');

-- View: Surveyor earnings summary
CREATE OR REPLACE VIEW vw_surveyor_earnings AS
SELECT 
    sv.id AS surveyor_id,
    sv.full_name,
    sv.phone,
    COUNT(sp.id) AS total_payouts,
    SUM(CASE WHEN sp.status = 'completed' THEN sp.payout_amount ELSE 0 END) AS total_earned,
    SUM(CASE WHEN sp.status = 'pending' THEN sp.payout_amount ELSE 0 END) AS pending_amount,
    COUNT(CASE WHEN sp.status = 'completed' THEN 1 END) AS completed_surveys
FROM surveyors sv
LEFT JOIN surveyor_payouts sp ON sv.id = sp.surveyor_id
GROUP BY sv.id, sv.full_name, sv.phone;

-- View: Monthly revenue report
CREATE OR REPLACE VIEW vw_monthly_revenue AS
SELECT 
    DATE_FORMAT(p.paid_at, '%Y-%m') AS month,
    COUNT(p.id) AS total_payments,
    SUM(p.final_amount) AS total_revenue,
    SUM(p.platform_commission_amount) AS total_commission,
    SUM(p.surveyor_payout_amount) AS total_payouts,
    SUM(p.discount_amount) AS total_discounts
FROM payments p
WHERE p.status = 'completed' AND p.paid_at IS NOT NULL
GROUP BY DATE_FORMAT(p.paid_at, '%Y-%m')
ORDER BY month DESC;

-- =====================================================
-- SECTION 11: TRIGGERS FOR AUTOMATION
-- =====================================================

DELIMITER //

-- Trigger: Auto-log status changes
CREATE TRIGGER trg_survey_status_change
AFTER UPDATE ON surveys
FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO survey_status_history (
            survey_id, 
            previous_status, 
            new_status, 
            changed_by_type,
            remarks
        ) VALUES (
            NEW.id,
            OLD.status,
            NEW.status,
            'system',
            CONCAT('Status changed from ', OLD.status, ' to ', NEW.status)
        );
    END IF;
END//

-- Trigger: Update coupon usage count
CREATE TRIGGER trg_payment_coupon_usage
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    IF NEW.coupon_id IS NOT NULL AND NEW.status = 'completed' THEN
        UPDATE coupons 
        SET usage_count = usage_count + 1 
        WHERE id = NEW.coupon_id;
    END IF;
END//

-- Trigger: Auto-uppercase vehicle number (motor surveys)
CREATE TRIGGER trg_motor_vehicle_uppercase
BEFORE INSERT ON motor_survey_details
FOR EACH ROW
BEGIN
    SET NEW.vehicle_number = UPPER(NEW.vehicle_number);
END//

CREATE TRIGGER trg_motor_vehicle_uppercase_update
BEFORE UPDATE ON motor_survey_details
FOR EACH ROW
BEGIN
    SET NEW.vehicle_number = UPPER(NEW.vehicle_number);
END//

-- Trigger: Auto-uppercase vehicle number (investigation surveys)
CREATE TRIGGER trg_investigation_vehicle_uppercase
BEFORE INSERT ON investigation_survey_details
FOR EACH ROW
BEGIN
    IF NEW.vehicle_number IS NOT NULL THEN
        SET NEW.vehicle_number = UPPER(NEW.vehicle_number);
    END IF;
END//

CREATE TRIGGER trg_investigation_vehicle_uppercase_update
BEFORE UPDATE ON investigation_survey_details
FOR EACH ROW
BEGIN
    IF NEW.vehicle_number IS NOT NULL THEN
        SET NEW.vehicle_number = UPPER(NEW.vehicle_number);
    END IF;
END//

DELIMITER ;

-- =====================================================
-- SECTION 12: STORED PROCEDURES
-- =====================================================

DELIMITER //

-- Procedure: Generate LAID (Live Assignment ID)
-- Format: LYY-MM-DD HH:MM (e.g., L25-12-05 19:32)
CREATE PROCEDURE sp_generate_laid(OUT new_laid VARCHAR(16))
BEGIN
    SET new_laid = CONCAT('L', DATE_FORMAT(NOW(), '%y-%m-%d %H:%i'));
END//

-- Procedure: Find surveyors within radius
CREATE PROCEDURE sp_find_surveyors_in_radius(
    IN incident_lat DECIMAL(10, 8),
    IN incident_lng DECIMAL(11, 8),
    IN radius_km DECIMAL(10, 2),
    IN max_count INT
)
BEGIN
    SELECT 
        s.id,
        s.full_name,
        s.phone,
        s.email,
        s.current_latitude,
        s.current_longitude,
        (
            6371 * ACOS(
                COS(RADIANS(incident_lat)) * COS(RADIANS(s.current_latitude)) *
                COS(RADIANS(s.current_longitude) - RADIANS(incident_lng)) +
                SIN(RADIANS(incident_lat)) * SIN(RADIANS(s.current_latitude))
            )
        ) AS distance_km
    FROM surveyors s
    WHERE s.is_active = TRUE
      AND s.is_available = TRUE
      AND s.verification_status = 'verified'
      AND s.current_latitude IS NOT NULL
      AND s.current_longitude IS NOT NULL
    HAVING distance_km <= radius_km
    ORDER BY distance_km ASC
    LIMIT max_count;
END//

-- Procedure: Calculate distance between two coordinates
CREATE PROCEDURE sp_calculate_distance(
    IN lat1 DECIMAL(10, 8),
    IN lng1 DECIMAL(11, 8),
    IN lat2 DECIMAL(10, 8),
    IN lng2 DECIMAL(11, 8),
    OUT distance_km DECIMAL(10, 2)
)
BEGIN
    SET distance_km = (
        6371 * ACOS(
            COS(RADIANS(lat1)) * COS(RADIANS(lat2)) *
            COS(RADIANS(lng2) - RADIANS(lng1)) +
            SIN(RADIANS(lat1)) * SIN(RADIANS(lat2))
        )
    );
END//

-- Procedure: Get pricing tier for distance
CREATE PROCEDURE sp_get_price_for_distance(
    IN distance_km DECIMAL(10, 2),
    OUT tier_name VARCHAR(50),
    OUT price_amount DECIMAL(10, 2)
)
BEGIN
    SELECT pt.tier_name, pt.price_amount
    INTO tier_name, price_amount
    FROM pricing_tiers pt
    WHERE pt.is_active = TRUE
      AND pt.min_distance_km <= distance_km
      AND (pt.max_distance_km IS NULL OR pt.max_distance_km > distance_km)
    LIMIT 1;
END//

-- Procedure: Check and escalate disputes older than X days
CREATE PROCEDURE sp_escalate_old_disputes()
BEGIN
    DECLARE escalation_days INT;
    
    -- Get escalation days from config
    SELECT CAST(config_value AS UNSIGNED) INTO escalation_days
    FROM system_config 
    WHERE config_key = 'dispute_escalation_days';
    
    IF escalation_days IS NULL THEN
        SET escalation_days = 7;
    END IF;
    
    -- Escalate eligible disputes
    UPDATE disputes 
    SET 
        status = 'escalated',
        is_escalated = TRUE,
        escalated_at = NOW(),
        escalation_reason = CONCAT('Auto-escalated: No resolution after ', escalation_days, ' days')
    WHERE status IN ('open', 'in_discussion', 'resubmitted')
      AND is_escalated = FALSE
      AND created_at <= DATE_SUB(NOW(), INTERVAL escalation_days DAY);
      
    SELECT ROW_COUNT() AS disputes_escalated;
END//

DELIMITER ;

-- =====================================================
-- SECTION 13: EVENTS FOR SCHEDULED TASKS
-- =====================================================

-- Enable event scheduler
SET GLOBAL event_scheduler = ON;

DELIMITER //

-- Event: Daily dispute escalation check (runs at 1 AM)
CREATE EVENT IF NOT EXISTS evt_daily_dispute_escalation
ON SCHEDULE EVERY 1 DAY
STARTS CONCAT(CURDATE() + INTERVAL 1 DAY, ' 01:00:00')
DO
BEGIN
    CALL sp_escalate_old_disputes();
END//

DELIMITER ;

-- =====================================================
-- FINAL NOTES
-- =====================================================
-- 
-- This schema includes:
-- - 27 tables covering all platform requirements
-- - Complete audit trails for surveys and transactions
-- - Proper indexing for performance
-- - Foreign key constraints with appropriate CASCADE rules
-- - Triggers for automation (status logging, vehicle uppercase)
-- - Stored procedures for common operations
-- - Views for reporting
-- - Initial configuration data
--
-- To use this schema:
-- 1. Run this SQL file in MySQL 8.0+
-- 2. Create application user with appropriate privileges
-- 3. Configure connection pooling in application
-- 4. Set up scheduled jobs for dispute escalation
--
-- =====================================================
