/**
 * Role-Based Access Control Middleware
 */

const { forbidden } = require('../utils/response');
const { USER_ROLES } = require('../utils/constants');

/**
 * Restrict access to specific roles
 * @param  {...string} allowedRoles - Roles that can access the route
 */
const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json(forbidden('Access denied'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      console.log(`⛔ Access Denied: User Role '${req.user?.role}' not in allowed roles: [${allowedRoles.join(', ')}]`);
      return res.status(403).json(forbidden('You do not have permission to perform this action'));
    }

    next();
  };
};

/**
 * Admin only access
 */
const adminOnly = restrictTo(USER_ROLES.ADMIN);

/**
 * Assigner only access
 */
const assignerOnly = restrictTo(USER_ROLES.ASSIGNER);

/**
 * Surveyor only access
 */
const surveyorOnly = restrictTo(USER_ROLES.SURVEYOR);

/**
 * Admin or Assigner access
 */
const adminOrAssigner = restrictTo(USER_ROLES.ADMIN, USER_ROLES.ASSIGNER);

/**
 * Admin or Surveyor access
 */
const adminOrSurveyor = restrictTo(USER_ROLES.ADMIN, USER_ROLES.SURVEYOR);

/**
 * Assigner or Surveyor access
 */
const assignerOrSurveyor = restrictTo(USER_ROLES.ASSIGNER, USER_ROLES.SURVEYOR);

/**
 * All authenticated users
 */
const anyAuthenticated = restrictTo(USER_ROLES.ADMIN, USER_ROLES.ASSIGNER, USER_ROLES.SURVEYOR);

module.exports = {
  restrictTo,
  adminOnly,
  assignerOnly,
  surveyorOnly,
  adminOrAssigner,
  adminOrSurveyor,
  assignerOrSurveyor,
  anyAuthenticated
};
