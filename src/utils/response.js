/**
 * Standardized API Response Helpers
 */

// Success response
const success = (data, message = 'Success') => ({
  success: true,
  message,
  data
});

// Created response
const created = (data, message = 'Created successfully') => ({
  success: true,
  message,
  data
});

// Error response
const error = (message = 'An error occurred', errors = null) => ({
  success: false,
  message,
  errors
});

// Not found response
const notFound = (message = 'Resource not found') => ({
  success: false,
  message
});

// Unauthorized response
const unauthorized = (message = 'Unauthorized access') => ({
  success: false,
  message
});

// Forbidden response
const forbidden = (message = 'Access forbidden') => ({
  success: false,
  message
});

// Validation error response
const validationError = (errors) => ({
  success: false,
  message: 'Validation failed',
  errors
});

// Paginated response
const paginated = (data, pagination, message = 'Success') => ({
  success: true,
  message,
  data,
  pagination: {
    page: pagination.page,
    limit: pagination.limit,
    total: pagination.total,
    totalPages: Math.ceil(pagination.total / pagination.limit)
  }
});

module.exports = {
  success,
  created,
  error,
  notFound,
  unauthorized,
  forbidden,
  validationError,
  paginated
};
