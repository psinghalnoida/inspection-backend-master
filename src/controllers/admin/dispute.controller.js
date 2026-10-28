/**
 * Admin Dispute Controller
 */

const db = require('../../config/database');
const { success, error, notFound, paginated } = require('../../utils/response');
const { parsePagination } = require('../../utils/helpers');
const { SURVEY_STATUS } = require('../../utils/constants');
const notificationHelper = require('../../services/notification.helper');
const walletController = require('../surveyor/wallet.controller');

/**
 * List Disputes
 * GET /api/v1/admin/disputes
 */
const listDisputes = async (req, res, next) => {
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const { status } = req.query;

        let whereClause = '1=1';
        const whereParams = [];

        if (status) {
            whereClause += ' AND d.status = ?';
            whereParams.push(status);
        }

        const listParams = [...whereParams, limit, offset];

        const [disputes, countResult] = await Promise.all([
            db.query_rows(
                `SELECT d.*, 
                s.laid, s.case_reference,
                a.company_name as assigner_name,
                sv.full_name as surveyor_name
         FROM disputes d
         JOIN surveys s ON d.survey_id = s.id
         JOIN assigners a ON d.assigner_id = a.id
         JOIN surveyors sv ON d.surveyor_id = sv.id
         WHERE ${whereClause}
         ORDER BY d.created_at DESC
         LIMIT ? OFFSET ?`,
                listParams
            ),
            db.query_single(`SELECT COUNT(*) as total FROM disputes d WHERE ${whereClause}`, whereParams)
        ]);

        res.json(paginated(disputes, { page, limit, total: countResult.total }));
    } catch (err) {
        next(err);
    }
};

/**
 * Get Dispute Details
 * GET /api/v1/admin/disputes/:id
 */
const getDispute = async (req, res, next) => {
    try {
        const dispute = await db.execute_single(
            `SELECT d.*, 
              s.laid, s.case_reference, s.status as survey_status,
              a.company_name as assigner_name, a.phone as assigner_phone,
              sv.full_name as surveyor_name, sv.phone as surveyor_phone
       FROM disputes d
       JOIN surveys s ON d.survey_id = s.id
       JOIN assigners a ON d.assigner_id = a.id
       JOIN surveyors sv ON d.surveyor_id = sv.id
       WHERE d.id = ?`,
            [req.params.id]
        );

        if (!dispute) {
            return res.status(404).json(notFound('Dispute not found'));
        }

        // Get messages
        const messages = await db.query_rows(
            `SELECT * FROM dispute_messages WHERE dispute_id = ? ORDER BY created_at ASC`,
            [req.params.id]
        );

        dispute.messages = messages;

        res.json(success(dispute));
    } catch (err) {
        next(err);
    }
};

/**
 * Resolve Dispute
 * PUT /api/v1/admin/disputes/:id/resolve
 */
const resolveDispute = async (req, res, next) => {
    try {
        const { decision, notes, partial_amount } = req.body; // decision: full_payment, partial_payment, no_payment

        if (!['full_payment', 'partial_payment', 'no_payment'].includes(decision)) {
            return res.status(400).json(error('Invalid decision'));
        }

        const dispute = await db.execute_single(
            'SELECT * FROM disputes WHERE id = ?',
            [req.params.id]
        );

        if (!dispute) return res.status(404).json(notFound('Dispute not found'));

        if (dispute.status === 'resolved') {
            return res.status(400).json(error('Dispute already resolved'));
        }

        // Handle Decision
        if (decision === 'full_payment' || decision === 'partial_payment') {
            const payment = await db.execute_single(
                'SELECT id, final_amount, surveyor_payout_amount FROM payments WHERE survey_id = ? AND status = ?',
                [dispute.survey_id, 'completed']
            );

            if (payment) {
                let payoutAmount = 0;

                if (decision === 'full_payment') {
                    // Use the original surveyor payout amount calculated during payment initiation
                    // This ensures consistency (e.g. 75% share)
                    payoutAmount = parseFloat(payment.surveyor_payout_amount);
                } else if (decision === 'partial_payment') {
                    payoutAmount = parseFloat(partial_amount);
                    if (isNaN(payoutAmount)) return res.status(400).json(error('Partial amount is required'));
                }

                // Create Payout record and credit wallet
                const surveyData = await db.execute_single('SELECT laid FROM surveys WHERE id = ?', [dispute.survey_id]);

                // Credit to surveyor wallet
                await walletController.creditWallet(
                    dispute.surveyor_id,
                    payoutAmount,
                    'survey_payout',
                    dispute.id,
                    dispute.survey_id,
                    `Dispute resolved for survey ${surveyData?.laid || dispute.survey_id} (${decision})`
                );

                // Create payout record (as completed since wallet is credited)
                await db.execute_query(
                    `INSERT INTO surveyor_payouts (payment_id, survey_id, surveyor_id, payout_amount, payout_method, status, payout_type, completed_at)
                     VALUES (?, ?, ?, ?, 'wallet', 'completed', 'dispute_resolution', NOW())`,
                    [payment.id, dispute.survey_id, dispute.surveyor_id, payoutAmount]
                );

                // Notify Surveyor
                const survey = { id: dispute.survey_id, laid: surveyData?.laid };
                await notificationHelper.notifySurveyorAdminDecision(
                    dispute.surveyor_id,
                    { id: dispute.survey_id, laid: survey?.laid },
                    decision === 'full_payment' ? 'approved' : 'partial_payment', // Translate decision for surveyor
                    payoutAmount
                ).catch(err => console.error('Notification error (Surveyor):', err));

                // Notify Assigner
                await notificationHelper.notifyAssignerAdminDecision(
                    dispute.assigner_id,
                    { id: dispute.survey_id, laid: survey?.laid },
                    decision,
                    payoutAmount
                ).catch(err => console.error('Notification error (Assigner):', err));
            }

            // Update Survey
            await db.execute_query(
                "UPDATE surveys SET status = 'finished', completed_at = NOW() WHERE id = ?",
                [dispute.survey_id]
            );
        } else {
            // No Payment — case is closed; mark survey as finished so status matches the dispute resolution
            await db.execute_query(
                "UPDATE surveys SET status = 'finished', completed_at = NOW(), updated_at = NOW() WHERE id = ?",
                [dispute.survey_id]
            );

            // Notify Surveyor
            const survey = await db.execute_single('SELECT laid FROM surveys WHERE id = ?', [dispute.survey_id]);
            await notificationHelper.notifySurveyorAdminDecision(
                dispute.surveyor_id,
                { id: dispute.survey_id, laid: survey?.laid },
                'rejected',
                0,
                notes
            ).catch(err => console.error('Notification error (Surveyor):', err));

            // Notify Assigner
            await notificationHelper.notifyAssignerAdminDecision(
                dispute.assigner_id,
                { id: dispute.survey_id, laid: survey?.laid },
                'rejected',
                0,
                notes
            ).catch(err => console.error('Notification error (Assigner):', err));
        }

        // Update Dispute
        await db.execute_query(
            `UPDATE disputes SET 
        status = 'resolved', 
        admin_decision = ?, 
        admin_decision_notes = ?, 
        admin_partial_amount = ?,
        admin_decided_by = ?,
        admin_decided_at = NOW(),
        resolved_at = NOW(),
        resolved_by_type = 'admin',
        resolved_by_id = ?
       WHERE id = ?`,
            [decision, notes || null, partial_amount || null, req.user.id, req.user.id, req.params.id]
        );

        res.json(success(null, 'Dispute resolved successfully'));
    } catch (err) {
        next(err);
    }
};

/**
 * Add Message to Dispute
 * POST /api/v1/admin/disputes/:id/messages
 */
const addMessage = async (req, res, next) => {
    try {
        const { message_text } = req.body;
        if (!message_text) {
            return res.status(400).json(error('Message text is required'));
        }

        const dispute = await db.execute_single(
            'SELECT id, status, assigner_id, surveyor_id FROM disputes WHERE id = ?',
            [req.params.id]
        );

        if (!dispute) return res.status(404).json(notFound('Dispute not found'));

        // Allow messaging even if resolved (for follow-up questions)

        const result = await db.execute_query(
            `INSERT INTO dispute_messages (dispute_id, sender_type, sender_id, message_text)
       VALUES (?, 'admin', ?, ?)`,
            [req.params.id, req.user.id, message_text]
        );

        // Emit real-time event
        const { emitDisputeMessage } = require('../../config/socket');
        const messageData = {
            id: result.insertId,
            dispute_id: req.params.id,
            survey_id: dispute.survey_id, // Fetch or ensure available
            sender_type: 'admin',
            sender_id: req.user.id,
            message_text,
            created_at: new Date()
        };

        // Fetch survey_id if not in dispute object query
        const surveyId = (await db.execute_single('SELECT survey_id FROM disputes WHERE id = ?', [req.params.id])).survey_id;

        emitDisputeMessage(surveyId, messageData);

        // Notify relevant parties
        const admin = await db.execute_single('SELECT full_name FROM admins WHERE id = ?', [req.user.id]);

        await notificationHelper.notifyDisputeMessage(
            req.params.id,
            'admin',
            req.user.id,
            admin?.full_name || 'Admin',
            message_text
        ).catch(err => console.error('Dispute notification error:', err));

        res.json(success(null, 'Message sent successfully'));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    listDisputes,
    getDispute,
    resolveDispute,
    addMessage
};
