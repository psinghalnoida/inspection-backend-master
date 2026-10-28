/**
 * Password Reset Controller (EJS Pages)
 * Handles the web-based password reset flow
 */

const bcrypt = require('bcryptjs');
const db = require('../../config/database');

/**
 * Show Reset Password Form
 * GET /api/v1/public/reset-password/:token
 */
const showResetForm = async (req, res) => {
  try {
    const { token } = req.params;

    // Find valid token
    const tokenRecord = await db.execute_single(
      `SELECT prt.*, 
              CASE prt.user_type 
                WHEN 'admin' THEN a.email
                WHEN 'assigner' THEN asn.email
                WHEN 'surveyor' THEN s.email
              END as email
       FROM password_reset_tokens prt
       LEFT JOIN admins a ON prt.user_type = 'admin' AND prt.user_id = a.id
       LEFT JOIN assigners asn ON prt.user_type = 'assigner' AND prt.user_id = asn.id
       LEFT JOIN surveyors s ON prt.user_type = 'surveyor' AND prt.user_id = s.id
       WHERE prt.token = ? AND prt.used_at IS NULL AND prt.expires_at > NOW()`,
      [token]
    );

    if (!tokenRecord) {
      return res.render('reset-expired', {
        message: 'This password reset link is invalid or has expired.'
      });
    }

    res.render('reset-password', {
      token,
      email: tokenRecord.email,
      error: null
    });

  } catch (err) {
    console.error('Reset form error:', err);
    res.render('reset-expired', {
      message: 'An error occurred. Please try again.'
    });
  }
};

/**
 * Handle Password Reset Form Submission
 * POST /api/v1/public/reset-password/:token
 */
const handleResetForm = async (req, res) => {
  try {
    const { token } = req.params;
    const { new_password, confirm_password } = req.body;

    // Validate passwords match
    if (new_password !== confirm_password) {
      return res.render('reset-password', {
        token,
        error: 'Passwords do not match'
      });
    }

    // Validate password length
    if (!new_password || new_password.length < 6) {
      return res.render('reset-password', {
        token,
        error: 'Password must be at least 6 characters'
      });
    }

    // Find valid token
    const tokenRecord = await db.execute_single(
      `SELECT * FROM password_reset_tokens 
       WHERE token = ? AND used_at IS NULL AND expires_at > NOW()`,
      [token]
    );

    if (!tokenRecord) {
      return res.render('reset-expired', {
        message: 'This password reset link is invalid or has expired.'
      });
    }

    // Hash new password
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const password_hash = await bcrypt.hash(new_password, saltRounds);

    // Update password based on user type
    let updateQuery;
    switch (tokenRecord.user_type) {
      case 'admin':
        updateQuery = 'UPDATE admins SET password_hash = ? WHERE id = ?';
        break;
      case 'assigner':
        updateQuery = 'UPDATE assigners SET password_hash = ? WHERE id = ?';
        break;
      case 'surveyor':
        updateQuery = 'UPDATE surveyors SET password_hash = ? WHERE id = ?';
        break;
      default:
        return res.render('reset-expired', { message: 'Invalid user type' });
    }

    await db.execute_query(updateQuery, [password_hash, tokenRecord.user_id]);

    // Mark token as used
    await db.execute_query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
      [tokenRecord.id]
    );

    // Show success page
    res.render('reset-success');

  } catch (err) {
    console.error('Reset password error:', err);
    res.render('reset-expired', {
      message: 'An error occurred while resetting your password. Please try again.'
    });
  }
};

module.exports = {
  showResetForm,
  handleResetForm
};
