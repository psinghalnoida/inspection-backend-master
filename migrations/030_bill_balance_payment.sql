-- Migration 030: SabPaisa balance payment tracking on survey bills (v2 §4)
-- MySQL 8.x (Railway). Safe to re-run.
--
-- The assigner pays the invoice balance through the same SabPaisa gateway used
-- for the advance. We store the SabPaisa client transaction id on the bill so
-- the shared callback can reconcile a successful payment back to it and settle.
-- No new config keys: SabPaisa credentials already live in the backend .env.

DELIMITER $$
DROP PROCEDURE IF EXISTS _v2_bill_balance $$
CREATE PROCEDURE _v2_bill_balance()
BEGIN
  DECLARE v_db VARCHAR(64) DEFAULT DATABASE();

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=v_db AND TABLE_NAME='survey_bills' AND COLUMN_NAME='sabpaisa_txn_id') THEN
    ALTER TABLE survey_bills
      ADD COLUMN sabpaisa_txn_id VARCHAR(30) NULL COMMENT 'SabPaisa client txn id for the balance payment',
      ADD COLUMN sabpaisa_payment_status VARCHAR(20) NULL COMMENT 'Last observed SabPaisa status';
    ALTER TABLE survey_bills ADD INDEX idx_bills_sabpaisa_txn (sabpaisa_txn_id);
  END IF;
END $$
DELIMITER ;

CALL _v2_bill_balance();
DROP PROCEDURE _v2_bill_balance;
