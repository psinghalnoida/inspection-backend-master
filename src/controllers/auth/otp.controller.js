/**
 * OTP Controller
 * Handles phone verification via OTP
 */

const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const smsService = require('../../services/sms.service');
const { success, error } = require('../../utils/response');

/**
 * Generate 6-digit OTP
 */
const generateOTP = () => {
    return String(Math.floor(100000 + Math.random() * 900000));
};

/**
 * Send OTP
 * POST /api/v1/auth/send-otp
 */
const sendOTP = async (req, res, next) => {
    try {
        const { phone, purpose = 'registration' } = req.body;

        if (!phone || phone.length !== 10) {
            return res.status(400).json(error('Valid 10-digit phone number is required'));
        }

        // Check if phone already registered (for registration purpose)
        if (purpose === 'registration') {
            const existingSurveyor = await db.execute_single(
                'SELECT id FROM surveyors WHERE phone = ?',
                [phone]
            );
            if (existingSurveyor) {
                return res.status(400).json(error('Phone number is already registered'));
            }
        }

        // Generate OTP
        const otp = generateOTP();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Delete any existing OTPs for this phone and purpose
        await db.execute_query(
            'DELETE FROM phone_otp_verifications WHERE phone = ? AND purpose = ?',
            [phone, purpose]
        );

        // Store OTP
        await db.execute_query(
            `INSERT INTO phone_otp_verifications (phone, otp_hash, purpose, expires_at)
             VALUES (?, ?, ?, ?)`,
            [phone, otpHash, purpose, expiresAt]
        );

        // Send OTP via SMS
        console.log(`📱 OTP generated for ${phone}: ${otp}`); // Log before sending (for dev)

        try {
            await smsService.sendOTP(phone, otp);
            console.log(`✅ SMS sent to ${phone}`);
        } catch (smsError) {
            console.error('⚠️ SMS Delivery Failed (Check DLT Template):', smsError.message);
            // Continue anyway for development
        }

        res.json(success({
            phone,
            expires_in: 600 // 10 minutes in seconds
        }, 'OTP sent successfully'));

    } catch (err) {
        next(err);
    }
};

/**
 * Verify OTP
 * POST /api/v1/auth/verify-otp
 */
const verifyOTP = async (req, res, next) => {
    try {
        const { phone, otp, purpose = 'registration' } = req.body;

        if (!phone || !otp) {
            return res.status(400).json(error('Phone and OTP are required'));
        }

        // Get the OTP record
        const otpRecord = await db.execute_single(
            `SELECT * FROM phone_otp_verifications 
             WHERE phone = ? AND purpose = ? AND verified_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [phone, purpose]
        );

        if (!otpRecord) {
            return res.status(400).json(error('No OTP found. Please request a new one.'));
        }

        // Check if expired
        if (new Date() > new Date(otpRecord.expires_at)) {
            await db.execute_query('DELETE FROM phone_otp_verifications WHERE id = ?', [otpRecord.id]);
            return res.status(400).json(error('OTP has expired. Please request a new one.'));
        }

        // Check max attempts
        if (otpRecord.attempts >= otpRecord.max_attempts) {
            await db.execute_query('DELETE FROM phone_otp_verifications WHERE id = ?', [otpRecord.id]);
            return res.status(400).json(error('Too many failed attempts. Please request a new OTP.'));
        }

        // Verify OTP
        const isValid = await bcrypt.compare(otp, otpRecord.otp_hash);

        if (!isValid) {
            // Increment attempts
            await db.execute_query(
                'UPDATE phone_otp_verifications SET attempts = attempts + 1 WHERE id = ?',
                [otpRecord.id]
            );
            const remainingAttempts = otpRecord.max_attempts - otpRecord.attempts - 1;
            return res.status(400).json(error(`Invalid OTP. ${remainingAttempts} attempts remaining.`));
        }

        // Mark as verified
        await db.execute_query(
            'UPDATE phone_otp_verifications SET verified_at = NOW() WHERE id = ?',
            [otpRecord.id]
        );

        // Generate verification token (valid for 30 minutes)
        const crypto = require('crypto');
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // Store verification token (reuse the same record)
        await db.execute_query(
            `UPDATE phone_otp_verifications 
             SET otp_hash = ?, expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
             WHERE id = ?`,
            [verificationToken, otpRecord.id]
        );

        res.json(success({
            phone,
            verified: true,
            verification_token: verificationToken,
            expires_in: 1800 // 30 minutes
        }, 'Phone verified successfully'));

    } catch (err) {
        next(err);
    }
};

/**
 * Check if phone is verified (internal helper)
 */
const isPhoneVerified = async (phone, verificationToken) => {
    const record = await db.execute_single(
        `SELECT * FROM phone_otp_verifications 
         WHERE phone = ? AND otp_hash = ? AND verified_at IS NOT NULL
         AND expires_at > NOW()`,
        [phone, verificationToken]
    );
    return !!record;
};

module.exports = {
    sendOTP,
    verifyOTP,
    isPhoneVerified
};
