/**
 * Assigner Authentication Controller
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../middleware/auth');
const { success, error, unauthorized, forbidden } = require('../../utils/response');
const { USER_ROLES } = require('../../utils/constants');
const { sendPasswordResetEmail } = require('../../config/email');

/**
 * Assigner Login
 * POST /api/v1/auth/assigner/login
 */
const login = async (req, res, next) => {
  try {
    const { phone, email, password } = req.body;

    if ((!phone && !email) || !password) {
      return res.status(400).json(error('Phone/Email and password are required'));
    }

    // Find assigner by phone or email
    let query = 'SELECT * FROM assigners WHERE ';
    let params = [];

    if (phone) {
      query += 'phone = ?';
      params.push(phone);
    } else {
      query += 'email = ?';
      params.push(email);
    }

    const assigner = await db.execute_single(query, params);

    if (!assigner) {
      return res.status(401).json(unauthorized('Invalid credentials'));
    }

    if (!assigner.is_active) {
      return res.status(403).json(forbidden('Account is not activated. Please contact admin.'));
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, assigner.password_hash);
    if (!isMatch) {
      return res.status(401).json(unauthorized('Invalid credentials'));
    }

    // Update last login
    await db.execute_query(
      'UPDATE assigners SET last_login_at = NOW() WHERE id = ?',
      [assigner.id]
    );

    // Generate tokens
    const accessToken = generateAccessToken(assigner, USER_ROLES.ASSIGNER);
    const refreshToken = generateRefreshToken(assigner, USER_ROLES.ASSIGNER);

    res.json(success({
      user: {
        id: assigner.id,
        phone: assigner.phone,
        email: assigner.email,
        company_name: assigner.company_name,
        contact_person_name: assigner.contact_person_name,
        profile_picture_url: assigner.profile_picture_url,
        is_direct_assign: assigner.is_direct_assign !== false
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
 * POST /api/v1/auth/assigner/refresh-token
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json(error('Refresh token is required'));
    }

    const decoded = verifyRefreshToken(refresh_token);

    if (decoded.role !== USER_ROLES.ASSIGNER) {
      return res.status(401).json(unauthorized('Invalid token'));
    }

    const assigner = await db.execute_single(
      'SELECT * FROM assigners WHERE id = ? AND is_active = TRUE',
      [decoded.id]
    );

    if (!assigner) {
      return res.status(401).json(unauthorized('User not found'));
    }

    const accessToken = generateAccessToken(assigner, USER_ROLES.ASSIGNER);
    const newRefreshToken = generateRefreshToken(assigner, USER_ROLES.ASSIGNER);

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
 * POST /api/v1/auth/assigner/logout
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
 * POST /api/v1/auth/assigner/delete-account
 * Requires: Authentication + Password confirmation
 */
const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;
    const assignerId = req.user.id;

    if (!password) {
      return res.status(400).json(error('Password is required to delete account'));
    }

    // Get assigner details
    const assigner = await db.execute_single(
      'SELECT id, password_hash FROM assigners WHERE id = ? AND is_active = TRUE',
      [assignerId]
    );

    if (!assigner) {
      return res.status(404).json(error('Account not found'));
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, assigner.password_hash);
    if (!isMatch) {
      return res.status(401).json(unauthorized('Incorrect password'));
    }

    // Soft delete - deactivate the account
    await db.execute_query(
      'UPDATE assigners SET is_active = FALSE WHERE id = ?',
      [assignerId]
    );

    res.json(success(null, 'Account deleted successfully'));

  } catch (err) {
    next(err);
  }
};

/**
 * Forgot Password
 * POST /api/v1/auth/assigner/forgot-password
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(error('Email is required'));
    }

    const assigner = await db.execute_single(
      'SELECT id, email, contact_person_name FROM assigners WHERE email = ?',
      [email]
    );

    // Return 404 if email not found
    if (!assigner) {
      return res.status(404).json(notFound('No account found with this email address'));
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Delete any existing tokens for this user
    await db.execute_query(
      'DELETE FROM password_reset_tokens WHERE user_type = ? AND user_id = ?',
      ['assigner', assigner.id]
    );

    // Store new token
    await db.execute_query(
      `INSERT INTO password_reset_tokens (user_type, user_id, token, expires_at) 
       VALUES (?, ?, ?, ?)`,
      ['assigner', assigner.id, resetToken, expiresAt]
    );

    // Generate reset link
    const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetLink = `${baseUrl}/api/v1/public/reset-password/${resetToken}`;

    // Send email
    try {
      await sendPasswordResetEmail(assigner.email, resetLink, assigner.contact_person_name);
      console.log(`✅ Password reset email sent to ${assigner.email}`);
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
 * POST /api/v1/auth/assigner/reset-password
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
       WHERE token = ? AND user_type = 'assigner' AND used_at IS NULL AND expires_at > NOW()`,
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
      'UPDATE assigners SET password_hash = ? WHERE id = ?',
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

module.exports = {
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  deleteAccount
};
