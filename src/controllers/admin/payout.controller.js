/**
 * Admin Payout Controller
 * Handles wallet management and payout processing for admin panel
 */

const db = require('../../config/database');
const { success, error, paginated } = require('../../utils/response');

/**
 * Get Payout Stats for Dashboard
 * GET /api/v1/admin/payouts/stats
 */
const getPayoutStats = async (req, res, next) => {
    try {
        // Total pending balance across all surveyors
        const pendingBalance = await db.execute_single(
            'SELECT COALESCE(SUM(balance), 0) as total FROM surveyor_wallets WHERE balance > 0'
        );

        // Total earned (all time)
        const totalEarned = await db.execute_single(
            'SELECT COALESCE(SUM(total_earned), 0) as total FROM surveyor_wallets'
        );

        // Total withdrawn
        const totalWithdrawn = await db.execute_single(
            'SELECT COALESCE(SUM(total_withdrawn), 0) as total FROM surveyor_wallets'
        );

        // Recent payouts (last 30 days)
        const recentPayouts = await db.execute_single(
            `SELECT COUNT(*) as count, COALESCE(SUM(payout_amount), 0) as amount 
             FROM surveyor_payouts 
             WHERE status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );

        // Surveyors with pending balance
        const surveyorsWithBalance = await db.execute_single(
            'SELECT COUNT(*) as count FROM surveyor_wallets WHERE balance > 0'
        );

        res.json(success({
            pending_balance: parseFloat(pendingBalance?.total || 0),
            total_earned: parseFloat(totalEarned?.total || 0),
            total_withdrawn: parseFloat(totalWithdrawn?.total || 0),
            recent_payouts_count: recentPayouts?.count || 0,
            recent_payouts_amount: parseFloat(recentPayouts?.amount || 0),
            surveyors_with_balance: surveyorsWithBalance?.count || 0
        }));
    } catch (err) {
        next(err);
    }
};

/**
 * Get All Surveyor Wallets
 * GET /api/v1/admin/payouts/wallets
 */
const getAllWallets = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const sortBy = req.query.sort || 'balance';
        const sortOrder = req.query.order === 'asc' ? 'ASC' : 'DESC';
        const balanceMin = req.query.balance_min;
        const balanceMax = req.query.balance_max;
        const hasBalance = req.query.has_balance; // 'yes' or 'no'

        let whereClause = '1=1';
        const params = [];

        if (search) {
            whereClause += ' AND (s.full_name LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        // Balance filters
        if (hasBalance === 'yes') {
            whereClause += ' AND w.balance > 0';
        } else if (hasBalance === 'no') {
            whereClause += ' AND w.balance = 0';
        }

        if (balanceMin) {
            whereClause += ' AND w.balance >= ?';
            params.push(parseFloat(balanceMin));
        }

        if (balanceMax) {
            whereClause += ' AND w.balance <= ?';
            params.push(parseFloat(balanceMax));
        }

        // Get total count
        const countResult = await db.execute_single(
            `SELECT COUNT(*) as total 
             FROM surveyor_wallets w
             JOIN surveyors s ON w.surveyor_id = s.id
             WHERE ${whereClause}`,
            params
        );
        const total = countResult?.total || 0;

        // Get wallets with surveyor info
        let orderBy = 'w.balance DESC';
        if (sortBy === 'total_earned') orderBy = `w.total_earned ${sortOrder}`;
        else if (sortBy === 'last_transaction_at') orderBy = `w.last_transaction_at ${sortOrder}`;
        else if (sortBy === 'created_at') orderBy = `w.created_at ${sortOrder}`;
        else if (sortBy === 'name') orderBy = `s.full_name ${sortOrder}`;
        else orderBy = `w.balance ${sortOrder}`;

        const wallets = await db.query_rows(
            `SELECT 
                w.id,
                w.surveyor_id,
                w.balance,
                w.total_earned,
                w.total_withdrawn,
                w.last_transaction_at,
                s.full_name,
                s.phone,
                s.email,
                s.city,
                s.is_active
             FROM surveyor_wallets w
             JOIN surveyors s ON w.surveyor_id = s.id
             WHERE ${whereClause}
             ORDER BY ${orderBy}
             LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        res.json(paginated(
            wallets.map(w => ({
                id: w.id,
                surveyor_id: w.surveyor_id,
                balance: parseFloat(w.balance),
                total_earned: parseFloat(w.total_earned),
                total_withdrawn: parseFloat(w.total_withdrawn),
                last_transaction_at: w.last_transaction_at,
                surveyor: {
                    id: w.surveyor_id,
                    name: w.full_name,
                    phone: w.phone,
                    email: w.email,
                    city: w.city,
                    is_active: w.is_active
                }
            })),
            { page, limit, total }
        ));
    } catch (err) {
        next(err);
    }
};

/**
 * Get Wallet Details for a Surveyor
 * GET /api/v1/admin/payouts/wallets/:surveyorId
 */
const getWalletDetails = async (req, res, next) => {
    try {
        const { surveyorId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        // Get surveyor and wallet
        const surveyor = await db.execute_single(
            `SELECT s.*, w.balance, w.total_earned, w.total_withdrawn, w.last_transaction_at
             FROM surveyors s
             LEFT JOIN surveyor_wallets w ON s.id = w.surveyor_id
             WHERE s.id = ?`,
            [surveyorId]
        );

        if (!surveyor) {
            return res.status(404).json(error('Surveyor not found'));
        }

        // Get transactions count
        const txnCount = await db.execute_single(
            'SELECT COUNT(*) as total FROM wallet_transactions WHERE surveyor_id = ?',
            [surveyorId]
        );

        // Get transactions
        const transactions = await db.query_rows(
            `SELECT 
                wt.*,
                sv.laid,
                sv.survey_type
             FROM wallet_transactions wt
             LEFT JOIN surveys sv ON wt.survey_id = sv.id
             WHERE wt.surveyor_id = ?
             ORDER BY wt.created_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            [surveyorId]
        );

        // Get payout history for this surveyor
        const payouts = await db.query_rows(
            `SELECT * FROM surveyor_payouts 
             WHERE surveyor_id = ? 
             ORDER BY created_at DESC 
             LIMIT 10`,
            [surveyorId]
        );

        res.json(success({
            surveyor: {
                id: surveyor.id,
                name: surveyor.full_name,
                phone: surveyor.phone,
                email: surveyor.email,
                city: surveyor.city,
                is_active: surveyor.is_active,
                upi_id: surveyor.upi_id,
                bank_ifsc_code: surveyor.bank_ifsc_code
            },
            wallet: {
                balance: parseFloat(surveyor.balance) || 0,
                total_earned: parseFloat(surveyor.total_earned) || 0,
                total_withdrawn: parseFloat(surveyor.total_withdrawn) || 0,
                last_transaction_at: surveyor.last_transaction_at
            },
            transactions: {
                data: transactions.map(t => ({
                    id: t.id,
                    type: t.type,
                    amount: parseFloat(t.amount),
                    balance_after: parseFloat(t.balance_after),
                    description: t.description,
                    reference_type: t.reference_type,
                    survey: t.survey_id ? { id: t.survey_id, laid: t.laid, survey_type: t.survey_type } : null,
                    created_at: t.created_at
                })),
                pagination: {
                    page,
                    limit,
                    total: txnCount?.total || 0,
                    total_pages: Math.ceil((txnCount?.total || 0) / limit)
                }
            },
            recent_payouts: payouts.map(p => ({
                id: p.id,
                amount: parseFloat(p.payout_amount),
                method: p.payout_method,
                status: p.status,
                utr_number: p.utr_number,
                created_at: p.created_at,
                completed_at: p.completed_at
            }))
        }));
    } catch (err) {
        next(err);
    }
};

/**
 * Get Payout History
 * GET /api/v1/admin/payouts/history
 */
const getPayoutHistory = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status;
        const surveyorId = req.query.surveyor_id;
        const fromDate = req.query.date_from || req.query.from_date;
        const toDate = req.query.date_to || req.query.to_date;
        const search = req.query.search;
        const method = req.query.method;
        const amountMin = req.query.amount_min;
        const amountMax = req.query.amount_max;

        let whereClause = '1=1';
        const params = [];

        if (status) {
            whereClause += ' AND sp.status = ?';
            params.push(status);
        }
        if (surveyorId) {
            whereClause += ' AND sp.surveyor_id = ?';
            params.push(surveyorId);
        }
        if (fromDate) {
            whereClause += ' AND sp.created_at >= ?';
            params.push(fromDate);
        }
        if (toDate) {
            whereClause += ' AND sp.created_at <= ?';
            params.push(toDate + ' 23:59:59');
        }
        if (search) {
            whereClause += ' AND (s.full_name LIKE ? OR sv.laid LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (method) {
            whereClause += ' AND sp.payout_method = ?';
            params.push(method);
        }
        if (amountMin) {
            whereClause += ' AND sp.payout_amount >= ?';
            params.push(parseFloat(amountMin));
        }
        if (amountMax) {
            whereClause += ' AND sp.payout_amount <= ?';
            params.push(parseFloat(amountMax));
        }

        // Get count
        const countResult = await db.execute_single(
            `SELECT COUNT(*) as total FROM surveyor_payouts sp WHERE ${whereClause}`,
            params
        );

        // Get payouts
        const payouts = await db.query_rows(
            `SELECT 
                sp.*,
                s.full_name as surveyor_name,
                s.phone as surveyor_phone,
                sv.laid
             FROM surveyor_payouts sp
             JOIN surveyors s ON sp.surveyor_id = s.id
             LEFT JOIN surveys sv ON sp.survey_id = sv.id
             WHERE ${whereClause}
             ORDER BY sp.created_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        res.json(paginated(
            payouts.map(p => ({
                id: p.id,
                surveyor: {
                    id: p.surveyor_id,
                    name: p.surveyor_name,
                    phone: p.surveyor_phone
                },
                survey: p.survey_id ? { id: p.survey_id, laid: p.laid } : null,
                amount: parseFloat(p.payout_amount),
                method: p.payout_method,
                type: p.payout_type,
                status: p.status,
                utr_number: p.utr_number,
                transfer_reference: p.transfer_reference,
                failure_reason: p.failure_reason,
                created_at: p.created_at,
                completed_at: p.completed_at
            })),
            { page, limit, total: countResult?.total || 0 }
        ));
    } catch (err) {
        next(err);
    }
};

/**
 * Process Manual Payout (Mark as Paid)
 * POST /api/v1/admin/payouts/process
 */
const processManualPayout = async (req, res, next) => {
    try {
        const { surveyor_id, amount, utr_number, transfer_reference, payout_method, notes } = req.body;

        if (!surveyor_id || !amount) {
            return res.status(400).json(error('Surveyor ID and amount are required'));
        }

        // Get surveyor wallet
        const wallet = await db.execute_single(
            'SELECT * FROM surveyor_wallets WHERE surveyor_id = ?',
            [surveyor_id]
        );

        if (!wallet) {
            return res.status(404).json(error('Surveyor wallet not found'));
        }

        if (parseFloat(wallet.balance) < parseFloat(amount)) {
            return res.status(400).json(error('Insufficient wallet balance'));
        }

        const newBalance = parseFloat(wallet.balance) - parseFloat(amount);

        // Update wallet
        await db.execute_query(
            `UPDATE surveyor_wallets 
             SET balance = ?, 
                 total_withdrawn = total_withdrawn + ?,
                 last_transaction_at = NOW(),
                 updated_at = NOW()
             WHERE surveyor_id = ?`,
            [newBalance, amount, surveyor_id]
        );

        // Create debit transaction
        await db.execute_query(
            `INSERT INTO wallet_transactions 
             (surveyor_id, type, amount, balance_after, reference_type, description, status)
             VALUES (?, 'debit', ?, ?, 'manual_payout', ?, 'completed')`,
            [surveyor_id, amount, newBalance, notes || 'Manual payout by admin']
        );

        // Create payout record
        const payoutResult = await db.execute_query(
            `INSERT INTO surveyor_payouts 
             (payment_id, survey_id, surveyor_id, payout_amount, payout_method, payout_type, 
              utr_number, transfer_reference, status, completed_at)
             VALUES (NULL, NULL, ?, ?, ?, 'manual_withdrawal', ?, ?, 'completed', NOW())`,
            [surveyor_id, amount, payout_method || 'bank_transfer', utr_number || null, transfer_reference || null]
        );

        console.log(`✅ Admin processed payout of ₹${amount} to surveyor ${surveyor_id}. UTR: ${utr_number || 'N/A'}`);

        res.json(success({
            payout_id: payoutResult.insertId,
            new_balance: newBalance,
            amount_paid: parseFloat(amount)
        }, 'Payout processed successfully'));
    } catch (err) {
        next(err);
    }
};

/**
     * Sync Payouts by LAIDs (for Excel upload sync)
     * POST /api/v1/admin/payouts/sync-by-laids
     * Body: { laids: ["LAID-001", "LAID-002", ...] }
     */
const syncPayoutsByLaids = async (req, res, next) => {
    try {
        const { laids } = req.body;

        if (!laids || !Array.isArray(laids) || laids.length === 0) {
            return res.status(400).json(error('LAIDs array is required'));
        }

        // Limit to prevent abuse
        if (laids.length > 1000) {
            return res.status(400).json(error('Maximum 1000 LAIDs allowed per sync'));
        }

        // Create placeholders for SQL IN clause
        const placeholders = laids.map(() => '?').join(',');

        // Get latest payout data for these LAIDs
        const payouts = await db.query_rows(
            `SELECT 
                sv.laid,
                sp.created_at,
                s.full_name as surveyor_name,
                s.phone as surveyor_phone,
                sp.payout_amount,
                sp.payout_method,
                sp.payout_type,
                sp.status,
                sp.utr_number,
                sp.completed_at
             FROM surveys sv
             LEFT JOIN surveyor_payouts sp ON sv.id = sp.survey_id
             LEFT JOIN surveyors s ON sp.surveyor_id = s.id
             WHERE sv.laid IN (${placeholders})`,
            laids
        );

        // Convert to a map for easy lookup
        const payoutMap = {};
        payouts.forEach(p => {
            payoutMap[p.laid] = {
                survey_id: p.laid,
                date: p.created_at,
                surveyor_name: p.surveyor_name || '',
                surveyor_phone: p.surveyor_phone || '',
                amount: parseFloat(p.payout_amount) || 0,
                method: p.payout_method || 'Wallet',
                type: p.payout_type || 'survey_completion',
                status: p.status || 'pending',
                utr_number: p.utr_number || '',
                completed_at: p.completed_at
            };
        });

        res.json(success({
            matched_count: Object.keys(payoutMap).length,
            total_requested: laids.length,
            data: payoutMap
        }));
    } catch (err) {
        next(err);
    }
};

/**
 * Sync Wallets by Phone numbers (for Excel upload sync)
 * POST /api/v1/admin/payouts/sync-by-phones
 * Body: { phones: ["9876543210", "9876543211", ...] }
 */
const syncWalletsByPhones = async (req, res, next) => {
    try {
        const { phones } = req.body;

        if (!phones || !Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json(error('Phones array is required'));
        }

        // Limit to prevent abuse
        if (phones.length > 1000) {
            return res.status(400).json(error('Maximum 1000 phones allowed per sync'));
        }

        // Clean phone numbers (remove spaces, +91, etc.)
        const cleanedPhones = phones.map(p => String(p).replace(/\D/g, '').slice(-10));

        // Create placeholders for SQL IN clause
        const placeholders = cleanedPhones.map(() => '?').join(',');

        // Get latest wallet data for these phones
        const wallets = await db.query_rows(
            `SELECT 
                s.phone,
                s.full_name as surveyor_name,
                s.email,
                s.city,
                s.is_active,
                w.balance,
                w.total_earned,
                w.total_withdrawn,
                w.last_transaction_at
             FROM surveyors s
             LEFT JOIN surveyor_wallets w ON s.id = w.surveyor_id
             WHERE s.phone IN (${placeholders})`,
            cleanedPhones
        );

        // Convert to a map for easy lookup
        const walletMap = {};
        wallets.forEach(w => {
            walletMap[w.phone] = {
                surveyor_name: w.surveyor_name || '',
                phone: w.phone,
                email: w.email || '',
                city: w.city || '',
                balance: parseFloat(w.balance) || 0,
                total_earned: parseFloat(w.total_earned) || 0,
                total_withdrawn: parseFloat(w.total_withdrawn) || 0,
                last_activity: w.last_transaction_at,
                status: w.is_active ? 'Active' : 'Inactive'
            };
        });

        res.json(success({
            matched_count: Object.keys(walletMap).length,
            total_requested: phones.length,
            data: walletMap
        }));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getPayoutStats,
    getAllWallets,
    getWalletDetails,
    getPayoutHistory,
    processManualPayout,
    syncPayoutsByLaids,
    syncWalletsByPhones
};
