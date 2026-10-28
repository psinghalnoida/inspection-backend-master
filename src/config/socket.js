/**
 * Socket.IO Configuration
 * Real-time communication for live location tracking
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./database');


let io = null;

// Store active connections
const activeConnections = {
    surveyors: new Map(), // surveyorId -> socketId
    assigners: new Map(), // assignerId -> Set<socketId>
    surveyRooms: new Map(), // surveyId -> Set<socketId>
    activeChatViewers: new Map(), // surveyId -> Set<userId>
    activeDisputeViewers: new Map(), // disputeId -> Set<userId>
};

/**
 * Initialize Socket.IO server
 * @param {Object} httpServer - HTTP server instance
 */
const initializeSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.FRONTEND_URL || '*',
            methods: ['GET', 'POST'],
            credentials: true,
        },
        pingTimeout: 60000,
        pingInterval: 25000,
    });

    // Authentication middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;

            if (!token) {
                return next(new Error('Authentication token is required'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.id;
            socket.userRole = decoded.role;
            socket.userEmail = decoded.email;

            console.log(`🔌 Socket auth successful: ${decoded.role} #${decoded.id}`);
            next();
        } catch (err) {
            console.error('❌ Socket auth error:', err.message);
            next(new Error('Invalid authentication token'));
        }
    });

    // Handle connections
    io.on('connection', (socket) => {
        console.log(`✅ Socket connected: ${socket.userRole} #${socket.userId} (${socket.id})`);

        // Store the connection
        if (socket.userRole === 'surveyor') {
            activeConnections.surveyors.set(socket.userId, socket.id);
            // Join personal room for receiving targeted notifications
            socket.join(`surveyor:${socket.userId}`);
            console.log(`📍 Surveyor #${socket.userId} joined personal room`);

            // Broadcast surveyor online status to all admins
            console.log(`📡 Broadcasting surveyor #${socket.userId} ONLINE to all clients`);
            io.emit('surveyor:availability', {
                surveyorId: socket.userId,
                isAvailable: true,
                timestamp: new Date().toISOString()
            });
        } else if (socket.userRole === 'assigner') {
            if (!activeConnections.assigners.has(socket.userId)) {
                activeConnections.assigners.set(socket.userId, new Set());
            }
            activeConnections.assigners.get(socket.userId).add(socket.id);
            // Join personal room for receiving targeted notifications  
            socket.join(`assigner:${socket.userId}`);
        }

        // Join survey room for real-time tracking
        socket.on('join:survey', async (surveyId) => {
            try {
                // Verify the user has access to this survey
                let hasAccess = false;

                if (socket.userRole === 'surveyor') {
                    const survey = await db.execute_single(
                        'SELECT id FROM surveys WHERE id = ? AND surveyor_id = ?',
                        [surveyId, socket.userId]
                    );
                    hasAccess = !!survey;
                } else if (socket.userRole === 'assigner') {
                    const survey = await db.execute_single(
                        'SELECT id FROM surveys WHERE id = ? AND assigner_id = ?',
                        [surveyId, socket.userId]
                    );
                    hasAccess = !!survey;
                } else if (socket.userRole === 'admin' || socket.userRole === 'super_admin') {
                    // Admins have access to all surveys
                    hasAccess = true;
                }

                if (hasAccess) {
                    socket.join(`survey:${surveyId}`);
                    console.log(`✅ Success: ${socket.userRole} #${socket.userId} joined survey room: ${surveyId}`);

                    if (!activeConnections.surveyRooms.has(surveyId)) {
                        activeConnections.surveyRooms.set(surveyId, new Set());
                    }
                    activeConnections.surveyRooms.get(surveyId).add(socket.id);

                    console.log(`📍 ${socket.userRole} #${socket.userId} joined survey room: ${surveyId}`);
                    socket.emit('survey:joined', { surveyId, success: true });
                } else {
                    console.log(`❌ Access denied: ${socket.userRole} #${socket.userId} tried to join survey ${surveyId}`);
                    socket.emit('survey:joined', { surveyId, success: false, error: 'Access denied' });
                }
            } catch (err) {
                console.error(`❌ Error joining survey room ${surveyId}:`, err);
                socket.emit('survey:joined', { surveyId, success: false, error: err.message });
            }
        });

        // Leave survey room
        socket.on('leave:survey', (surveyId) => {
            socket.leave(`survey:${surveyId}`);

            if (activeConnections.surveyRooms.has(surveyId)) {
                activeConnections.surveyRooms.get(surveyId).delete(socket.id);
            }

            console.log(`📍 ${socket.userRole} #${socket.userId} left survey room: ${surveyId}`);
        });

        // Handle surveyor location updates
        socket.on('location:update', async (data) => {
            if (socket.userRole !== 'surveyor') {
                return socket.emit('error', { message: 'Only surveyors can send location updates' });
            }

            const { surveyId, latitude, longitude } = data;

            if (!surveyId || !latitude || !longitude) {
                return socket.emit('error', { message: 'Survey ID, latitude, and longitude are required' });
            }

            try {
                // Verify surveyor owns this survey and it's in transit
                const survey = await db.execute_single(
                    "SELECT id, assigner_id, status FROM surveys WHERE id = ? AND surveyor_id = ? AND status = 'in_transit'",
                    [surveyId, socket.userId]
                );

                if (!survey) {
                    return socket.emit('error', { message: 'Survey not found or not in transit' });
                }

                // Update surveyor's location in database
                await db.execute_query(
                    'UPDATE surveyors SET current_latitude = ?, current_longitude = ?, location_updated_at = NOW() WHERE id = ?',
                    [latitude, longitude, socket.userId]
                );

                const locationData = {
                    surveyId,
                    surveyorId: socket.userId,
                    latitude,
                    longitude,
                    timestamp: new Date().toISOString(),
                };

                // Broadcast to the survey room (including the assigner)
                io.to(`survey:${surveyId}`).emit('location:updated', locationData);

                console.log(`📍 Location broadcast for survey ${surveyId}: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
            } catch (err) {
                console.error('Error processing location update:', err);
                socket.emit('error', { message: 'Failed to update location' });
            }
        });

        // Handle survey status updates
        socket.on('status:update', async (data) => {
            const { surveyId, status } = data;

            // Broadcast status change to survey room
            io.to(`survey:${surveyId}`).emit('status:updated', {
                surveyId,
                status,
                timestamp: new Date().toISOString(),
            });

            console.log(`📢 Status update for survey ${surveyId}: ${status}`);
        });

        // Handle broadcast events (for assigners watching live)
        socket.on('broadcast:join', (surveyId) => {
            socket.join(`broadcast:${surveyId}`);
            console.log(`📡 Assigner joined broadcast room for survey ${surveyId}`);
        });

        socket.on('broadcast:leave', (surveyId) => {
            socket.leave(`broadcast:${surveyId}`);
            console.log(`📡 Assigner left broadcast room for survey ${surveyId}`);
        });

        // Handle chat view presence
        socket.on('join:chat_view', (surveyId) => {
            if (!activeConnections.activeChatViewers.has(surveyId)) {
                activeConnections.activeChatViewers.set(surveyId, new Set());
            }
            activeConnections.activeChatViewers.get(surveyId).add(socket.userId);
            socket.currentChatView = surveyId;
            console.log(`👀 User #${socket.userId} viewing chat for survey ${surveyId}`);
        });

        socket.on('leave:chat_view', (surveyId) => {
            if (activeConnections.activeChatViewers.has(surveyId)) {
                activeConnections.activeChatViewers.get(surveyId).delete(socket.userId);
                if (activeConnections.activeChatViewers.get(surveyId).size === 0) {
                    activeConnections.activeChatViewers.delete(surveyId);
                }
            }
            socket.currentChatView = null;
            console.log(`🙈 User #${socket.userId} left chat view for survey ${surveyId}`);
        });

        // Handle dispute view presence
        socket.on('join:dispute_view', (disputeId) => {
            if (!activeConnections.activeDisputeViewers.has(disputeId)) {
                activeConnections.activeDisputeViewers.set(disputeId, new Set());
            }
            activeConnections.activeDisputeViewers.get(disputeId).add(socket.userId);
            socket.currentDisputeView = disputeId;
            console.log(`⚖️ User #${socket.userId} viewing dispute ${disputeId}`);
        });

        socket.on('leave:dispute_view', (disputeId) => {
            if (activeConnections.activeDisputeViewers.has(disputeId)) {
                activeConnections.activeDisputeViewers.get(disputeId).delete(socket.userId);
                if (activeConnections.activeDisputeViewers.get(disputeId).size === 0) {
                    activeConnections.activeDisputeViewers.delete(disputeId);
                }
            }
            socket.currentDisputeView = null;
            console.log(`🙈 User #${socket.userId} left dispute view ${disputeId}`);
        });

        // Handle chat messages
        socket.on('chat:send_message', async (data) => {
            let { surveyId, message, senderId, senderName, senderRole } = data;

            // Fetch sender name if missing
            if (!senderName || senderName === 'undefined') {
                try {
                    if (senderRole === 'surveyor') {
                        const user = await db.execute_single('SELECT full_name FROM surveyors WHERE id = ?', [senderId]);
                        if (user) senderName = user.full_name;
                    } else if (senderRole === 'assigner') {
                        const user = await db.execute_single('SELECT company_name, contact_person_name FROM assigners WHERE id = ?', [senderId]);
                        if (user) senderName = user.company_name || user.contact_person_name;
                    }
                } catch (err) {
                    console.error('Error fetching sender name:', err);
                }

                // Fallback
                if (!senderName) senderName = senderRole === 'surveyor' ? 'Surveyor' : 'Assigner';
            }

            try {
                // Lazy load to avoid circular dependency
                const notificationHelper = require('../services/notification.helper');

                // Save to Database
                const result = await db.execute_query(
                    `INSERT INTO chat_messages (
                        survey_id, sender_type, sender_id, message_type, message_text, sent_at
                    ) VALUES (?, ?, ?, 'text', ?, NOW())`,
                    [surveyId, senderRole, senderId, message]
                );

                const messageId = result.insertId;

                // Broadcast to the room
                io.to(`survey:${surveyId}`).emit('chat:receive_message', {
                    _id: messageId,
                    surveyId,
                    text: message,
                    senderId,
                    senderName,
                    senderRole,
                    createdAt: new Date().toISOString(),
                    user: {
                        _id: senderId,
                        name: senderName,
                        role: senderRole
                    }
                });

                console.log(`💬 Chat saved & broadcast for survey ${surveyId} (ID: ${messageId})`);

                // Send push notification to recipient if they are not in the room (or even if they are, for persistent record)
                // Determine recipient
                const recipientRole = senderRole === 'surveyor' ? 'assigner' : 'surveyor';
                const survey = await db.execute_single(
                    'SELECT assigner_id, surveyor_id FROM surveys WHERE id = ?',
                    [surveyId]
                );

                if (survey) {
                    const recipientId = recipientRole === 'assigner'
                        ? survey.assigner_id
                        : survey.surveyor_id;

                    // Check if recipient is currently viewing the chat
                    const viewers = activeConnections.activeChatViewers.get(surveyId);
                    // Conversion to string for safety if IDs are different types
                    const isRecipientViewing = viewers && (viewers.has(recipientId) || viewers.has(String(recipientId)) || viewers.has(Number(recipientId)));

                    if (!isRecipientViewing) {
                        // Send push notification
                        await notificationHelper.notifyChatMessage(
                            recipientRole,
                            recipientId,
                            senderName,
                            surveyId,
                            message
                        ).catch(err => console.error('Chat notification error:', err));
                    } else {
                        console.log(`🔕 Suppressed push for chat ${surveyId} (Recipient #${recipientId} is viewing)`);
                    }
                }

            } catch (err) {
                console.error('❌ Error saving chat message:', err);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`❌ Socket disconnected: ${socket.userRole} #${socket.userId} (${socket.id})`);

            // Clean up chat view
            if (socket.currentChatView) {
                const surveyId = socket.currentChatView;
                if (activeConnections.activeChatViewers.has(surveyId)) {
                    activeConnections.activeChatViewers.get(surveyId).delete(socket.userId);
                    if (activeConnections.activeChatViewers.get(surveyId).size === 0) {
                        activeConnections.activeChatViewers.delete(surveyId);
                    }
                }
            }

            // Clean up dispute view
            if (socket.currentDisputeView) {
                const disputeId = socket.currentDisputeView;
                if (activeConnections.activeDisputeViewers.has(disputeId)) {
                    activeConnections.activeDisputeViewers.get(disputeId).delete(socket.userId);
                    if (activeConnections.activeDisputeViewers.get(disputeId).size === 0) {
                        activeConnections.activeDisputeViewers.delete(disputeId);
                    }
                }
            }

            // Clean up connections
            if (socket.userRole === 'surveyor') {
                activeConnections.surveyors.delete(socket.userId);

                // Broadcast surveyor offline status to all admins
                console.log(`📡 Broadcasting surveyor #${socket.userId} OFFLINE to all clients`);
                io.emit('surveyor:availability', {
                    surveyorId: socket.userId,
                    isAvailable: false,
                    timestamp: new Date().toISOString()
                });
            } else if (socket.userRole === 'assigner') {
                const assignerSockets = activeConnections.assigners.get(socket.userId);
                if (assignerSockets) {
                    assignerSockets.delete(socket.id);
                    if (assignerSockets.size === 0) {
                        activeConnections.assigners.delete(socket.userId);
                    }
                }
            }

            // Clean up from survey rooms
            activeConnections.surveyRooms.forEach((sockets, surveyId) => {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    activeConnections.surveyRooms.delete(surveyId);
                }
            });
        });
    });

    console.log('🔌 Socket.IO initialized');
    return io;
};

/**
 * Get the Socket.IO instance
 */
const getIO = () => {
    if (!io) {
        throw new Error('Socket.IO has not been initialized');
    }
    return io;
};

/**
 * Emit location update to a specific survey room
 */
const emitLocationUpdate = (surveyId, locationData) => {
    if (io) {
        io.to(`survey:${surveyId}`).emit('location:updated', {
            ...locationData,
            timestamp: new Date().toISOString(),
        });
    }
};

/**
 * Emit status update to a specific survey room
 */
const emitStatusUpdate = (surveyId, status, additionalData = {}) => {
    if (io) {
        io.to(`survey:${surveyId}`).emit('status:updated', {
            surveyId,
            status,
            ...additionalData,
            timestamp: new Date().toISOString(),
        });
    }
};

/**
 * Check if a surveyor is online
 */
const isSurveyorOnline = (surveyorId) => {
    return activeConnections.surveyors.has(surveyorId);
};

/**
 * Get active connections stats
 */
const getConnectionStats = () => {
    return {
        surveyors: activeConnections.surveyors.size,
        assigners: activeConnections.assigners.size,
        surveyRooms: activeConnections.surveyRooms.size,
    };
};

/**
 * Emit notification to a specific user (via socket)
 */
const emitNotificationToUser = (userType, userId, notification) => {
    if (io) {
        const room = `${userType}:${userId}`;
        io.to(room).emit('notification:new', notification);
        console.log(`🔔 Socket notification sent to ${room}`);
    }
};

/**
 * Emit unread count update to a specific user
 */
const emitUnreadCountUpdate = (userType, userId, count) => {
    if (io) {
        const room = `${userType}:${userId}`;
        io.to(room).emit('notification:unread_count', { count });
    }
};

/**
 * Emit dispute message to survey room
 */
const emitDisputeMessage = (surveyId, message) => {
    if (io) {
        io.to(`survey:${surveyId}`).emit('dispute:message', message);
    }
};

/**
 * Emit media-added event so clients viewing the survey can refetch.
 * payload: { surveyId, mediaType, sessionNumber, count }
 */
const emitMediaAdded = (surveyId, payload = {}) => {
    if (io) {
        io.to(`survey:${surveyId}`).emit('survey:media:added', {
            surveyId,
            ...payload,
            timestamp: new Date().toISOString(),
        });
    }
};

/**
 * Emit notes-updated event so clients can refetch session notes.
 * payload: { surveyId, sessionNumber }
 */
const emitNotesUpdated = (surveyId, payload = {}) => {
    if (io) {
        io.to(`survey:${surveyId}`).emit('survey:notes:updated', {
            surveyId,
            ...payload,
            timestamp: new Date().toISOString(),
        });
    }
};

/**
 * Check if a user is currently viewing a specific survey chat
 */
const isUserViewingChat = (surveyId, userId) => {
    const viewers = activeConnections.activeChatViewers.get(surveyId);
    if (!viewers) return false;
    // Check against string and number versions of ID to be safe
    return viewers.has(userId) || viewers.has(String(userId)) || viewers.has(Number(userId));
};

/**
 * Check if a user is currently viewing a specific dispute
 */
const isUserViewingDispute = (disputeId, userId) => {
    const viewers = activeConnections.activeDisputeViewers.get(disputeId);
    if (!viewers) return false;
    // Check against string and number versions of ID to be safe
    return viewers.has(userId) || viewers.has(String(userId)) || viewers.has(Number(userId));
};

module.exports = {
    initializeSocket,
    getIO,
    emitLocationUpdate,
    emitStatusUpdate,
    isSurveyorOnline,
    getConnectionStats,
    emitNotificationToUser,
    emitUnreadCountUpdate,
    emitDisputeMessage,
    emitMediaAdded,
    emitNotesUpdated,
    isUserViewingChat,
    isUserViewingDispute
};
