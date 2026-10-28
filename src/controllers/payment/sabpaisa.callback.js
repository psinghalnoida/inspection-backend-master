/**
 * SabPaisa Payment Callback Controller
 * Handles payment gateway callbacks and updates payment status
 */

const db = require('../../config/database');
const sabpaisaService = require('../../services/sabpaisa.service');
const notificationHelper = require('../../services/notification.helper');
const { generateQRToken } = require('../../utils/helpers');
const { SURVEY_STATUS } = require('../../utils/constants');

/**
 * Get redirect URL based on platform (web or app)
 */
const getRedirectUrl = (req, path, params) => {
    const userAgent = req.get('User-Agent') || '';
    const referer = req.get('Referer') || '';

    // Check if request is from web browser (not mobile app WebView)
    const isWebBrowser = (
        (userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari')) &&
        !userAgent.includes('wv') && // Android WebView
        !userAgent.includes('WebView') // iOS WebView
    ) || referer.includes(process.env.FRONTEND_URL || 'localhost:3001');

    const queryString = new URLSearchParams(params).toString();

    if (isWebBrowser) {
        // Redirect to web frontend
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        return `${frontendUrl}/payment/callback?${queryString}`;
    } else {
        // Redirect to app deep link
        const deepLink = process.env.APP_DEEP_LINK || 'claimsmitra://';
        return `${deepLink}payment?${queryString}`;
    }
};

/**
 * Handle SabPaisa callback
 * POST/GET /api/v1/public/payment/sabpaisa/callback
 */
const handleCallback = async (req, res) => {
    try {
        // SabPaisa sends encrypted response in 'encResponse' parameter
        const encResponse = req.body.encResponse || req.query.encResponse;

        if (!encResponse) {
            console.error('SabPaisa Callback: No encResponse received');
            return res.redirect(getRedirectUrl(req, 'payment', { status: 'error', message: 'No response received' }));
        }

        console.log('SabPaisa Callback received:', {
            hasEncResponse: !!encResponse,
            method: req.method,
            userAgent: req.get('User-Agent')
        });

        // Parse and decrypt the response
        const parsedResponse = sabpaisaService.parseCallbackResponse(encResponse);
        console.log('SabPaisa Parsed Response:', {
            status: parsedResponse.status,
            clientTxnId: parsedResponse.clientTxnId,
            sabpaisaTxnId: parsedResponse.sabpaisaTxnId
        });

        // Validate the response
        const validatedResponse = sabpaisaService.validatePaymentResponse(parsedResponse);

        // Extract payment info from clientTxnId (format: CM{paymentId}_{timestamp}_{random})
        const clientTxnId = validatedResponse.clientTxnId;

        // Find payment by gateway_order_id (clientTxnId)
        const payment = await db.execute_single(
            'SELECT * FROM payments WHERE gateway_order_id = ?',
            [clientTxnId]
        );

        if (!payment) {
            // Not an advance payment — this may be an invoice balance payment (v2 §4).
            // Those are tracked on survey_bills.sabpaisa_txn_id, not payments.
            const bill = await db.execute_single(
                'SELECT * FROM survey_bills WHERE sabpaisa_txn_id = ?',
                [clientTxnId]
            );
            if (bill) {
                return handleBillBalanceCallback(req, res, bill, validatedResponse);
            }

            console.error('SabPaisa Callback: Payment not found for clientTxnId:', clientTxnId);
            return res.redirect(getRedirectUrl(req, 'payment', { status: 'error', message: 'Payment not found' }));
        }

        // Check if payment already processed
        if (payment.status === 'completed') {
            console.log('SabPaisa Callback: Payment already completed:', payment.id);
            return res.redirect(getRedirectUrl(req, 'payment', {
                status: 'success',
                payment_id: payment.id,
                survey_id: payment.survey_id
            }));
        }

        if (validatedResponse.isSuccess) {
            // Payment successful
            await processSuccessfulPayment(payment, validatedResponse, parsedResponse);

            return res.redirect(getRedirectUrl(req, 'payment', {
                status: 'success',
                payment_id: payment.id,
                survey_id: payment.survey_id
            }));
        } else {
            // Payment failed
            await processFailedPayment(payment, validatedResponse, parsedResponse);

            return res.redirect(getRedirectUrl(req, 'payment', {
                status: 'failed',
                payment_id: payment.id,
                message: validatedResponse.message || 'Payment failed'
            }));
        }
    } catch (error) {
        console.error('SabPaisa Callback Error:', error);
        return res.redirect(getRedirectUrl(req, 'payment', { status: 'error', message: 'Processing error' }));
    }
};

/**
 * Settle an invoice balance paid via SabPaisa. (v2 §4)
 *
 * Runs through the shared settlement path (ledger credit, report unlock, export,
 * surveyor payout) — the exact same code the admin "Record payment" uses. The
 * only trusted success signal is SabPaisa's own SUCCESS status.
 */
const handleBillBalanceCallback = async (req, res, bill, validatedResponse) => {
    const surveyId = bill.survey_id;

    // Record the observed status regardless of outcome.
    await db.execute_query(
        'UPDATE survey_bills SET sabpaisa_payment_status = ?, updated_at = NOW() WHERE id = ?',
        [validatedResponse.status || (validatedResponse.isSuccess ? 'SUCCESS' : 'FAILED'), bill.id]
    );

    if (!validatedResponse.isSuccess) {
        console.log('SabPaisa bill balance failed:', { billId: bill.id, status: validatedResponse.status });
        return res.redirect(getRedirectUrl(req, 'payment', {
            status: 'failed',
            type: 'balance',
            survey_id: surveyId,
            message: validatedResponse.message || 'Payment failed'
        }));
    }

    // Already settled (duplicate callback) — nothing more to do.
    if (bill.status === 'settled') {
        return res.redirect(getRedirectUrl(req, 'payment', {
            status: 'success', type: 'balance', survey_id: surveyId
        }));
    }

    // Settle for the INVOICE amount, NOT SabPaisa's paidAmount. SabPaisa adds a
    // convenience fee on top of the bill amount (e.g. bill ₹18.42 + fee ₹10.15 =
    // ₹28.57 charged), and paidAmount is that fee-inclusive total. The fee is paid
    // to the gateway, not toward the invoice — crediting it would over-settle the
    // ledger by the fee and show a phantom credit. The gateway's SUCCESS means the
    // full bill amount was collected, so settle exactly balance_due.
    const billing = require('../../services/billing.service');
    const result = await billing.recordBillPayment(bill.id, {
        received: Number(bill.balance_due),
        method: 'sabpaisa',
        byAdminId: null
    });

    if (!result.ok) {
        // e.g. a concurrent settle already closed it — treat as success for redirect.
        console.error('SabPaisa bill settle failed:', bill.id, result.error);
    }

    console.log('SabPaisa bill balance settled:', {
        billId: bill.id, surveyId, fullySettled: result.ok ? result.fullySettled : null
    });

    return res.redirect(getRedirectUrl(req, 'payment', {
        status: 'success', type: 'balance', survey_id: surveyId
    }));
};

/**
 * Process successful payment
 */
const processSuccessfulPayment = async (payment, validatedResponse, rawResponse) => {
    const surveyId = payment.survey_id;

    // Update payment record
    await db.execute_query(
        `UPDATE payments SET 
            status = 'completed',
            gateway_transaction_id = ?,
            gateway_response = ?,
            paid_at = NOW(),
            updated_at = NOW()
         WHERE id = ?`,
        [
            validatedResponse.sabpaisaTxnId,
            JSON.stringify(rawResponse),
            payment.id
        ]
    );

    // v2 §4: record the advance on the assigner's ledger. Idempotent on
    // (advance_payment, payment.id), so a retried gateway callback cannot
    // credit the same money twice.
    try {
        const ledger = require('../../services/ledger.service');
        const surveyRow = await db.execute_single('SELECT laid FROM surveys WHERE id = ?', [surveyId]);
        // Credit the BASE advance, not the coupon-discounted cash amount. The
        // invoice credits base_amount as the advance, so the running account must
        // too or a coupon survey shows a phantom balance. base == cash when there
        // is no coupon.
        await ledger.postEntry({
            assignerId: payment.assigner_id,
            entryType: 'credit',
            amount: payment.base_amount ?? payment.final_amount,
            referenceType: 'advance_payment',
            referenceId: payment.id,
            surveyId,
            description: `Advance payment received${surveyRow?.laid ? ` — ${surveyRow.laid}` : ''}`
        });
    } catch (ledgerErr) {
        // A ledger failure must never break the payment callback — the gateway
        // would retry and the surveyor would be blocked from travelling.
        console.error('Ledger post failed for advance payment', payment.id, ledgerErr.message);
    }

    // Update coupon usage if applicable
    if (payment.coupon_id) {
        await db.execute_query(
            'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?',
            [payment.coupon_id]
        );
    }

    // Generate QR code for tracking
    const qrToken = generateQRToken();
    const qrCodeUrl = `${process.env.QR_TRACKING_BASE_URL || 'https://claimsmitra.com/track'}/${qrToken}`;

    // Update survey status to IN_TRANSIT
    await db.execute_query(
        `UPDATE surveys SET
            status = ?,
            qr_code_url = ?,
            qr_code_generated_at = NOW(),
            in_transit_at = NOW(),
            updated_at = NOW()
         WHERE id = ?`,
        [SURVEY_STATUS.IN_TRANSIT, qrCodeUrl, surveyId]
    );

    // Log status change
    await db.execute_query(
        `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
         VALUES (?, ?, ?, 'system', NULL, 'Payment completed via SabPaisa')`,
        [surveyId, SURVEY_STATUS.ASSIGNED, SURVEY_STATUS.IN_TRANSIT]
    );

    // Log transaction
    await db.execute_query(
        `INSERT INTO transaction_logs (reference_type, reference_id, event_type, event_description, amount, actor_type, actor_id, metadata)
         VALUES ('payment', ?, 'completed', 'Payment successful via SabPaisa', ?, 'gateway', NULL, ?)`,
        [
            payment.id,
            validatedResponse.paidAmount || payment.final_amount,
            JSON.stringify({
                sabpaisaTxnId: validatedResponse.sabpaisaTxnId,
                bankTxnId: validatedResponse.bankTxnId
            })
        ]
    );

    // Send notification to surveyor
    const surveyDetails = await db.execute_single(
        'SELECT surveyor_id, id, laid FROM surveys WHERE id = ?',
        [surveyId]
    );

    if (surveyDetails && surveyDetails.surveyor_id) {
        notificationHelper.notifySurveyorPaymentCompleted(
            surveyDetails.surveyor_id,
            surveyDetails
        ).catch(err => console.error('Payment notification error:', err));
    }

    console.log('SabPaisa Payment Success:', {
        paymentId: payment.id,
        surveyId,
        sabpaisaTxnId: validatedResponse.sabpaisaTxnId,
        amount: validatedResponse.paidAmount
    });
};

/**
 * Process failed payment
 */
const processFailedPayment = async (payment, validatedResponse, rawResponse) => {
    // Update payment record
    await db.execute_query(
        `UPDATE payments SET 
            status = 'failed',
            gateway_transaction_id = ?,
            gateway_response = ?,
            updated_at = NOW()
         WHERE id = ?`,
        [
            validatedResponse.sabpaisaTxnId || null,
            JSON.stringify(rawResponse),
            payment.id
        ]
    );

    // Log transaction
    await db.execute_query(
        `INSERT INTO transaction_logs (reference_type, reference_id, event_type, event_description, amount, actor_type, actor_id, metadata)
         VALUES ('payment', ?, 'failed', ?, ?, 'gateway', NULL, ?)`,
        [
            payment.id,
            validatedResponse.message || 'Payment failed',
            payment.final_amount,
            JSON.stringify({
                status: validatedResponse.status,
                statusCode: validatedResponse.statusCode,
                sabpaisaTxnId: validatedResponse.sabpaisaTxnId
            })
        ]
    );

    console.log('SabPaisa Payment Failed:', {
        paymentId: payment.id,
        status: validatedResponse.status,
        message: validatedResponse.message
    });
};

/**
 * Get payment status
 * GET /api/v1/public/payment/status/:clientTxnId
 */
const getPaymentStatus = async (req, res) => {
    try {
        const { clientTxnId } = req.params;

        const payment = await db.execute_single(
            `SELECT p.*, s.status as survey_status, s.laid
             FROM payments p
             JOIN surveys s ON p.survey_id = s.id
             WHERE p.gateway_order_id = ?`,
            [clientTxnId]
        );

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        return res.json({
            success: true,
            data: {
                payment_id: payment.id,
                survey_id: payment.survey_id,
                laid: payment.laid,
                status: payment.status,
                amount: payment.final_amount,
                paid_at: payment.paid_at,
                survey_status: payment.survey_status
            }
        });
    } catch (error) {
        console.error('Get Payment Status Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching payment status'
        });
    }
};

module.exports = {
    handleCallback,
    getPaymentStatus
};
