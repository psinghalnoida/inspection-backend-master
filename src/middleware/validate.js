/**
 * Request Validation Middleware
 */

const { validationResult } = require('express-validator');
const { validationError } = require('../utils/response');

/**
 * Validate request and return errors if any
 */
const validate = (req, res, next) => {
  console.log("enter validate");  
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(err => ({
      field: err.path,
      message: err.msg
    }));
    
    return res.status(400).json(validationError(formattedErrors));
  }
  
  next();
};

module.exports = { validate };
