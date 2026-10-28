/**
 * Surveyor Dispute Controller
 */

const db = require('../../config/database');
const { success, error, notFound } = require('../../utils/response');

/**
 * Get Dispute Details by Survey ID
 * GET /api/v1/surveyor/surveys/:id/dispute
 */
const getDisputeBySurvey = async (req, res, next) => {
    try {
        const survey = await db.execute_single(
            'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
            [req.params.id, req.user.id]
        );

        if (!survey) {
            return res.status(404).json(notFound('Survey not found'));
        }

        const dispute = await db.execute_single(
            `SELECT d.*, 
              s.laid, s.case_reference, s.status as survey_status,
              a.company_name as assigner_name, a.phone as assigner_phone,
              sv.full_name as surveyor_name, sv.phone as surveyor_phone
       FROM disputes d
       JOIN surveys s ON d.survey_id = s.id
       JOIN assigners a ON d.assigner_id = a.id
       JOIN surveyors sv ON d.surveyor_id = sv.id
       WHERE d.survey_id = ?`,
            [req.params.id]
        );

        if (!dispute) {
            return res.status(404).json(notFound('No dispute found for this survey'));
        }

        // Get messages
        const messages = await db.query_rows(
            `SELECT * FROM dispute_messages WHERE dispute_id = ? ORDER BY created_at ASC`,
            [dispute.id]
        );

        dispute.messages = messages;

        res.json(success(dispute));
    } catch (err) {
        next(err);
    }
};

/**
 * Add Message to Dispute
 * POST /api/v1/surveyor/disputes/:id/messages
 */
const addMessage = async (req, res, next) => {
    try {
        const { message_text } = req.body;
        if (!message_text) {
            return res.status(400).json(error('Message text is required'));
        }

        // Verify ownership (Surveyor must be part of the dispute)
        const dispute = await db.execute_single(
            'SELECT id, status FROM disputes WHERE id = ? AND surveyor_id = ?',
            [req.params.id, req.user.id]
        );

        if (!dispute) return res.status(404).json(notFound('Dispute not found or unauthorized'));

        const result = await db.execute_query(
            `INSERT INTO dispute_messages (dispute_id, sender_type, sender_id, message_text)
       VALUES (?, 'surveyor', ?, ?)`,
            [req.params.id, req.user.id, message_text]
        );

        // Emit real-time event
        const { emitDisputeMessage } = require('../../config/socket');
        const messageData = {
            id: result.insertId,
            dispute_id: req.params.id,
            survey_id: dispute.survey_id, // Fetch or ensure available
            sender_type: 'surveyor',
            sender_id: req.user.id,
            message_text,
            created_at: new Date()
        };

        // Fetch survey_id if not in dispute object query
        const surveyId = (await db.execute_single('SELECT survey_id FROM disputes WHERE id = ?', [req.params.id])).survey_id;

        emitDisputeMessage(surveyId, messageData);

        // Notify relevant parties
        const notificationHelper = require('../../services/notification.helper');
        const surveyor = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [req.user.id]);

        await notificationHelper.notifyDisputeMessage(
            req.params.id,
            'surveyor',
            req.user.id,
            surveyor?.full_name || 'Surveyor',
            message_text
        ).catch(err => console.error('Dispute notification error:', err));

        res.json(success(null, 'Message sent successfully'));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getDisputeBySurvey,
    addMessage
};
