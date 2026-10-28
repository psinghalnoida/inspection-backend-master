/**
 * Surveyor Wallet Controller
 * Handles wallet balance and transaction history
 */

const db = require('../../config/database');
const { success, error, notFound } = require('../../utils/response');

/**
 * Get Wallet Balance
 * GET /api/v1/surveyor/wallet
 */
const getWalletBalance = async (req, res, next) => {
    try {
        const surveyorId = req.user.id;
        console.log(`Debug: fetching wallet for surveyorId: ${surveyorId}`);

        // Get or create wallet
        let wallet = await db.execute_single(
            'SELECT * FROM surveyor_wallets WHERE surveyor_id = ?',
            [surveyorId]
        );
        console.log('Debug: wallet fetch result:', wallet);

        if (!wallet) {
            // Create wallet if doesn't exist
            await db.execute_query(
                'INSERT INTO surveyor_wallets (surveyor_id) VALUES (?)',
                [surveyorId]
            );
            wallet = {
                balance: 0,
                total_earned: 0,
                total_withdrawn: 0,
                last_transaction_at: null
            };
        }

        // Get recent transactions count
        const recentCount = await db.execute_single(
            `SELECT COUNT(*) as count FROM wallet_transactions 
             WHERE surveyor_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
            [surveyorId]
        );

        res.json(success({
            balance: parseFloat(wallet.balance) || 0,
            total_earned: parseFloat(wallet.total_earned) || 0,
            total_withdrawn: parseFloat(wallet.total_withdrawn) || 0,
            last_transaction_at: wallet.last_transaction_at,
            recent_transactions_count: recentCount?.count || 0
        }));
    } catch (err) {
        next(err);
    }
};

/**
 * Get Wallet Transactions
 * GET /api/v1/surveyor/wallet/transactions
 * Query params: page, limit, type (credit/debit)
 */
const getWalletTransactions = async (req, res, next) => {
    try {
        const surveyorId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const type = req.query.type; // 'credit' or 'debit' or null for all

        // Build query
        let whereClause = 'WHERE wt.surveyor_id = ?';
        const params = [surveyorId];

        if (type && ['credit', 'debit'].includes(type)) {
            whereClause += ' AND wt.type = ?';
            params.push(type);
        }

        // Get total count
        const countResult = await db.execute_single(
            `SELECT COUNT(*) as total FROM wallet_transactions wt ${whereClause}`,
            params
        );
        const total = countResult?.total || 0;

        // Get transactions with survey details
        const transactions = await db.query_rows(
            `SELECT 
                wt.id,
                wt.type,
                wt.amount,
                wt.balance_after,
                wt.reference_type,
                wt.description,
                wt.status,
                wt.created_at,
                wt.survey_id,
                s.laid,
                s.survey_type
             FROM wallet_transactions wt
             LEFT JOIN surveys s ON wt.survey_id = s.id
             ${whereClause}
             ORDER BY wt.created_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        res.json(success({
            transactions: transactions.map(t => ({
                id: t.id,
                type: t.type,
                amount: parseFloat(t.amount),
                balance_after: parseFloat(t.balance_after),
                reference_type: t.reference_type,
                description: t.description,
                status: t.status,
                created_at: t.created_at,
                survey: t.survey_id ? {
                    id: t.survey_id,
                    laid: t.laid,
                    survey_type: t.survey_type
                } : null
            })),
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit)
            }
        }));
    } catch (err) {
        next(err);
    }
};

/**
 * Credit amount to surveyor wallet (Internal use)
 * @param {number} surveyorId 
 * @param {number} amount 
 * @param {string} referenceType 
 * @param {number} referenceId 
 * @param {number} surveyId 
 * @param {string} description 
 */
const creditWallet = async (surveyorId, amount, referenceType, referenceId, surveyId, description) => {
    // Get or create wallet
    let wallet = await db.execute_single(
        'SELECT id, balance FROM surveyor_wallets WHERE surveyor_id = ?',
        [surveyorId]
    );

    if (!wallet) {
        await db.execute_query(
            'INSERT INTO surveyor_wallets (surveyor_id) VALUES (?)',
            [surveyorId]
        );
        wallet = { balance: 0 };
    }

    const newBalance = parseFloat(wallet.balance) + parseFloat(amount);

    // Update wallet balance
    await db.execute_query(
        `UPDATE surveyor_wallets 
         SET balance = ?, 
             total_earned = total_earned + ?,
             last_transaction_at = NOW(),
             updated_at = NOW()
         WHERE surveyor_id = ?`,
        [newBalance, amount, surveyorId]
    );

    // Create transaction record
    await db.execute_query(
        `INSERT INTO wallet_transactions 
         (surveyor_id, type, amount, balance_after, reference_type, reference_id, survey_id, description)
         VALUES (?, 'credit', ?, ?, ?, ?, ?, ?)`,
        [surveyorId, amount, newBalance, referenceType, referenceId, surveyId, description]
    );

    console.log(`💰 Credited ₹${amount} to surveyor ${surveyorId}'s wallet. New balance: ₹${newBalance}`);

    return { newBalance, transactionAmount: amount };
};

module.exports = {
    getWalletBalance,
    getWalletTransactions,
    creditWallet
};
