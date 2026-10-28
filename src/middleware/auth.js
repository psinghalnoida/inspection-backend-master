/**
 * JWT Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { unauthorized, forbidden } = require('../utils/response');
const { USER_ROLES } = require('../utils/constants');

/**
 * Verify JWT token and attach user to request
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(unauthorized('No token provided'));
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user based on role
    let user = null;
    let table = '';

    switch (decoded.role) {
      case USER_ROLES.ADMIN:
        table = 'admins';
        break;
      case USER_ROLES.ASSIGNER:
        table = 'assigners';
        break;
      case USER_ROLES.SURVEYOR:
        table = 'surveyors';
        break;
      default:
        return res.status(401).json(unauthorized('Invalid token'));
    }

    user = await db.execute_single(
      `SELECT id, is_active FROM ${table} WHERE id = ?`,
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json(unauthorized('User not found'));
    }

    if (!user.is_active) {
      return res.status(403).json(forbidden('Account is deactivated'));
    }

    // Attach user info to request
    req.user = {
      id: decoded.id,
      role: decoded.role,
      ...decoded
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(unauthorized('Token expired'));
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json(unauthorized('Invalid token'));
    }
    console.error('Auth error:', error);
    return res.status(401).json(unauthorized('Authentication failed'));
  }
};

/**
 * Generate access token
 */
const generateAccessToken = (user, role) => {
  return jwt.sign(
    { id: user.id, role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
};

/**
 * Generate refresh token
 */
const generateRefreshToken = (user, role) => {
  return jwt.sign(
    { id: user.id, role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '24h' }
  );
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

module.exports = {
  authenticate,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken
};
