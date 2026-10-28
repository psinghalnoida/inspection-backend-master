/**
 * Surveyor Authentication Controller
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../middleware/auth');
const { success, error, unauthorized, forbidden, created } = require('../../utils/response');
const { USER_ROLES, VERIFICATION_STATUS } = require('../../utils/constants');
const { sendPasswordResetEmail } = require('../../config/email');

/**
 * Surveyor Registration (Self-registration)
 * POST /api/v1/auth/surveyor/register
 * Supports: multipart/form-data with KYC documents
 * Note: PIN is set separately after first login (industry standard)
 */
const register = async (req, res, next) => {
  try {
    const {
      full_name,
      email,
      phone,
      password,
      business_address,
      city,
      state,
      pincode,
      surveyor_license_id
    } = req.body;

    // Validate required fields (PIN not required - set after login)
    if (!full_name || !email || !phone || !password) {
      return res.status(400).json(error('All required fields must be provided'));
    }

    // Check if phone or email already exists
    const existing = await db.execute_single(
      'SELECT id FROM surveyors WHERE phone = ? OR email = ?',
      [phone, email]
    );

    if (existing) {
      return res.status(400).json(error('Phone or email already registered'));
    }

    // Verify phone using token
    const { verification_token } = req.body;
    const otpController = require('./otp.controller');

    // Skip verification check if in development mode with specific flag (optional)
    // But for production flow we enforce it
    if (!verification_token) {
      return res.status(400).json(error('Phone verification is required. Please verify your phone number first.'));
    }

    const isVerified = await otpController.isPhoneVerified(phone, verification_token);
    if (!isVerified) {
      return res.status(400).json(error('Invalid or expired verification token. Please verify your phone again.'));
    }

    // Hash password only (PIN set later via separate API)
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Handle profile picture if provided
    const files = req.files || {};
    let profilePictureUrl = null;

    if (files.profile_picture && files.profile_picture[0]) {
      const file = files.profile_picture[0];
      profilePictureUrl = `/uploads/profiles/${file.filename}`;
    }

    // Insert surveyor (pin_hash is NULL - will be set after first login)
    const result = await db.execute_query(
      `INSERT INTO surveyors (
        full_name, email, phone, password_hash,
        business_address, city, state, pincode, surveyor_license_id,
        profile_picture_url, verification_status, is_active, is_available
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, FALSE)`,
      [
        full_name, email, phone, password_hash,
        business_address || null, city || null, state || null, pincode || null,
        surveyor_license_id || null, profilePictureUrl, VERIFICATION_STATUS.PENDING
      ]
    );

    const surveyorId = result.insertId;

    // Handle KYC document uploads if provided
    const uploadedDocs = [];

    const processDocument = async (fieldName, docType) => {
      if (files[fieldName] && files[fieldName][0]) {
        const file = files[fieldName][0];
        const fileUrl = `/uploads/documents/${file.filename}`;
        const fileExt = file.originalname.split('.').pop().toLowerCase();

        await db.execute_query(
          `INSERT INTO surveyor_documents 
           (surveyor_id, document_type, document_name, file_url, file_type, file_size_bytes)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [surveyorId, docType, file.originalname, fileUrl, fileExt, file.size]
        );

        uploadedDocs.push({
          type: docType,
          name: file.originalname,
          url: fileUrl
        });
      }
    };

    // Process each document type
    await processDocument('government_id', 'government_id');
    await processDocument('proof_of_address', 'proof_of_address');
    await processDocument('surveyor_license', 'surveyor_license');

    res.status(201).json(created({
      id: surveyorId,
      profile_picture_url: profilePictureUrl,
      documents_uploaded: uploadedDocs.length,
      documents: uploadedDocs,
      message: 'Registration successful. Please wait for admin verification.'
    }, 'Surveyor registered successfully'));

  } catch (err) {
    next(err);
  }
};

/**
 * Surveyor Login (Phone/Email + Password)
 * POST /api/v1/auth/surveyor/login
 */
const login = async (req, res, next) => {
  try {
    const { phone, email, password } = req.body;

    if ((!phone && !email) || !password) {
      return res.status(400).json(error('Phone/Email and password are required'));
    }

    // Find surveyor
    let query = 'SELECT * FROM surveyors WHERE ';
    let params = [];

    if (phone) {
      query += 'phone = ?';
      params.push(phone);
    } else {
      query += 'email = ?';
      params.push(email);
    }

    const surveyor = await db.execute_single(query, params);

    if (!surveyor) {
      return res.status(401).json(unauthorized('Invalid credentials'));
    }

    // Check verification status
    if (surveyor.verification_status !== VERIFICATION_STATUS.VERIFIED) {
      return res.status(403).json(forbidden(`Account verification ${surveyor.verification_status}. Please wait for admin approval.`));
    }

    if (!surveyor.is_active) {
      return res.status(403).json(forbidden('Account is deactivated. Please contact admin.'));
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, surveyor.password_hash);
    if (!isMatch) {
      return res.status(401).json(unauthorized('Invalid credentials'));
    }

    // Update last login
    await db.execute_query(
      'UPDATE surveyors SET last_login_at = NOW() WHERE id = ?',
      [surveyor.id]
    );

    // Generate tokens
    const accessToken = generateAccessToken(surveyor, USER_ROLES.SURVEYOR);
    const refreshToken = generateRefreshToken(surveyor, USER_ROLES.SURVEYOR);

    res.json(success({
      user: {
        id: surveyor.id,
        full_name: surveyor.full_name,
        email: surveyor.email,
        phone: surveyor.phone,
        profile_picture_url: surveyor.profile_picture_url,
        is_available: surveyor.is_available,
        verification_status: surveyor.verification_status
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    }, 'Login successful'));

  } catch (err) {
    next(err);
  }
};

/**
 * Surveyor Quick Login (4-digit PIN)
 * POST /api/v1/auth/surveyor/login-pin
 */
const loginWithPIN = async (req, res, next) => {
  try {
    const { phone, pin } = req.body;

    if (!phone || !pin) {
      return res.status(400).json(error('Phone and PIN are required'));
    }

    const surveyor = await db.execute_single(
      'SELECT * FROM surveyors WHERE phone = ?',
      [phone]
    );

    if (!surveyor) {
      return res.status(401).json(unauthorized('Invalid credentials'));
    }

    if (surveyor.verification_status !== VERIFICATION_STATUS.VERIFIED) {
      return res.status(403).json(forbidden('Account not verified'));
    }

    if (!surveyor.is_active) {
      return res.status(403).json(forbidden('Account is deactivated'));
    }

    // Check if PIN is set
    if (!surveyor.pin_hash) {
      return res.status(400).json(error('MPIN not set. Please login with password and set your MPIN first.'));
    }

    // Verify PIN
    const isMatch = await bcrypt.compare(pin, surveyor.pin_hash);
    if (!isMatch) {
      return res.status(401).json(unauthorized('Invalid PIN'));
    }

    // Update last login
    await db.execute_query(
      'UPDATE surveyors SET last_login_at = NOW() WHERE id = ?',
      [surveyor.id]
    );

    // Generate tokens
    const accessToken = generateAccessToken(surveyor, USER_ROLES.SURVEYOR);
    const refreshToken = generateRefreshToken(surveyor, USER_ROLES.SURVEYOR);

    res.json(success({
      user: {
        id: surveyor.id,
        full_name: surveyor.full_name,
        email: surveyor.email,
        phone: surveyor.phone,
        profile_picture_url: surveyor.profile_picture_url,
        is_available: surveyor.is_available
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    }, 'Login successful'));

  } catch (err) {
    next(err);
  }
};

/**
 * Refresh Token
 * POST /api/v1/auth/surveyor/refresh-token
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json(error('Refresh token is required'));
    }

    const decoded = verifyRefreshToken(refresh_token);

    if (decoded.role !== USER_ROLES.SURVEYOR) {
      return res.status(401).json(unauthorized('Invalid token'));
    }

    const surveyor = await db.execute_single(
      'SELECT * FROM surveyors WHERE id = ? AND is_active = TRUE',
      [decoded.id]
    );

    if (!surveyor) {
      return res.status(401).json(unauthorized('User not found'));
    }

    const accessToken = generateAccessToken(surveyor, USER_ROLES.SURVEYOR);
    const newRefreshToken = generateRefreshToken(surveyor, USER_ROLES.SURVEYOR);

    res.json(success({
      tokens: {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    }, 'Token refreshed'));

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(unauthorized('Refresh token expired'));
    }
    next(err);
  }
};

/**
 * Logout
 * POST /api/v1/auth/surveyor/logout
 */
const logout = async (req, res, next) => {
  try {
    res.json(success(null, 'Logged out successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Account (Soft Delete)
 * POST /api/v1/auth/surveyor/delete-account
 * Requires: Authentication + Password confirmation
 */
const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;
    const surveyorId = req.user.id;

    if (!password) {
      return res.status(400).json(error('Password is required to delete account'));
    }

    // Get surveyor details
    const surveyor = await db.execute_single(
      'SELECT id, password_hash FROM surveyors WHERE id = ? AND is_active = TRUE',
      [surveyorId]
    );

    if (!surveyor) {
      return res.status(404).json(error('Account not found'));
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, surveyor.password_hash);
    if (!isMatch) {
      return res.status(401).json(unauthorized('Incorrect password'));
    }

    // Soft delete - deactivate the account
    await db.execute_query(
      'UPDATE surveyors SET is_active = FALSE, is_available = FALSE WHERE id = ?',
      [surveyorId]
    );

    res.json(success(null, 'Account deleted successfully'));

  } catch (err) {
    next(err);
  }
};

/**
 * Forgot Password
 * POST /api/v1/auth/surveyor/forgot-password
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    console.log("email", email)

    if (!email) {
      return res.status(400).json(error('Email is required'));
    }



    const surveyor = await db.execute_single(
      'SELECT id, email, full_name FROM surveyors WHERE email = ?',
      [email]
    );

    console.log("surveyor", surveyor)
    // Return 404 if email not found
    if (!surveyor) {
      return res.status(404).json(notFound('No account found with this email address'));
    }


    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Delete any existing tokens for this user
    await db.execute_query(
      'DELETE FROM password_reset_tokens WHERE user_type = ? AND user_id = ?',
      ['surveyor', surveyor.id]
    );
    console.log("1")

    // Store new token
    await db.execute_query(
      `INSERT INTO password_reset_tokens (user_type, user_id, token, expires_at) 
       VALUES (?, ?, ?, ?)`,
      ['surveyor', surveyor.id, resetToken, expiresAt]
    );
    console.log("2")


    // Generate reset link
    const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetLink = `${baseUrl}/api/v1/public/reset-password/${resetToken}`;
    console.log("3")
    // Send email
    try {
      console.log("4")
      await sendPasswordResetEmail(surveyor.email, resetLink, surveyor.full_name);
      console.log("5")
      console.log(`✅ Password reset email sent to ${surveyor.email}`);
    } catch (emailErr) {
      console.error('❌ Failed to send email:', emailErr.message);
    }

    // Return token for mobile apps
    res.json(success({
      reset_token: resetToken,
      expires_in: '1 hour',
      reset_url: resetLink
    }, 'Password reset link generated. Check your email or use the token directly.'));

  } catch (err) {
    next(err);
  }
};

/**
 * Reset Password (API endpoint)
 * POST /api/v1/auth/surveyor/reset-password
 */
const resetPassword = async (req, res, next) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json(error('Token and new password are required'));
    }

    if (new_password.length < 6) {
      return res.status(400).json(error('Password must be at least 6 characters'));
    }

    // Find valid token
    const tokenRecord = await db.execute_single(
      `SELECT * FROM password_reset_tokens 
       WHERE token = ? AND user_type = 'surveyor' AND used_at IS NULL AND expires_at > NOW()`,
      [token]
    );

    if (!tokenRecord) {
      return res.status(400).json(error('Invalid or expired reset token'));
    }

    // Hash new password
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const password_hash = await bcrypt.hash(new_password, saltRounds);

    // Update password
    await db.execute_query(
      'UPDATE surveyors SET password_hash = ? WHERE id = ?',
      [password_hash, tokenRecord.user_id]
    );

    // Mark token as used
    await db.execute_query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
      [tokenRecord.id]
    );

    res.json(success(null, 'Password reset successful'));

  } catch (err) {
    next(err);
  }
};

/**
 * Set MPIN (After First Login)
 * POST /api/v1/surveyor/set-pin
 * Requires: Authentication
 */
const setMPIN = async (req, res, next) => {
  try {
    const { pin, confirm_pin } = req.body;
    const surveyorId = req.user.id;

    // Validate PIN format
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json(error('PIN must be exactly 4 digits'));
    }

    // Validate confirmation
    if (pin !== confirm_pin) {
      return res.status(400).json(error('PIN and confirmation do not match'));
    }

    // Check if surveyor exists
    const surveyor = await db.execute_single(
      'SELECT id, pin_hash FROM surveyors WHERE id = ?',
      [surveyorId]
    );

    if (!surveyor) {
      return res.status(404).json(error('Surveyor not found'));
    }

    // Hash the PIN
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const pin_hash = await bcrypt.hash(pin, saltRounds);

    // Update PIN
    await db.execute_query(
      'UPDATE surveyors SET pin_hash = ? WHERE id = ?',
      [pin_hash, surveyorId]
    );

    res.json(success({
      message: 'MPIN set successfully. You can now use quick login.',
      has_pin: true
    }, 'MPIN set successfully'));

  } catch (err) {
    next(err);
  }
};

/**
 * Change MPIN (When already set)
 * POST /api/v1/surveyor/change-pin
 * Requires: Authentication + Current PIN
 */
const changeMPIN = async (req, res, next) => {
  try {
    const { current_pin, new_pin, confirm_pin } = req.body;
    const surveyorId = req.user.id;

    // Validate new PIN format
    if (!new_pin || new_pin.length !== 4 || !/^\d{4}$/.test(new_pin)) {
      return res.status(400).json(error('New PIN must be exactly 4 digits'));
    }

    // Validate confirmation
    if (new_pin !== confirm_pin) {
      return res.status(400).json(error('New PIN and confirmation do not match'));
    }

    // Get surveyor with current PIN
    const surveyor = await db.execute_single(
      'SELECT id, pin_hash FROM surveyors WHERE id = ?',
      [surveyorId]
    );

    if (!surveyor) {
      return res.status(404).json(error('Surveyor not found'));
    }

    if (!surveyor.pin_hash) {
      return res.status(400).json(error('No PIN set. Use set-pin endpoint first.'));
    }

    // Verify current PIN
    const isMatch = await bcrypt.compare(current_pin, surveyor.pin_hash);
    if (!isMatch) {
      return res.status(401).json(error('Current PIN is incorrect'));
    }

    // Hash new PIN
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const pin_hash = await bcrypt.hash(new_pin, saltRounds);

    // Update PIN
    await db.execute_query(
      'UPDATE surveyors SET pin_hash = ? WHERE id = ?',
      [pin_hash, surveyorId]
    );

    res.json(success(null, 'MPIN changed successfully'));

  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login,
  loginWithPIN,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  setMPIN,
  changeMPIN,
  deleteAccount
};

