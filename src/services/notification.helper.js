/**
 * Notification Helper Service
 * Combines Firebase push notifications with Socket.IO real-time notifications
 * Used to send notifications on survey events
 */

const firebaseService = require('./firebase.service');
const socketConfig = require('../config/socket');

/**
 * Send notification to a user (both push and socket)
 */
const notifyUser = async ({
    recipientType,
    recipientId,
    title,
    body,
    icon = null,
    notificationType = 'other',
    referenceType = null,
    referenceId = null,
    data = null,
    sendPush = true,
    androidChannelId = null,
    sound = null,
}) => {
    try {
        // Create notification in database and send push
        const notificationId = await firebaseService.createNotification({
            recipientType,
            recipientId,
            title,
            body,
            icon,
            notificationType,
            referenceType,
            referenceId,
            data,
            sendPush,
            androidChannelId,
            sound,
        });

        // Also emit via socket for real-time updates
        if (notificationId) {
            const notification = {
                id: notificationId,
                title,
                body,
                icon,
                notification_type: notificationType,
                reference_type: referenceType,
                reference_id: referenceId,
                data,
                is_read: false,
                created_at: new Date().toISOString()
            };

            socketConfig.emitNotificationToUser(recipientType, recipientId, notification);

            // Send updated unread count
            const unreadCount = await firebaseService.getUnreadCount(recipientType, recipientId);
            socketConfig.emitUnreadCountUpdate(recipientType, recipientId, unreadCount);
        }

        return notificationId;
    } catch (error) {
        console.error('❌ Error in notifyUser:', error);
        return null;
    }
};

// ======================== SURVEY EVENT NOTIFICATIONS ========================

/**
 * Notify surveyor about new survey request (broadcast)
 */
const notifySurveyorNewRequest = async (surveyorId, survey) => {
    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: '🚨 New Survey Request',
        body: `New ${survey.survey_type?.replace(/_/g, ' ')} survey - ${survey.city || 'Location pending'}`,
        icon: 'assignment',
        notificationType: 'broadcast_request',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            surveyType: survey.survey_type,
            city: survey.city,
            distance: survey.distance_km
        },
        // Route through the dedicated Android channel + custom tone so broadcasts
        // are audibly distinct from other notifications. Channel must be registered
        // client-side in lib/notifications.js with the same id.
        androidChannelId: 'survey_requests',
        sound: 'survey_alert',
    });
};

/**
 * Notify assigner that surveyor has accepted
 */
const notifyAssignerSurveyAssigned = async (assignerId, survey, surveyor) => {
    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: '✅ Surveyor Assigned',
        body: `${surveyor.full_name} has accepted your survey request. ETA: ${survey.surveyor_eta_minutes || 'N/A'} mins`,
        icon: 'person-add',
        notificationType: 'survey_assigned',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            surveyorName: surveyor.full_name,
            eta: survey.surveyor_eta_minutes
        }
    });
};

/**
 * Notify surveyor that they have been assigned to a survey
 */
const notifySurveyorSurveyAssigned = async (surveyorId, survey, assigner) => {
    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: '🎉 Survey Assigned to You',
        body: `You have been assigned to survey #${survey.laid || survey.id}${assigner?.company_name ? ` by ${assigner.company_name}` : ''}. Please proceed when ready.`,
        icon: 'assignment-turned-in',
        notificationType: 'survey_assigned',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            laid: survey.laid,
            surveyType: survey.survey_type,
            assignerName: assigner?.company_name || assigner?.full_name
        }
    });
};

/**
 * Notify assigner that surveyor has started transit
 */
const notifyAssignerSurveyorInTransit = async (assignerId, survey, surveyor) => {
    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: '🚗 Surveyor On The Way',
        body: `${surveyor.full_name} has started traveling to the survey location`,
        icon: 'directions-car',
        notificationType: 'survey_started',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            surveyorName: surveyor.full_name
        }
    });
};

/**
 * Notify assigner that surveyor has arrived
 */
const notifyAssignerSurveyorArrived = async (assignerId, survey, surveyor) => {
    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: '📍 Surveyor Arrived',
        body: `${surveyor.full_name} has reached the survey location`,
        icon: 'location-on',
        notificationType: 'surveyor_arrived',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            surveyorName: surveyor.full_name
        }
    });
};

/**
 * Notify assigner that report has been submitted
 */
const notifyAssignerReportSubmitted = async (assignerId, survey, surveyor) => {
    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: '📄 Report Submitted',
        body: `${surveyor.full_name} has submitted the survey report for review`,
        icon: 'description',
        notificationType: 'report_submitted',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            surveyorName: surveyor.full_name
        }
    });
};

/**
 * Notify surveyor that report has been accepted
 */
const notifySurveyorReportAccepted = async (surveyorId, survey) => {
    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: '✅ Report Accepted',
        body: `Your report for survey #${survey.laid || survey.id} has been accepted`,
        icon: 'check-circle',
        notificationType: 'report_accepted',
        referenceType: 'survey',
        referenceId: survey.id,
        data: { surveyId: String(survey.id) }
    });
};

/**
 * Notify surveyor that report has been rejected
 */
const notifySurveyorReportRejected = async (surveyorId, survey, reason) => {
    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: '❌ Report Rejected',
        body: `Your report for survey #${survey.laid || survey.id} needs revision: ${reason || 'Please check details'}`,
        icon: 'error',
        notificationType: 'report_rejected',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            reason
        }
    });
};

/**
 * Notify surveyor about payment released
 */
const notifySurveyorPaymentReleased = async (surveyorId, survey, amount) => {
    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: '💰 Payment Released',
        body: `₹${amount} has been released for survey #${survey.laid || survey.id}`,
        icon: 'account-balance-wallet',
        notificationType: 'payment_released',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            amount: String(amount)
        }
    });
};

/**
 * Notify assigner about payment confirmation
 */
const notifyAssignerPaymentConfirmed = async (assignerId, survey, amount) => {
    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: '✅ Payment Confirmed',
        body: `Payment of ₹${amount} confirmed for survey #${survey.laid || survey.id}`,
        icon: 'payment',
        notificationType: 'payment_received',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            amount: String(amount)
        }
    });
};

/**
 * Notify about new chat message
 */
const notifyChatMessage = async (recipientType, recipientId, senderName, surveyId, messagePreview) => {
    return notifyUser({
        recipientType,
        recipientId,
        title: `💬 New Message from ${senderName}`,
        body: messagePreview.substring(0, 100),
        icon: 'chat',
        notificationType: 'new_chat_message',
        referenceType: 'survey',
        referenceId: surveyId,
        data: {
            surveyId: String(surveyId),
            senderName
        }
    });
};

/**
 * Notify surveyor about broadcast expiry
 */
const notifySurveyorBroadcastExpired = async (surveyorId, surveyId) => {
    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: 'Survey Request Expired',
        body: 'A survey broadcast you were notified about has expired',
        icon: 'timer-off',
        notificationType: 'broadcast_expired',
        referenceType: 'survey',
        referenceId: surveyId,
        data: { surveyId: String(surveyId) },
        sendPush: false // Don't send push for expiry, just update app
    });
};

/**
 * Notify surveyor that payment has been completed and they can start
 */
const notifySurveyorPaymentCompleted = async (surveyorId, survey) => {
    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: '💳 Payment Received - Start Survey',
        body: `Assigner has paid for survey #${survey.laid || survey.id}. You can now start the survey.`,
        icon: 'payment',
        notificationType: 'payment_completed',
        referenceType: 'survey',
        referenceId: survey.id,
        data: { surveyId: String(survey.id) }
    });
};

/**
 * Notify assigner about survey timeout (1 week)
 */
const notifyAssignerTimeoutWarning = async (assignerId, survey) => {
    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: '⏰ Survey Pending for 1 Week',
        body: `Survey #${survey.laid || survey.id} has been pending for ${survey.days_pending} days. Are you satisfied or want admin intervention?`,
        icon: 'schedule',
        notificationType: 'timeout_warning',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            daysPending: survey.days_pending
        }
    });
};

/**
 * Notify admin about survey escalation
 */
const notifyAdminSurveyEscalated = async (surveyId, assignerId, surveyorId) => {
    const db = require('../config/database');

    // Get all admin users
    const admins = await db.execute_query(
        'SELECT id FROM admins WHERE is_active = 1'
    );

    for (const admin of admins) {
        await notifyUser({
            recipientType: 'admin',
            recipientId: admin.id,
            title: '🚨 Survey Escalated',
            body: `Survey #${surveyId} has been escalated for admin review`,
            icon: 'report-problem',
            notificationType: 'other',
            referenceType: 'survey',
            referenceId: surveyId,
            data: {
                surveyId: String(surveyId),
                assignerId: String(assignerId),
                surveyorId: String(surveyorId)
            }
        });
    }
};

/**
 * Tell the assigner their final invoice is ready. (v2 §3)
 *
 * The body states the balance because that is the number that gates the report:
 * until it is paid the assigner cannot download it.
 */
/**
 * Tell the assigner their invoice is fully settled. (v2 §3)
 * Under v2 §4 this is also the moment their report unlocks, so it matters.
 */
const notifyAssignerBillSettled = async (assignerId, survey, bill) => {
    const ref = bill.invoice_number || survey.laid || `#${survey.id}`;

    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: '✅ Invoice settled',
        body: `Invoice ${ref} is fully settled. Nothing further is outstanding.`,
        icon: 'task-alt',
        notificationType: 'bill_settled',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            laid: survey.laid || '',
            invoiceNumber: bill.invoice_number || ''
        }
    });
};

const notifyAssignerBillIssued = async (assignerId, survey, bill) => {
    const balance = Number(bill.balance_due) || 0;
    const ref = bill.invoice_number || survey.laid || `#${survey.id}`;

    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: balance > 0 ? '🧾 Invoice ready — balance due' : '🧾 Invoice ready',
        body: balance > 0
            ? `Invoice ${ref}: ₹${balance.toFixed(2)} is due. Pay the balance to download the survey report.`
            : balance < 0
                // Negative = the advance overshot the invoice. Say credit, never a due amount.
                ? `Invoice ${ref} has been raised. Your advance exceeded it — ₹${Math.abs(balance).toFixed(2)} is a credit in your favour.`
                : `Invoice ${ref} has been raised. Nothing further is due — your advance covered it.`,
        icon: 'receipt-long',
        notificationType: 'bill_issued',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            laid: survey.laid || '',
            invoiceNumber: bill.invoice_number || '',
            totalAmount: String(bill.total_amount ?? ''),
            balanceDue: String(balance)
        }
    });
};

/**
 * Nag admins about completed surveys that still have no bill. (v2 §3.5)
 * Billing is mandatory, and an unbilled survey also blocks the surveyor's payout.
 */
const notifyAdminBillsPending = async (count, oldestDays) => {
    const db = require('../config/database');
    const admins = await db.execute_query('SELECT id FROM admins WHERE is_active = 1');

    for (const admin of admins) {
        await notifyUser({
            recipientType: 'admin',
            recipientId: admin.id,
            title: '🧾 Surveys awaiting billing',
            body: `${count} completed survey${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} no bill yet (oldest ${oldestDays} days). Surveyor payouts are held until these are billed and settled.`,
            icon: 'receipt-long',
            notificationType: 'system',
            referenceType: 'billing',
            referenceId: null,
            data: { pendingCount: String(count), oldestDays: String(oldestDays) }
        });
    }
};

/**
 * Ask a surveyor to confirm they want to be added as an assigner's employee.
 * (v2 §2.4 — "a confirmation notification will be sent whether he want to be
 * added as employee or not on his profile")
 *
 * The consequence is material and must be stated in the body: accepting removes
 * a non-Prime surveyor from open broadcasts entirely.
 */
const notifyEmployeeInvite = async (surveyorId, assigner, { isPrime = false } = {}) => {
    const company = assigner.company_name || assigner.contact_person_name || 'A company';

    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: '👥 Team invitation',
        body: isPrime
            ? `${company} wants to add you to their team. You will keep receiving open survey requests as well.`
            : `${company} wants to add you to their team. If you accept, you will receive work directly from them instead of open survey requests.`,
        icon: 'group-add',
        notificationType: 'employee_invite',
        referenceType: 'assigner',
        referenceId: assigner.id,
        data: {
            assignerId: String(assigner.id),
            companyName: company,
            requiresResponse: 'true'
        }
    });
};

/**
 * Tell the assigner how the surveyor responded to their invite.
 */
const notifyAssignerInviteResponse = async (assignerId, surveyor, accepted) => {
    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: accepted ? '✅ Team invite accepted' : '❌ Team invite declined',
        body: accepted
            ? `${surveyor.full_name} joined your team. You can now assign surveys to them directly.`
            : `${surveyor.full_name} declined your team invitation.`,
        icon: accepted ? 'person-add' : 'person-remove',
        notificationType: 'employee_invite_response',
        referenceType: 'surveyor',
        referenceId: surveyor.id,
        data: {
            surveyorId: String(surveyor.id),
            accepted: String(accepted)
        }
    });
};

/**
 * Notify admins that a broadcast exhausted every radius stage without finding
 * an eligible surveyor. (v2 §2.3)
 *
 * Before this existed the survey silently sat in `location_detected` forever —
 * no alert, no status change, and survey-timeout-check.job.js only looks at
 * `report_submitted`/`not_resolved`, so nothing ever picked it up. Category
 * filtering makes empty result sets far more likely, so this path needs a voice.
 */
const notifyAdminBroadcastExhausted = async (survey, requiredCategory = null) => {
    const db = require('../config/database');

    const admins = await db.execute_query('SELECT id FROM admins WHERE is_active = 1');

    const reason = requiredCategory
        ? `No available ${requiredCategory} surveyor was found in range`
        : 'No available surveyor was found in range';

    for (const admin of admins) {
        await notifyUser({
            recipientType: 'admin',
            recipientId: admin.id,
            title: '⚠️ Survey needs manual assignment',
            body: `${reason} for survey ${survey.laid || `#${survey.id}`}. Assign a surveyor manually.`,
            icon: 'person-search',
            notificationType: 'other',
            referenceType: 'survey',
            referenceId: survey.id,
            data: {
                surveyId: String(survey.id),
                laid: survey.laid || '',
                surveyType: survey.survey_type || '',
                requiredCategory: requiredCategory || ''
            }
        });
    }
};

/**
 * Notify surveyor that a survey has been escalated to admin
 */
const notifySurveyorSurveyEscalated = async (surveyorId, survey) => {
    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: '🚨 Survey Escalated to Admin',
        body: `Survey #${survey.laid || survey.id} has been escalated for admin review`,
        icon: 'report-problem',
        notificationType: 'other',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            laid: survey.laid || ''
        }
    });
};

/**
 * Notify surveyor about admin's decision on disputed survey
 */
const notifySurveyorAdminDecision = async (surveyorId, survey, decision, amount = 0, notes = null) => {
    const isApproved = decision === 'approved' || decision === 'full_payment' || decision === 'partial_payment';

    return notifyUser({
        recipientType: 'surveyor',
        recipientId: surveyorId,
        title: isApproved ? '✅ Admin Approved Payment' : '❌ Payment Not Approved',
        body: isApproved
            ? `Admin has approved your payment of ₹${amount} for survey #${survey.laid || survey.id}`
            : `Admin has reviewed survey #${survey.laid || survey.id}. ${notes || 'Payment not approved.'}`,
        icon: isApproved ? 'check-circle' : 'cancel',
        notificationType: 'other',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            decision,
            amount: String(amount)
        }
    });
};

/**
 * Notify assigner about admin's decision on disputed survey
 */
const notifyAssignerAdminDecision = async (assignerId, survey, decision, amount = 0, notes = null) => {
    const isApproved = decision === 'approved' || decision === 'full_payment' || decision === 'partial_payment';

    return notifyUser({
        recipientType: 'assigner',
        recipientId: assignerId,
        title: isApproved ? '✅ Dispute Decided: Payment Approved' : '❌ Dispute Decided: No Payment',
        body: isApproved
            ? `Admin has decided on dispute for survey #${survey.laid || survey.id}. Decision: ${decision.replace('_', ' ')}${amount > 0 ? `. Amount: ₹${amount}` : ''}`
            : `Admin has reviewed the dispute for survey #${survey.laid || survey.id}. Result: No payment. ${notes || ''}`,
        icon: isApproved ? 'check-circle' : 'cancel',
        notificationType: 'other',
        referenceType: 'survey',
        referenceId: survey.id,
        data: {
            surveyId: String(survey.id),
            decision,
            amount: String(amount)
        }
    });
};

/**
 * Notify relevant parties about a new message in a dispute
 */
const notifyDisputeMessage = async (disputeId, senderType, senderId, senderName, messageText) => {
    const db = require('../config/database');
    const socketConfig = require('../config/socket');

    // Fetch dispute and survey info
    const dispute = await db.execute_single(`
        SELECT d.id, d.survey_id, d.assigner_id, d.surveyor_id, s.laid
        FROM disputes d
        JOIN surveys s ON d.survey_id = s.id
        WHERE d.id = ?
    `, [disputeId]);

    if (!dispute) return;

    const title = `⚖️ New Dispute Message - ${dispute.laid || dispute.survey_id}`;
    const body = `${senderName}: ${messageText}`;
    const notificationType = 'other';

    const notifications = [];

    // Notify Surveyor if they are not the sender and not viewing the dispute
    if (senderType !== 'surveyor' && dispute.surveyor_id) {
        const isViewing = socketConfig.isUserViewingDispute(disputeId, dispute.surveyor_id);
        if (!isViewing) {
            notifications.push(notifyUser({
                recipientType: 'surveyor',
                recipientId: dispute.surveyor_id,
                title,
                body,
                icon: 'gavel',
                notificationType,
                referenceType: 'dispute',
                referenceId: disputeId,
                data: { disputeId: String(disputeId), surveyId: String(dispute.survey_id) }
            }));
        }
    }

    // Notify Assigner if they are not the sender and not viewing the dispute
    if (senderType !== 'assigner' && dispute.assigner_id) {
        const isViewing = socketConfig.isUserViewingDispute(disputeId, dispute.assigner_id);
        if (!isViewing) {
            notifications.push(notifyUser({
                recipientType: 'assigner',
                recipientId: dispute.assigner_id,
                title,
                body,
                icon: 'gavel',
                notificationType,
                referenceType: 'dispute',
                referenceId: disputeId,
                data: { disputeId: String(disputeId), surveyId: String(dispute.survey_id) }
            }));
        }
    }

    // Notify Admins if they are not the sender
    if (senderType !== 'admin') {
        const admins = await db.execute_query('SELECT id FROM admins WHERE is_active = 1');
        for (const admin of admins) {
            const isViewing = socketConfig.isUserViewingDispute(disputeId, admin.id);
            if (!isViewing) {
                notifications.push(notifyUser({
                    recipientType: 'admin',
                    recipientId: admin.id,
                    title,
                    body,
                    icon: 'gavel',
                    notificationType,
                    referenceType: 'dispute',
                    referenceId: disputeId,
                    data: { disputeId: String(disputeId), surveyId: String(dispute.survey_id) }
                }));
            }
        }
    }

    await Promise.all(notifications).catch(err => console.error('Dispute notification error:', err));
};

module.exports = {
    notifyUser,
    notifySurveyorNewRequest,
    notifyAssignerSurveyAssigned,
    notifySurveyorSurveyAssigned,
    notifyAssignerSurveyorInTransit,
    notifyAssignerSurveyorArrived,
    notifyAssignerReportSubmitted,
    notifySurveyorReportAccepted,
    notifySurveyorReportRejected,
    notifySurveyorPaymentReleased,
    notifyAssignerPaymentConfirmed,
    notifyChatMessage,
    notifySurveyorBroadcastExpired,
    notifySurveyorPaymentCompleted,
    notifyAssignerTimeoutWarning,
    notifyAdminSurveyEscalated,
    notifyAdminBroadcastExhausted,
    notifyEmployeeInvite,
    notifyAssignerInviteResponse,
    notifyAssignerBillIssued,
    notifyAssignerBillSettled,
    notifyAdminBillsPending,
    notifySurveyorSurveyEscalated,
    notifySurveyorAdminDecision,
    notifyAssignerAdminDecision,
    notifyDisputeMessage,
};
