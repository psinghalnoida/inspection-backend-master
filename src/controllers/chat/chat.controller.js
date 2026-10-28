/**
 * Chat Controller (Shared between Assigner and Surveyor)
 */

const db = require('../../config/database');
const { success, error, notFound, created, paginated } = require('../../utils/response');
const notificationHelper = require('../../services/notification.helper');
const socketConfig = require('../../config/socket');
const { parsePagination } = require('../../utils/helpers');
const { USER_ROLES } = require('../../utils/constants');

/**
 * Get Chat Messages
 * GET /api/v1/assigner/surveys/:id/chat
 * GET /api/v1/surveyor/surveys/:id/chat
 */
const getMessages = async (req, res, next) => {
  try {
    let { page, limit, offset } = parsePagination(req.query);

    // Default to 50 messages for chat if not specified
    if (!req.query.limit) {
      limit = 50;
      offset = (page - 1) * limit;
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Verify access to survey
    let survey;
    if (userRole === USER_ROLES.ASSIGNER) {
      survey = await db.execute_single(
        'SELECT id FROM surveys WHERE id = ? AND assigner_id = ?',
        [req.params.id, userId]
      );
    } else if (userRole === USER_ROLES.SURVEYOR) {
      survey = await db.execute_single(
        'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
        [req.params.id, userId]
      );
    }

    if (!survey) {
      return res.status(404).json(notFound('Survey not found or access denied'));
    }

    const [messages, countResult] = await Promise.all([
      db.query_rows(
        `SELECT * FROM chat_messages 
         WHERE survey_id = ? AND is_deleted = FALSE
         ORDER BY sent_at DESC
         LIMIT ? OFFSET ?`,
        [req.params.id, limit, offset]
      ),
      db.query_single(
        'SELECT COUNT(*) as total FROM chat_messages WHERE survey_id = ? AND is_deleted = FALSE',
        [req.params.id]
      )
    ]);

    // Reverse messages to show strictly chronological (oldest to newest)
    // but we fetched newest first to ensure we get the latest conversation
    messages.reverse();

    // Mark messages as read
    const oppositeType = userRole === USER_ROLES.ASSIGNER ? 'surveyor' : 'assigner';
    await db.execute_query(
      `UPDATE chat_messages SET is_read = TRUE, read_at = NOW()
       WHERE survey_id = ? AND sender_type = ? AND is_read = FALSE`,
      [req.params.id, oppositeType]
    );

    res.json(paginated(messages, { page, limit, total: countResult.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Send Message
 * POST /api/v1/assigner/surveys/:id/chat
 * POST /api/v1/surveyor/surveys/:id/chat
 */
const sendMessage = async (req, res, next) => {
  try {
    const { message_text, message_type = 'text' } = req.body;
    const userRole = req.user.role;
    const userId = req.user.id;

    if (!message_text && message_type === 'text') {
      return res.status(400).json(error('Message text is required'));
    }

    // Verify access to survey
    let survey;
    if (userRole === USER_ROLES.ASSIGNER) {
      survey = await db.execute_single(
        'SELECT id, status FROM surveys WHERE id = ? AND assigner_id = ?',
        [req.params.id, userId]
      );
    } else if (userRole === USER_ROLES.SURVEYOR) {
      survey = await db.execute_single(
        'SELECT id, status FROM surveys WHERE id = ? AND surveyor_id = ?',
        [req.params.id, userId]
      );
    }

    if (!survey) {
      return res.status(404).json(notFound('Survey not found or access denied'));
    }

    // Check if chat is closed (survey finished)
    if (survey.status === 'finished') {
      return res.status(400).json(error('Chat is closed for completed surveys'));
    }

    // Handle file attachment if present
    let attachmentUrl = null;
    let attachmentName = null;
    let attachmentType = null;
    let attachmentSize = null;

    if (req.file) {
      attachmentUrl = `/uploads/${req.file.filename}`;
      attachmentName = req.file.originalname;
      attachmentType = req.file.mimetype;
      attachmentSize = req.file.size;
    }

    // Insert message
    const result = await db.execute_query(
      `INSERT INTO chat_messages (
        survey_id, sender_type, sender_id, message_type, message_text,
        attachment_url, attachment_name, attachment_type, attachment_size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id, userRole, userId, message_type, message_text || null,
        attachmentUrl, attachmentName, attachmentType, attachmentSize
      ]
    );

    // Broadcast to socket room for real-time updates (Mobile App)
    try {
      const io = socketConfig.getIO();
      if (io) {
        console.log(`📡 Attempting to broadcast chat to survey:${req.params.id}`);
        // Fetch sender name if not already known
        let senderNameForSocket = 'User';
        if (userRole === USER_ROLES.SURVEYOR) {
          const sender = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [userId]);
          senderNameForSocket = sender?.full_name || 'Surveyor';
        } else {
          const sender = await db.execute_single('SELECT company_name, contact_person_name FROM assigners WHERE id = ?', [userId]);
          senderNameForSocket = sender?.company_name || sender?.contact_person_name || 'Assigner';
        }

        io.to(`survey:${req.params.id}`).emit('chat:receive_message', {
          _id: result.insertId,
          surveyId: req.params.id,
          text: message_text,
          senderId: userId,
          senderName: senderNameForSocket,
          senderRole: userRole,
          createdAt: new Date().toISOString(),
          user: {
            _id: userId,
            name: senderNameForSocket,
            role: userRole
          }
        });
        console.log(`✅ Socket event emitted to survey:${req.params.id}`);
      } else {
        console.warn('⚠️ Socket IO instance not available via getIO()');
      }
    } catch (socketErr) {
      console.error('❌ Failed to emit socket event:', socketErr);
    }

    // Send push notification
    try {
      const recipientRole = userRole === USER_ROLES.SURVEYOR ? USER_ROLES.ASSIGNER : USER_ROLES.SURVEYOR;
      let recipientId;
      let senderName = 'User';

      // Get survey details to find recipient and sender name
      const surveyDetails = await db.execute_single(
        'SELECT assigner_id, surveyor_id FROM surveys WHERE id = ?',
        [req.params.id]
      );

      if (surveyDetails) {
        recipientId = userRole === USER_ROLES.SURVEYOR ? surveyDetails.assigner_id : surveyDetails.surveyor_id;

        // Get sender name
        if (userRole === USER_ROLES.SURVEYOR) {
          const sender = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [userId]);
          senderName = sender?.full_name || 'Surveyor';
        } else {
          const sender = await db.execute_single('SELECT company_name, contact_person_name FROM assigners WHERE id = ?', [userId]);
          senderName = sender?.company_name || sender?.contact_person_name || 'Assigner';
        }

        if (recipientId) {
          // Check if user is viewing chat to suppress notification
          const isViewing = socketConfig.isUserViewingChat(req.params.id, recipientId);

          if (!isViewing) {
            await notificationHelper.notifyChatMessage(
              recipientRole,
              recipientId,
              senderName,
              req.params.id,
              message_text || (attachmentUrl ? 'Sent an attachment' : 'Sent a message')
            );
          } else {
            console.log(`🔕 Suppressed push for chat ${req.params.id} (Recipient #${recipientId} is viewing)`);
          }
        }
      }
    } catch (notifyErr) {
      console.error('Failed to send chat notification:', notifyErr);
      // Continue execution, don't fail the request
    }

    res.status(201).json(created({
      id: result.insertId,
      survey_id: parseInt(req.params.id),
      sender_type: userRole,
      message_type,
      message_text,
      attachment_url: attachmentUrl,
      sent_at: new Date()
    }, 'Message sent'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Unread Message Count
 * GET /api/v1/assigner/surveys/:id/chat/unread
 * GET /api/v1/surveyor/surveys/:id/chat/unread
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const oppositeType = userRole === USER_ROLES.ASSIGNER ? 'surveyor' : 'assigner';

    // Verify access
    let surveyCheck;
    if (userRole === USER_ROLES.ASSIGNER) {
      surveyCheck = 'assigner_id = ?';
    } else {
      surveyCheck = 'surveyor_id = ?';
    }

    const result = await db.execute_single(
      `SELECT COUNT(*) as unread_count FROM chat_messages cm
       JOIN surveys s ON cm.survey_id = s.id
       WHERE cm.survey_id = ? AND s.${surveyCheck}
       AND cm.sender_type = ? AND cm.is_read = FALSE`,
      [req.params.id, userId, oppositeType]
    );

    res.json(success({ unread_count: result.unread_count }));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMessages,
  sendMessage,
  getUnreadCount
};
