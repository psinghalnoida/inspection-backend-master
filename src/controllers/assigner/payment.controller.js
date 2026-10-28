/**
 * Assigner Payment Controller
 */

const db = require('../../config/database');
const { success, error, notFound, created } = require('../../utils/response');
const { calculateDistance, generateQRToken, parsePagination } = require('../../utils/helpers');
const { SURVEY_STATUS } = require('../../utils/constants');
const notificationHelper = require('../../services/notification.helper');
const sabpaisaService = require('../../services/sabpaisa.service');
const billing = require('../../services/billing.service');

/**
 * Find the ISSUED, unpaid invoice for one of the assigner's surveys.
 * @returns {Promise<Object|null>}
 */
const findPayableBill = (surveyId, assignerId) =>
  db.execute_single(
    `SELECT b.* FROM survey_bills b
       JOIN surveys s ON s.id = b.survey_id
      WHERE b.survey_id = ? AND s.assigner_id = ?
        AND b.status = 'issued' AND b.balance_due > 0`,
    [surveyId, assignerId]
  );

/**
 * Start a SabPaisa payment for the invoice balance. (v2 §4)
 * POST /api/v1/assigner/surveys/:id/pay-balance
 *
 * Mirrors the advance-payment flow: returns the encrypted SabPaisa payload the
 * browser POSTs to the hosted checkout. The money is settled server-side by the
 * shared SabPaisa callback when it reports SUCCESS — the client is never trusted.
 */
const payBalance = async (req, res, next) => {
  try {
    const bill = await findPayableBill(req.params.id, req.user.id);
    if (!bill) {
      return res.status(404).json(error('No unpaid invoice was found for this survey.'));
    }

    if (!sabpaisaService.isConfigured()) {
      return res.status(503).json(error('Online payment is not configured. Contact ClaimsMitra to pay this balance.'));
    }

    const survey = await db.execute_single(
      `SELECT s.laid, a.company_name, a.contact_person_name, a.phone, a.email
         FROM surveys s JOIN assigners a ON a.id = s.assigner_id
        WHERE s.id = ?`,
      [req.params.id]
    );

    // A fresh client txn id per attempt, stored on the bill so the callback can
    // reconcile the successful payment back to it.
    const clientTxnId = sabpaisaService.generateClientTxnId(bill.id);
    await db.execute_query(
      `UPDATE survey_bills SET sabpaisa_txn_id = ?, sabpaisa_payment_status = 'INITIATED', updated_at = NOW()
        WHERE id = ?`,
      [clientTxnId, bill.id]
    );

    const paymentData = {
      clientTxnId,
      amount: Number(bill.balance_due),
      payerName: survey?.company_name || survey?.contact_person_name || 'Assigner',
      payerEmail: survey?.email || 'billing@claimsmitra.com',
      payerMobile: survey?.phone || '9999999999',
      payerAddress: '',
      udf1: 'bill',                 // marks this as a bill-balance payment
      udf2: String(bill.id),        // bill id
      udf3: String(req.params.id),  // survey id
      udf4: survey?.laid || '',
      udf5: bill.invoice_number || ''
    };

    const { paymentUrl, encryptedData } = sabpaisaService.generatePaymentUrl(paymentData);

    res.json(success({
      client_txn_id: clientTxnId,
      amount: Number(bill.balance_due),
      invoice_number: bill.invoice_number,
      currency: 'INR',
      payment_url: paymentUrl,
      // For the POST form submission (same shape the advance flow uses).
      enc_data: encryptedData,
      client_code: process.env.SABPAISA_CLIENT_CODE,
      sp_url: process.env.SABPAISA_BASE_URL
    }, 'Balance payment initiated'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get the itemised bill for one of my surveys. (v2 §3)
 * GET /api/v1/assigner/surveys/:id/bill
 *
 * Draft bills are deliberately NOT exposed — an admin is still editing the
 * numbers, and showing a figure that then changes would be worse than showing
 * nothing. `bill: null` with a status hint is the answer until it is issued.
 */
const getSurveyBill = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      `SELECT id, laid, survey_type, status, is_direct_assign
         FROM surveys WHERE id = ? AND assigner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!survey) return res.status(404).json(notFound('Survey not found'));

    // v2 §3.6: direct-assign surveys are free — there is nothing to bill.
    if (survey.is_direct_assign) {
      return res.json(success({
        bill: null,
        billing_state: 'not_billable',
        message: 'No payment is charged for direct assignments.'
      }));
    }

    const bill = await db.execute_single(
      `SELECT * FROM survey_bills
        WHERE survey_id = ? AND status IN ('issued','settled')`,
      [req.params.id]
    );

    if (!bill) {
      return res.json(success({
        bill: null,
        billing_state: 'awaiting_bill',
        message: 'The final invoice for this survey has not been raised yet.'
      }));
    }

    // A NEGATIVE balance means the advance overshot the invoice: we owe them.
    // It must never be worded as an amount due.
    const balance = Number(bill.balance_due);

    res.json(success({
      bill,
      billing_state: balance > 0 ? 'balance_due' : 'settled',
      message: balance > 0
        ? `₹${balance.toFixed(2)} is due on invoice ${bill.invoice_number}.`
        : balance < 0
          ? `Invoice ${bill.invoice_number} is settled. ₹${Math.abs(balance).toFixed(2)} is a credit in your favour.`
          : `Invoice ${bill.invoice_number} is fully settled.`
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Calculate Price for Survey
 * POST /api/v1/assigner/surveys/:id/calculate-price
 */
const calculatePrice = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      `SELECT s.id, s.latitude, s.longitude, s.distance_from_assigner_km,
              a.latitude as assigner_lat, a.longitude as assigner_lng
       FROM surveys s
       JOIN assigners a ON s.assigner_id = a.id
       WHERE s.id = ? AND s.assigner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    if (!survey.latitude || !survey.longitude) {
      return res.status(400).json(error('Survey location not available'));
    }

    // Calculate distance
    let distanceKm = survey.distance_from_assigner_km;
    if (!distanceKm && survey.assigner_lat && survey.assigner_lng) {
      distanceKm = calculateDistance(
        survey.assigner_lat, survey.assigner_lng,
        survey.latitude, survey.longitude
      );

      // Update survey with distance
      await db.execute_query(
        'UPDATE surveys SET distance_from_assigner_km = ? WHERE id = ?',
        [distanceKm, survey.id]
      );
    }

    // Get pricing tier
    const tier = await db.execute_single(
      `SELECT * FROM pricing_tiers 
       WHERE is_active = TRUE AND min_distance_km <= ? 
       AND (max_distance_km IS NULL OR max_distance_km > ?)
       ORDER BY min_distance_km DESC LIMIT 1`,
      [distanceKm || 0, distanceKm || 0]
    );

    if (!tier) {
      return res.status(400).json(error('No pricing tier found'));
    }

    res.json(success({
      distance_km: Math.round(distanceKm * 100) / 100,
      tier_name: tier.tier_name,
      base_amount: tier.price_amount,
      final_amount: tier.price_amount
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Apply Coupon Code
 * POST /api/v1/assigner/surveys/:id/apply-coupon
 */
const applyCoupon = async (req, res, next) => {
  try {
    const { coupon_code } = req.body;

    if (!coupon_code) {
      return res.status(400).json(error('Coupon code is required'));
    }

    const survey = await db.execute_single(
      'SELECT id, distance_from_assigner_km FROM surveys WHERE id = ? AND assigner_id = ?',
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    // Find coupon
    const coupon = await db.execute_single(
      `SELECT * FROM coupons 
       WHERE code = ? AND is_active = TRUE 
       AND valid_from <= NOW() AND valid_until >= NOW()
       AND (usage_limit IS NULL OR usage_count < usage_limit)`,
      [coupon_code.toUpperCase()]
    );

    if (!coupon) {
      return res.status(400).json(error('Invalid or expired coupon code'));
    }

    // Get base amount from pricing tier
    const tier = await db.execute_single(
      `SELECT price_amount FROM pricing_tiers 
       WHERE is_active = TRUE AND min_distance_km <= ? 
       AND (max_distance_km IS NULL OR max_distance_km > ?)
       LIMIT 1`,
      [survey.distance_from_assigner_km || 0, survey.distance_from_assigner_km || 0]
    );

    const baseAmount = tier ? tier.price_amount : 2500;

    // Check minimum order amount
    if (baseAmount < coupon.min_order_amount) {
      return res.status(400).json(error(`Minimum order amount is ₹${coupon.min_order_amount}`));
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = (baseAmount * coupon.discount_value) / 100;
      if (coupon.max_discount_amount && discountAmount > coupon.max_discount_amount) {
        discountAmount = coupon.max_discount_amount;
      }
    } else {
      discountAmount = coupon.discount_value;
    }

    const finalAmount = baseAmount - discountAmount;

    res.json(success({
      coupon_code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      base_amount: baseAmount,
      discount_amount: discountAmount,
      final_amount: Math.max(0, finalAmount)
    }));
  } catch (err) {
    next(err);
  }
};

/**
 * Initiate Payment
 * POST /api/v1/assigner/surveys/:id/initiate-payment
 */
const initiatePayment = async (req, res, next) => {
  try {
    const { payment_method, coupon_code } = req.body;

    const survey = await db.execute_single(
      `SELECT s.*, p.id as existing_payment_id,
              a.company_name, a.contact_person_name, a.email, a.phone
       FROM surveys s
       LEFT JOIN payments p ON s.id = p.survey_id
       JOIN assigners a ON s.assigner_id = a.id
       WHERE s.id = ? AND s.assigner_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!survey) {
      return res.status(404).json(notFound('Survey not found'));
    }

    if (survey.status !== SURVEY_STATUS.ASSIGNED) {
      return res.status(400).json(error('Survey must be assigned before payment'));
    }

    // Check if survey has location
    if (!survey.latitude || !survey.longitude) {
      return res.status(400).json(error('Survey location not found. Please add survey location before payment.'));
    }

    // Check if payment already exists
    if (survey.existing_payment_id) {
      // Get existing payment status
      const existingPayment = await db.execute_single(
        'SELECT id, status, gateway_order_id FROM payments WHERE id = ?',
        [survey.existing_payment_id]
      );

      // If payment is completed, don't allow re-payment
      if (existingPayment && existingPayment.status === 'completed') {
        return res.status(400).json(error('Payment already completed for this survey'));
      }

      // If payment is pending/failed, delete it to allow retry
      if (existingPayment && (existingPayment.status === 'pending' || existingPayment.status === 'failed')) {
        console.log('Deleting existing pending/failed payment:', existingPayment.id);
        await db.execute_query('DELETE FROM payments WHERE id = ?', [existingPayment.id]);
      }
    }

    // Get pricing
    const tier = await db.execute_single(
      `SELECT price_amount FROM pricing_tiers 
       WHERE is_active = TRUE AND min_distance_km <= ? 
       AND (max_distance_km IS NULL OR max_distance_km > ?)
       LIMIT 1`,
      [survey.distance_from_assigner_km || 0, survey.distance_from_assigner_km || 0]
    );

    const baseAmount = tier ? tier.price_amount : 2500;
    let discountAmount = 0;
    let couponId = null;

    // Apply coupon if provided
    if (coupon_code) {
      const coupon = await db.execute_single(
        `SELECT * FROM coupons 
         WHERE code = ? AND is_active = TRUE 
         AND valid_from <= NOW() AND valid_until >= NOW()
         AND (usage_limit IS NULL OR usage_count < usage_limit)`,
        [coupon_code.toUpperCase()]
      );

      if (coupon) {
        couponId = coupon.id;
        if (coupon.discount_type === 'percentage') {
          discountAmount = (baseAmount * coupon.discount_value) / 100;
          if (coupon.max_discount_amount && discountAmount > coupon.max_discount_amount) {
            discountAmount = coupon.max_discount_amount;
          }
        } else {
          discountAmount = coupon.discount_value;
        }
      }
    }

    const finalAmount = Math.max(0, baseAmount - discountAmount);

    // Get commission from config
    const commissionConfig = await db.execute_single(
      "SELECT config_value FROM system_config WHERE config_key = 'platform_commission_percent'"
    );
    const commissionPercent = commissionConfig ? parseFloat(commissionConfig.config_value) : 25;

    const commissionAmount = (finalAmount * commissionPercent) / 100;
    const surveyorPayoutAmount = finalAmount - commissionAmount;

    // Create payment record
    const result = await db.execute_query(
      `INSERT INTO payments (
        survey_id, assigner_id, distance_km, base_amount,
        coupon_id, coupon_code, discount_amount, final_amount,
        platform_commission_percent, platform_commission_amount,
        surveyor_payout_amount, payment_method, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        survey.id, req.user.id, survey.distance_from_assigner_km || 0, baseAmount,
        couponId, coupon_code || null, discountAmount, finalAmount,
        commissionPercent, commissionAmount,
        surveyorPayoutAmount, payment_method || null
      ]
    );

    const paymentId = result.insertId;

    // Log transaction
    await db.execute_query(
      `INSERT INTO transaction_logs (reference_type, reference_id, event_type, event_description, amount, actor_type, actor_id)
       VALUES ('payment', ?, 'initiated', 'Payment order created', ?, 'assigner', ?)`,
      [paymentId, finalAmount, req.user.id]
    );

    // Edge Case: If final amount is ₹0 (due to coupon), skip payment gateway and mark as completed
    if (finalAmount === 0) {
      // Update payment status to completed
      await db.execute_query(
        `UPDATE payments SET 
          status = 'completed',
          gateway_transaction_id = 'COUPON_FREE',
          gateway_order_id = 'COUPON_FREE',
          paid_at = NOW(),
          updated_at = NOW()
         WHERE id = ?`,
        [paymentId]
      );

      // Update coupon usage
      if (couponId) {
        await db.execute_query(
          'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?',
          [couponId]
        );
      }

      // v2 §4: credit the BASE advance to the ledger even though ₹0 cash changed
      // hands — the coupon covered it. The final invoice credits base_amount as
      // the advance, so without this the running account would show a phantom
      // debt for a survey the coupon paid for. Idempotent on (advance_payment, id).
      try {
        const ledger = require('../../services/ledger.service');
        await ledger.postEntry({
          assignerId: req.user.id,
          entryType: 'credit',
          amount: baseAmount,
          referenceType: 'advance_payment',
          referenceId: paymentId,
          surveyId: survey.id,
          description: `Advance covered by coupon${coupon_code ? ` ${coupon_code}` : ''}${survey.laid ? ` — ${survey.laid}` : ''}`
        });
      } catch (ledgerErr) {
        console.error('Ledger post failed for coupon advance', paymentId, ledgerErr.message);
      }

      // Generate QR code
      const qrToken = generateQRToken();
      const qrCodeUrl = `${process.env.QR_TRACKING_BASE_URL}/${qrToken}`;

      // Update survey status to IN_TRANSIT
      await db.execute_query(
        `UPDATE surveys SET
          status = ?,
          qr_code_url = ?,
          qr_code_generated_at = NOW(),
          in_transit_at = NOW(),
          updated_at = NOW()
         WHERE id = ?`,
        [SURVEY_STATUS.IN_TRANSIT, qrCodeUrl, survey.id]
      );

      // Log status change
      await db.execute_query(
        `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
         VALUES (?, ?, ?, 'system', NULL, 'Payment completed (100% coupon discount), survey started')`,
        [survey.id, SURVEY_STATUS.ASSIGNED, SURVEY_STATUS.IN_TRANSIT]
      );

      // Log transaction
      await db.execute_query(
        `INSERT INTO transaction_logs (reference_type, reference_id, event_type, event_description, amount, actor_type, actor_id)
         VALUES ('payment', ?, 'completed', 'Payment completed (100% coupon discount)', ?, 'assigner', ?)`,
        [paymentId, finalAmount, req.user.id]
      );

      // Send notification to surveyor to start
      const surveyDetails = await db.execute_single(
        'SELECT surveyor_id, id, laid FROM surveys WHERE id = ?',
        [survey.id]
      );

      if (surveyDetails && surveyDetails.surveyor_id) {
        await notificationHelper.notifySurveyorPaymentCompleted(
          surveyDetails.surveyor_id,
          surveyDetails
        );
      }

      return res.json(success({
        payment_id: paymentId,
        base_amount: baseAmount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        currency: 'INR',
        status: 'completed',
        message: 'Payment completed with 100% coupon discount'
      }, 'Payment completed successfully'));
    }

    // Generate SabPaisa payment URL
    const sabpaisaService = require('../../services/sabpaisa.service');

    if (!sabpaisaService.isConfigured()) {
      console.warn('SabPaisa not configured, returning mock payment data');
      return res.json(success({
        payment_id: paymentId,
        base_amount: baseAmount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        currency: 'INR',
        order_id: `ORDER_${paymentId}_${Date.now()}`,
        mock: true // Indicates mock mode
      }, 'Payment order created (mock mode)'));
    }

    // Generate client transaction ID
    const clientTxnId = sabpaisaService.generateClientTxnId(paymentId);

    // Update payment record with clientTxnId
    await db.execute_query(
      'UPDATE payments SET gateway_order_id = ? WHERE id = ?',
      [clientTxnId, paymentId]
    );

    // Build payment data
    const paymentData = {
      clientTxnId,
      amount: finalAmount,
      payerName: survey.contact_person_name || survey.company_name || 'Customer',
      payerEmail: survey.email || 'customer@claimsmitra.com',
      payerMobile: survey.phone || '9999999999',
      payerAddress: '',
      udf1: survey.id.toString(),     // Survey ID
      udf2: paymentId.toString(),     // Payment ID
      udf3: req.user.id.toString(),   // Assigner ID
      udf4: survey.laid || '',        // LAID
      udf5: ''
    };

    // Generate payment URL and encrypted data
    const { paymentUrl, encryptedData } = sabpaisaService.generatePaymentUrl(paymentData);

    res.json(success({
      payment_id: paymentId,
      client_txn_id: clientTxnId,
      base_amount: baseAmount,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      currency: 'INR',
      payment_url: paymentUrl,
      // For POST form submission (required by SabPaisa)
      enc_data: encryptedData,
      client_code: process.env.SABPAISA_CLIENT_CODE,
      sp_url: process.env.SABPAISA_BASE_URL
    }, 'Payment initiated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Verify Payment (Callback from gateway)
 * POST /api/v1/assigner/surveys/:id/verify-payment
 */
const verifyPayment = async (req, res, next) => {
  try {
    const { payment_id, gateway_transaction_id, gateway_order_id, gateway_response } = req.body;

    // Scope by assigner_id so a user can't verify someone else's payment.
    const payment = await db.execute_single(
      `SELECT p.*, s.status as survey_status, s.qr_code_url as existing_qr
         FROM payments p
         JOIN surveys s ON s.id = p.survey_id
        WHERE p.survey_id = ? AND p.id = ? AND s.assigner_id = ?`,
      [req.params.id, payment_id, req.user.id]
    );

    if (!payment) {
      return res.status(404).json(notFound('Payment not found'));
    }

    // Idempotency: if the SabPaisa server callback already processed this payment,
    // just return the current state. Calling this twice (mobile WebView fallback +
    // server callback) must not double-credit coupons or duplicate logs.
    if (payment.status === 'completed') {
      return res.json(success({
        payment_id,
        status: 'completed',
        qr_code_url: payment.existing_qr,
        survey_status: payment.survey_status
      }, 'Payment already verified'));
    }

    // Mark payment completed
    await db.execute_query(
      `UPDATE payments SET
        status = 'completed',
        gateway_transaction_id = COALESCE(?, gateway_transaction_id),
        gateway_order_id = COALESCE(?, gateway_order_id),
        gateway_response = ?,
        paid_at = NOW(),
        updated_at = NOW()
       WHERE id = ? AND status <> 'completed'`,
      [gateway_transaction_id || null, gateway_order_id || null, JSON.stringify(gateway_response || {}), payment_id]
    );

    // Update coupon usage
    if (payment.coupon_id) {
      await db.execute_query(
        'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?',
        [payment.coupon_id]
      );
    }

    // Generate QR code
    const qrToken = generateQRToken();
    const qrCodeUrl = `${process.env.QR_TRACKING_BASE_URL}/${qrToken}`;

    // Move survey to IN_TRANSIT only if it's still in ASSIGNED — guards against
    // a stale verify call after the survey has already progressed further.
    await db.execute_query(
      `UPDATE surveys SET
        status = ?,
        qr_code_url = ?,
        qr_code_generated_at = NOW(),
        in_transit_at = NOW(),
        updated_at = NOW()
       WHERE id = ? AND status = ?`,
      [SURVEY_STATUS.IN_TRANSIT, qrCodeUrl, req.params.id, SURVEY_STATUS.ASSIGNED]
    );

    // Log status change
    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, ?, ?, 'system', NULL, 'Payment completed, survey started')`,
      [req.params.id, SURVEY_STATUS.ASSIGNED, SURVEY_STATUS.IN_TRANSIT]
    );

    // Log transaction
    await db.execute_query(
      `INSERT INTO transaction_logs (reference_type, reference_id, event_type, event_description, amount, actor_type, actor_id, metadata)
       VALUES ('payment', ?, 'completed', 'Payment successful', ?, 'gateway', NULL, ?)`,
      [payment_id, payment.final_amount, JSON.stringify({ gateway_transaction_id })]
    );

    // Send notification to surveyor to start
    const surveyDetails = await db.execute_single(
      'SELECT surveyor_id, id, laid FROM surveys WHERE id = ?',
      [req.params.id]
    );

    if (surveyDetails && surveyDetails.surveyor_id) {
      notificationHelper.notifySurveyorPaymentCompleted(
        surveyDetails.surveyor_id,
        surveyDetails
      ).catch(err => console.error('Notification error:', err));
    }

    res.json(success({
      payment_id,
      status: 'completed',
      qr_code_url: qrCodeUrl,
      survey_status: SURVEY_STATUS.IN_TRANSIT
    }, 'Payment verified successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Payment History
 * GET /api/v1/assigner/payments
 */
const getPaymentHistory = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const [payments, countResult] = await Promise.all([
      db.query_rows(
        `SELECT p.*, s.laid, s.case_reference
         FROM payments p
         JOIN surveys s ON p.survey_id = s.id
         WHERE p.assigner_id = ?
         ORDER BY p.created_at DESC
         LIMIT ? OFFSET ?`,
        [req.user.id, limit, offset]
      ),
      db.query_single(
        'SELECT COUNT(*) as total FROM payments WHERE assigner_id = ?',
        [req.user.id]
      )
    ]);

    res.json(success({
      payments,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit)
      }
    }));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  calculatePrice,
  applyCoupon,
  initiatePayment,
  verifyPayment,
  getPaymentHistory,
  getSurveyBill,
  payBalance
};
