/**
 * Admin Authentication Controller
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../middleware/auth');
const { success, error, unauthorized } = require('../../utils/response');
const { USER_ROLES } = require('../../utils/constants');
const { sendPasswordResetEmail } = require('../../config/email');

/**
 * Admin Login
 * POST /api/v1/auth/admin/login
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json(error('Email and password are required'));
    }

    // Find admin by email
    const admin = await db.execute_single(
      'SELECT * FROM admins WHERE email = ? AND is_active = TRUE',
      [email]
    );

    if (!admin) {
      return res.status(401).json(unauthorized('Invalid credentials'));
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json(unauthorized('Invalid credentials'));
    }

    // Update last login
    await db.execute_query(
      'UPDATE admins SET last_login_at = NOW() WHERE id = ?',
      [admin.id]
    );

    // Generate tokens
    const accessToken = generateAccessToken(admin, USER_ROLES.ADMIN);
    const refreshToken = generateRefreshToken(admin, USER_ROLES.ADMIN);

    res.json(success({
      user: {
        id: admin.id,
        full_name: admin.full_name,
        email: admin.email,
        phone: admin.phone,
        is_super_admin: admin.is_super_admin,
        profile_picture_url: admin.profile_picture_url
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
 * POST /api/v1/auth/admin/refresh-token
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json(error('Refresh token is required'));
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refresh_token);

    if (decoded.role !== USER_ROLES.ADMIN) {
      return res.status(401).json(unauthorized('Invalid token'));
    }

    // Find admin
    const admin = await db.execute_single(
      'SELECT * FROM admins WHERE id = ? AND is_active = TRUE',
      [decoded.id]
    );

    if (!admin) {
      return res.status(401).json(unauthorized('User not found'));
    }

    // Generate new tokens
    const accessToken = generateAccessToken(admin, USER_ROLES.ADMIN);
    const newRefreshToken = generateRefreshToken(admin, USER_ROLES.ADMIN);

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
 * POST /api/v1/auth/admin/logout
 */
const logout = async (req, res, next) => {
  try {
    // In a real app, you might blacklist the token here
    res.json(success(null, 'Logged out successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Forgot Password
 * POST /api/v1/auth/admin/forgot-password
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(error('Email is required'));
    }

    const admin = await db.execute_single(
      'SELECT id, email, full_name FROM admins WHERE email = ?',
      [email]
    );

    // Return 404 if email not found
    if (!admin) {
      return res.status(404).json(notFound('No account found with this email address'));
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Delete any existing tokens for this user
    await db.execute_query(
      'DELETE FROM password_reset_tokens WHERE user_type = ? AND user_id = ?',
      ['admin', admin.id]
    );

    // Store new token
    await db.execute_query(
      `INSERT INTO password_reset_tokens (user_type, user_id, token, expires_at) 
       VALUES (?, ?, ?, ?)`,
      ['admin', admin.id, resetToken, expiresAt]
    );

    // Generate reset link
    const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetLink = `${baseUrl}/api/v1/public/reset-password/${resetToken}`;

    // Send email (non-blocking - don't wait for it)
    try {
      await sendPasswordResetEmail(admin.email, resetLink, admin.full_name);
      console.log(`✅ Password reset email sent to ${admin.email}`);
    } catch (emailErr) {
      console.error('❌ Failed to send email:', emailErr.message);
      // Continue anyway - mobile apps can use the token directly
    }

    // Return token for mobile apps to navigate to reset screen
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
 * Reset Password (API endpoint - JSON response)
 * POST /api/v1/auth/admin/reset-password
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
       WHERE token = ? AND user_type = 'admin' AND used_at IS NULL AND expires_at > NOW()`,
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
      'UPDATE admins SET password_hash = ? WHERE id = ?',
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
  resetPassword
};
