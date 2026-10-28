/**
 * Helper Utilities
 */

const crypto = require('crypto');

/**
 * Generate LAID (Live Assignment ID)
 * Format: LYYMMDDHHMMSSMM (e.g., L25011916453212)
 */
const generateLAID = () => {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0').slice(0, 2);

  return `L${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
};

/**
 * Generate unique token for SMS links (short version for DLT templates)
 * 8 bytes = 16 hex chars (DLT template variable limit)
 */
const generateSMSToken = () => {
  return crypto.randomBytes(8).toString('hex');
};

/**
 * Generate QR code token
 */
const generateQRToken = () => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

const toRadians = (degrees) => {
  return degrees * (Math.PI / 180);
};

/**
 * Get pricing tier based on distance
 */
const getPricingTier = (distanceKm, pricingTiers) => {
  for (const tier of pricingTiers) {
    if (distanceKm >= tier.min_distance_km &&
      (tier.max_distance_km === null || distanceKm < tier.max_distance_km)) {
      return tier;
    }
  }
  return pricingTiers[pricingTiers.length - 1]; // Return last tier as fallback
};

/**
 * Validate Indian phone number (10 digits)
 */
const isValidPhone = (phone) => {
  return /^[6-9]\d{9}$/.test(phone);
};

/**
 * Validate email
 */
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * Validate Indian pincode (6 digits)
 */
const isValidPincode = (pincode) => {
  return /^\d{6}$/.test(pincode);
};

/**
 * Validate vehicle number pattern
 */
const isValidVehicleNumber = (number) => {
  // Pattern: UP32 AB 1234 or UP32AB1234
  return /^[A-Z]{2}\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4}$/i.test(number);
};

/**
 * Convert vehicle number to uppercase
 */
const normalizeVehicleNumber = (number) => {
  return number.toUpperCase().replace(/\s+/g, ' ').trim();
};

/**
 * Sanitize string (remove special characters except spaces)
 */
const sanitizeString = (str) => {
  if (!str) return '';
  return str.replace(/[^a-zA-Z\s]/g, '').trim();
};

/**
 * Parse pagination params
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

/**
 * Parse date from DD-MM-YYYY format
 */
const parseDate = (dateStr) => {
  const [day, month, year] = dateStr.split('-');
  return new Date(year, month - 1, day);
};

/**
 * Format date to DD-MM-YYYY
 */
const formatDate = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

/**
 * Check if current time is within allowed survey hours
 */
const isWithinSurveyHours = (isEmergency = false) => {
  const hour = new Date().getHours();
  if (isEmergency) {
    return hour >= 17; // Emergency after 5 PM
  }
  return hour >= 7; // Regular from 7 AM
};

/**
 * Generate random 4-digit PIN
 */
const generatePIN = () => {
  return String(Math.floor(1000 + Math.random() * 9000));
};

/**
 * Mask sensitive data
 */
const maskPhone = (phone) => {
  if (!phone || phone.length < 10) return phone;
  return phone.slice(0, 2) + '****' + phone.slice(-4);
};

const maskEmail = (email) => {
  if (!email) return email;
  const [local, domain] = email.split('@');
  return local.slice(0, 2) + '***@' + domain;
};

/**
 * Reverse geocode coordinates to get address details
 * Uses Nominatim (OpenStreetMap) API - free, no API key required
 * Returns { address, city, state, pincode, country }
 */
const reverseGeocode = async (latitude, longitude) => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'ClaimsMitra/1.0 (claims.mitra.app@gmail.com)' // Required by Nominatim
        }
      }
    );

    if (!response.ok) {
      console.error('Geocoding API error:', response.status);
      return null;
    }

    const data = await response.json();

    if (!data || !data.address) {
      return null;
    }

    const addr = data.address;

    // Build full address string
    const addressParts = [
      addr.house_number,
      addr.road || addr.street,
      addr.neighbourhood || addr.suburb,
      addr.city_district
    ].filter(Boolean);

    return {
      address: addressParts.join(', ') || data.display_name?.split(',').slice(0, 3).join(',') || null,
      city: addr.city || addr.town || addr.village || addr.county || null,
      state: addr.state || null,
      pincode: addr.postcode || null,
      country: addr.country || null,
      display_name: data.display_name || null
    };
  } catch (error) {
    console.error('Reverse geocoding error:', error.message);
    return null;
  }
};

/**
 * Geocode address using Google Maps Geocoding API
 * Returns { latitude, longitude } or null
 */
const geocodeWithGoogle = async (addressStr, components = '') => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({ key: apiKey });
    if (addressStr) params.set('address', addressStr);
    if (components) params.set('components', components);
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
    if (!response.ok) {
      console.error('Google Geocoding API error:', response.status);
      return null;
    }
    const data = await response.json();
    if (data.status !== 'OK' || !data.results?.length) {
      console.warn(`Google Geocoding returned ${data.status} for "${addressStr}" (components=${components})`);
      return null;
    }
    const loc = data.results[0].geometry.location;
    return { latitude: loc.lat, longitude: loc.lng };
  } catch (err) {
    console.error('Google geocoding error:', err.message);
    return null;
  }
};

/**
 * Geocode address using Nominatim (OpenStreetMap) — fallback when Google is unavailable
 */
const geocodeWithNominatim = async (addressStr) => {
  try {
    const encodedAddress = encodeURIComponent(addressStr);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1&countrycodes=in`,
      { headers: { 'User-Agent': 'ClaimsMitra/1.0 (claims.mitra.app@gmail.com)' } }
    );
    if (!response.ok) {
      console.error('Nominatim Geocoding API error:', response.status);
      return null;
    }
    const data = await response.json();
    if (!data || data.length === 0) return null;
    return { latitude: data[0].lat, longitude: data[0].lon };
  } catch (err) {
    console.error('Nominatim geocoding error:', err.message);
    return null;
  }
};

/**
 * Geocode address to get coordinates.
 * Tries Google Maps first (more reliable for Indian addresses), falls back to Nominatim.
 * Returns { latitude, longitude }
 */
const geocodeAddress = async (addressStr) => {
  if (!addressStr) return null;
  const queryStr = /india/i.test(addressStr) ? addressStr : `${addressStr}, India`;
  return (await geocodeWithGoogle(queryStr, 'country:IN')) || (await geocodeWithNominatim(queryStr));
};

/**
 * Geocode an Indian 6-digit pincode directly to coordinates.
 * Used as a fallback when full-address geocoding fails for Manual Entry surveys.
 * Returns { latitude, longitude }
 */
const geocodePincode = async (pincode) => {
  if (!pincode || !/^\d{6}$/.test(String(pincode).trim())) return null;
  const pin = String(pincode).trim();
  // Google Maps: components filter is the most reliable way to resolve Indian pincodes
  const googleResult = await geocodeWithGoogle('', `postal_code:${pin}|country:IN`);
  if (googleResult) return googleResult;
  // Nominatim fallback
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&postalcode=${pin}&country=India&limit=1`,
      { headers: { 'User-Agent': 'ClaimsMitra/1.0 (claims.mitra.app@gmail.com)' } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.length === 0) return null;
    return { latitude: data[0].lat, longitude: data[0].lon };
  } catch (err) {
    console.error('Pincode geocoding error:', err.message);
    return null;
  }
};

/**
 * Validate a latitude/longitude pair (and reject the 0,0 null-island default).
 */
const isValidLatLng = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
  !(lat === 0 && lng === 0);

/**
 * Coerce a geocoder result ({ latitude, longitude } — strings or numbers) into a
 * validated numeric coordinate pair, or null. Google returns numbers, Nominatim strings.
 */
const coerceCoords = (c) => {
  if (!c) return null;
  const lat = parseFloat(c.latitude);
  const lng = parseFloat(c.longitude);
  return isValidLatLng(lat, lng) ? { latitude: lat, longitude: lng } : null;
};

/**
 * Pull a lat/lng pair out of a full Google/Apple Maps URL string.
 * Handles the common inline-coordinate shapes; returns null if none match.
 */
const parseCoordsFromUrlString = (url) => {
  if (!url || typeof url !== 'string') return null;
  const patterns = [
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,                                  // /@19.07,72.87,17z
    /[?&](?:q|query|ll|sll|saddr|daddr|destination|center)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/, // ?q=19.07,72.87
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,                              // !3d19.07!4d72.87
    /\/place\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,                          // /place/19.07,72.87
    /^\s*(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)\s*$/                         // bare "19.07, 72.87" paste
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (isValidLatLng(lat, lng)) return { latitude: lat, longitude: lng };
    }
  }
  return null;
};

/** Short maps links carry no inline coordinates — they must be expanded first. */
const isShortMapsLink = (url) =>
  /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|app\.goo\.gl)/i.test(url);

/** A bare "lat,lng" string — used to skip coordinate values when pulling place text. */
const isBareLatLng = (s) => /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(String(s).trim());

/**
 * Pull the human-readable place/address text out of a Maps URL — the `q=` /
 * `query=` / `destination=` / `daddr=` parameter, or the `/place/<name>` path
 * segment. Google "Place" shares (e.g. a business) expand to such a URL with no
 * inline lat/lng, so this text is what we geocode. Returns null if none found
 * (or if the only candidate is itself bare coordinates, handled elsewhere).
 */
const extractPlaceTextFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    for (const key of ['q', 'query', 'destination', 'daddr']) {
      const val = u.searchParams.get(key);
      if (val && val.trim() && !isBareLatLng(val)) return val.trim();
    }
    const placeMatch = u.pathname.match(/\/place\/([^/@]+)/);
    if (placeMatch) {
      const name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
      if (name && !isBareLatLng(name)) return name;
    }
  } catch {
    // Not a parseable absolute URL — nothing to extract.
  }
  return null;
};

/**
 * Follow a short link's redirect chain and return the expanded URL (which
 * contains the real coordinates). Times out so a bad link can't hang the request.
 */
const resolveShortLink = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaimsMitra/1.0)' }
    });
    return res.url || null;
  } catch (err) {
    console.error('Maps short-link resolve error:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Extract { latitude, longitude } from a Google/Apple Maps link.
 * Tries inline coordinates first; for short links (maps.app.goo.gl, goo.gl/maps)
 * it follows the redirect to the expanded URL and parses that.
 * Returns null when no coordinates can be resolved.
 */
const extractCoordsFromMapsLink = async (link) => {
  if (!link || typeof link !== 'string') return null;
  const url = link.trim();
  if (!url) return null;

  // 1. Coordinates present directly in the supplied URL
  const direct = parseCoordsFromUrlString(url);
  if (direct) return direct;

  // 2. Short link — expand via redirect, then parse the resolved URL
  let expanded = null;
  if (isShortMapsLink(url)) {
    expanded = await resolveShortLink(url);
    if (expanded) {
      const resolved = parseCoordsFromUrlString(expanded);
      if (resolved) return resolved;
    }
  }

  // 3. No inline lat/lng anywhere — e.g. a Google "Place"/business share that
  //    expands to ?q=<name>&ftid=<id>. Geocode the place/address text instead.
  const placeText = extractPlaceTextFromUrl(expanded || url);
  if (placeText) {
    const geo = coerceCoords(await geocodeAddress(placeText));
    if (geo) return geo;

    // Last resort: a 6-digit Indian pincode embedded in the place text.
    const pin = placeText.match(/\b(\d{6})\b/);
    if (pin) {
      const pinGeo = coerceCoords(await geocodePincode(pin[1]));
      if (pinGeo) return pinGeo;
    }
  }
  return null;
};

module.exports = {
  generateLAID,
  generateSMSToken,
  generateQRToken,
  calculateDistance,
  getPricingTier,
  isValidPhone,
  isValidEmail,
  isValidPincode,
  isValidVehicleNumber,
  normalizeVehicleNumber,
  sanitizeString,
  parsePagination,
  parseDate,
  formatDate,
  isWithinSurveyHours,
  generatePIN,
  maskPhone,
  maskEmail,
  reverseGeocode,
  geocodeAddress,
  geocodePincode,
  extractCoordsFromMapsLink
};
