/**
 * Global Error Handler Middleware
 */

const { error } = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let errors = null;

  // MySQL duplicate entry error
  if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 400;
    message = 'Duplicate entry. This record already exists.';
    
    // Extract field name from error message
    const match = err.message.match(/for key '(.+?)'/);
    if (match) {
      const key = match[1];
      if (key.includes('email')) message = 'Email already exists';
      if (key.includes('phone')) message = 'Phone number already exists';
      if (key.includes('laid')) message = 'LAID already exists';
    }
  }

  // MySQL foreign key error
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    statusCode = 400;
    message = 'Referenced record does not exist';
  }

  // Validation errors from express-validator
  if (err.array && typeof err.array === 'function') {
    statusCode = 400;
    message = 'Validation failed';
    errors = err.array();
  }

  // Multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'File size too large';
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    message = 'Unexpected file field';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Send error response
  res.status(statusCode).json(error(message, errors));
};

module.exports = errorHandler;
