/**
 * Main Routes Aggregator
 */

const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin.routes');
const assignerRoutes = require('./assigner.routes');
const surveyorRoutes = require('./surveyor.routes');
const surveyRoutes = require('./survey.routes');
const publicRoutes = require('./public.routes');
const filesRoutes = require('./files.routes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/assigner', assignerRoutes);
router.use('/surveyor', surveyorRoutes);
router.use('/surveys', surveyRoutes);
router.use('/public', publicRoutes);
// v2 §4.4 — authenticated, balance-gated report downloads.
router.use('/files', filesRoutes);

module.exports = router;
