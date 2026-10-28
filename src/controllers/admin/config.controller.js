/**
 * System Configuration Controller (Admin)
 */

const db = require('../../config/database');
const { success, error, notFound, created } = require('../../utils/response');

/**
 * Get All System Config
 * GET /api/v1/admin/config
 */
const getAllConfig = async (req, res, next) => {
  try {
    const config = await db.execute_query(
      `SELECT id, config_key, config_value, value_type, description, category, is_editable
       FROM system_config
       ORDER BY category, config_key`
    );

    // Group by category
    const grouped = config.reduce((acc, item) => {
      const cat = item.category || 'general';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {});

    res.json(success(grouped));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Config Value
 * PUT /api/v1/admin/config/:key
 */
const updateConfig = async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json(error('Value is required'));
    }

    // Keys the admin UI manages directly and may need to create on first use
    const AUTO_CREATABLE_KEYS = {
      settings_view_password: {
        value_type: 'string',
        description: 'Password required to access the admin Settings page',
        category: 'security'
      }
    };

    // Check if config exists and is editable
    const config = await db.execute_single(
      'SELECT * FROM system_config WHERE config_key = ?',
      [key]
    );

    if (!config) {
      // Auto-create whitelisted UI-managed keys on first save
      const meta = AUTO_CREATABLE_KEYS[key];
      if (!meta) {
        return res.status(404).json(notFound('Config key not found'));
      }

      await db.execute_query(
        `INSERT INTO system_config (config_key, config_value, value_type, description, category, is_editable, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, NOW())`,
        [key, String(value), meta.value_type, meta.description, meta.category, req.user.id]
      );

      return res.json(success(null, 'Config created successfully'));
    }

    if (!config.is_editable) {
      return res.status(400).json(error('This config is not editable'));
    }

    await db.execute_query(
      `UPDATE system_config SET config_value = ?, updated_by = ?, updated_at = NOW()
       WHERE config_key = ?`,
      [String(value), req.user.id, key]
    );

    res.json(success(null, 'Config updated successfully'));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Pricing Tiers
 * GET /api/v1/admin/pricing-tiers
 */
const getPricingTiers = async (req, res, next) => {
  try {
    const tiers = await db.execute_query(
      `SELECT * FROM pricing_tiers ORDER BY min_distance_km ASC`
    );
    res.json(success(tiers));
  } catch (err) {
    next(err);
  }
};

/**
 * Create Pricing Tier
 * POST /api/v1/admin/pricing-tiers
 */
const createPricingTier = async (req, res, next) => {
  try {
    const { tier_name, min_distance_km, max_distance_km, price_amount } = req.body;

    if (!tier_name || min_distance_km === undefined || !price_amount) {
      return res.status(400).json(error('tier_name, min_distance_km, and price_amount are required'));
    }

    const result = await db.execute_query(
      `INSERT INTO pricing_tiers (tier_name, min_distance_km, max_distance_km, price_amount, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [tier_name, min_distance_km, max_distance_km || null, price_amount, req.user.id]
    );

    res.status(201).json(created({ id: result.insertId }, 'Pricing tier created'));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Pricing Tier
 * PUT /api/v1/admin/pricing-tiers/:id
 */
const updatePricingTier = async (req, res, next) => {
  try {
    const { tier_name, min_distance_km, max_distance_km, price_amount, is_active } = req.body;
    
    const updates = [];
    const params = [];

    if (tier_name) { updates.push('tier_name = ?'); params.push(tier_name); }
    if (min_distance_km !== undefined) { updates.push('min_distance_km = ?'); params.push(min_distance_km); }
    if (max_distance_km !== undefined) { updates.push('max_distance_km = ?'); params.push(max_distance_km); }
    if (price_amount) { updates.push('price_amount = ?'); params.push(price_amount); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }

    if (updates.length === 0) {
      return res.status(400).json(error('No fields to update'));
    }

    params.push(req.params.id);

    const result = await db.execute_query(
      `UPDATE pricing_tiers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Pricing tier not found'));
    }

    res.json(success(null, 'Pricing tier updated'));
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Pricing Tier
 * DELETE /api/v1/admin/pricing-tiers/:id
 */
const deletePricingTier = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      'DELETE FROM pricing_tiers WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Pricing tier not found'));
    }

    res.json(success(null, 'Pricing tier deleted'));
  } catch (err) {
    next(err);
  }
};

// ================== COUPON MANAGEMENT ==================

/**
 * Create Coupon
 * POST /api/v1/admin/coupons
 */
const createCoupon = async (req, res, next) => {
  try {
    const {
      code, description, discount_type, discount_value,
      min_order_amount, max_discount_amount,
      usage_limit, valid_from, valid_until
    } = req.body;

    if (!code || !discount_type || !discount_value || !valid_from || !valid_until) {
      return res.status(400).json(error('Required fields: code, discount_type, discount_value, valid_from, valid_until'));
    }

    const result = await db.execute_query(
      `INSERT INTO coupons (
        code, description, discount_type, discount_value,
        min_order_amount, max_discount_amount,
        usage_limit, valid_from, valid_until, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code.toUpperCase(), description || null, discount_type, discount_value,
        min_order_amount || 0, max_discount_amount || null,
        usage_limit || null, valid_from, valid_until, req.user.id
      ]
    );

    res.status(201).json(created({ id: result.insertId }, 'Coupon created'));
  } catch (err) {
    next(err);
  }
};

/**
 * List All Coupons
 * GET /api/v1/admin/coupons
 */
const listCoupons = async (req, res, next) => {
  try {
    const coupons = await db.execute_query(
      `SELECT * FROM coupons ORDER BY created_at DESC`
    );
    res.json(success(coupons));
  } catch (err) {
    next(err);
  }
};

/**
 * Update Coupon
 * PUT /api/v1/admin/coupons/:id
 */
const updateCoupon = async (req, res, next) => {
  try {
    const { description, discount_value, usage_limit, valid_until, is_active } = req.body;
    
    const updates = [];
    const params = [];

    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (discount_value) { updates.push('discount_value = ?'); params.push(discount_value); }
    if (usage_limit !== undefined) { updates.push('usage_limit = ?'); params.push(usage_limit); }
    if (valid_until) { updates.push('valid_until = ?'); params.push(valid_until); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }

    if (updates.length === 0) {
      return res.status(400).json(error('No fields to update'));
    }

    params.push(req.params.id);

    const result = await db.execute_query(
      `UPDATE coupons SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Coupon not found'));
    }

    res.json(success(null, 'Coupon updated'));
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Coupon
 * DELETE /api/v1/admin/coupons/:id
 */
const deleteCoupon = async (req, res, next) => {
  try {
    const result = await db.execute_query(
      'DELETE FROM coupons WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json(notFound('Coupon not found'));
    }

    res.json(success(null, 'Coupon deleted'));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // Config
  getAllConfig,
  updateConfig,
  
  // Pricing
  getPricingTiers,
  createPricingTier,
  updatePricingTier,
  deletePricingTier,
  
  // Coupons
  createCoupon,
  listCoupons,
  updateCoupon,
  deleteCoupon
};
