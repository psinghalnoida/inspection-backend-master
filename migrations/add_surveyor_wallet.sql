-- =====================================================
-- Surveyor Wallet Feature Migration
-- Created: 2026-02-02
-- Description: Adds wallet system for surveyors
-- =====================================================

-- -----------------------------------------------------
-- Table: surveyor_wallets
-- Description: Store wallet balance per surveyor
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS surveyor_wallets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    surveyor_id BIGINT UNSIGNED NOT NULL UNIQUE,
    balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Current available balance',
    total_earned DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Lifetime earnings',
    total_withdrawn DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Total amount withdrawn',
    last_transaction_at TIMESTAMP NULL COMMENT 'Last transaction timestamp',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_wallet_surveyor (surveyor_id),
    INDEX idx_wallet_balance (balance),
    
    CONSTRAINT fk_wallet_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Surveyor wallet balances';

-- -----------------------------------------------------
-- Table: wallet_transactions
-- Description: Transaction history for surveyor wallets
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    surveyor_id BIGINT UNSIGNED NOT NULL,
    
    -- Transaction Type
    type ENUM('credit', 'debit') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL COMMENT 'Transaction amount',
    balance_after DECIMAL(12, 2) NOT NULL COMMENT 'Balance after this transaction',
    
    -- Reference
    reference_type ENUM('survey_payout', 'withdrawal', 'adjustment', 'bonus', 'refund') NOT NULL,
    reference_id BIGINT UNSIGNED NULL COMMENT 'ID of related record (payment_id, withdrawal_id, etc.)',
    survey_id BIGINT UNSIGNED NULL COMMENT 'Related survey if applicable',
    
    -- Details
    description VARCHAR(255) NULL COMMENT 'Human readable description',
    metadata JSON NULL COMMENT 'Additional data',
    
    -- Status (for withdrawals)
    status ENUM('completed', 'pending', 'failed') DEFAULT 'completed',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_wallet_txn_surveyor (surveyor_id),
    INDEX idx_wallet_txn_type (type),
    INDEX idx_wallet_txn_ref (reference_type, reference_id),
    INDEX idx_wallet_txn_survey (survey_id),
    INDEX idx_wallet_txn_created (created_at DESC),
    
    CONSTRAINT fk_wallet_txn_surveyor FOREIGN KEY (surveyor_id) 
        REFERENCES surveyors(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_wallet_txn_survey FOREIGN KEY (survey_id) 
        REFERENCES surveys(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB COMMENT='Wallet transaction history';

-- Create wallet for existing surveyors (optional - can be done on first transaction)
-- INSERT IGNORE INTO surveyor_wallets (surveyor_id) 
-- SELECT id FROM surveyors;
