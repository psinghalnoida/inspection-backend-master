-- Add configuration for surveyor payout percentage (default 40%)
INSERT INTO system_config (config_key, config_value, value_type, description, category) 
VALUES ('surveyor_payout_percentage', '40', 'number', 'Percentage of assigner payment to transfer to surveyor upon satisfaction', 'pricing');

-- Add configuration for survey satisfaction timeout (default 7 days)
INSERT INTO system_config (config_key, config_value, value_type, description, category) 
VALUES ('survey_satisfaction_timeout_days', '7', 'number', 'Days after which a survey prompts the assigner for satisfaction', 'timing');

-- Add payout_type column to surveyor_payouts table to support partial payments
ALTER TABLE surveyor_payouts 
ADD COLUMN payout_type ENUM('full', 'partial', 'balance') DEFAULT 'full' COMMENT 'Type of payout: full, partial, or balance';
