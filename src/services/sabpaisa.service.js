/**
 * SabPaisa Payment Gateway Service
 * Handles encryption, decryption, and payment URL generation
 * 
 * Uses AES-256-GCM + HMAC-SHA384 as per official SabPaisa SDK
 */

const crypto = require('crypto');

// SabPaisa Configuration from environment (use getters for fresh values)
const SABPAISA_CONFIG = {
    get clientCode() { return process.env.SABPAISA_CLIENT_CODE; },
    get authKey() { return process.env.SABPAISA_AUTH_KEY; },
    get authIV() { return process.env.SABPAISA_AUTH_IV; },
    get username() { return process.env.SABPAISA_USERNAME; },
    get password() { return process.env.SABPAISA_PASSWORD; },
    get baseUrl() { return process.env.SABPAISA_BASE_URL; },
    get callbackUrl() { return process.env.SABPAISA_CALLBACK_URL; }
};

/**
 * Convert Base64 encoded key to Buffer
 */
const decodeBase64 = (base64String) => {
    return Buffer.from(base64String, 'base64');
};

/**
 * Convert buffer to HEX string (uppercase)
 */
const toHex = (buffer) => {
    return Buffer.from(buffer).toString('hex').toUpperCase();
};

/**
 * Convert HEX string to buffer
 */
const fromHex = (hexString) => {
    return Buffer.from(hexString, 'hex');
};

/**
 * Encrypt data using AES-256-GCM + HMAC-SHA384
 * This matches the official SabPaisa SDK implementation
 * @param {string} plainText - Text to encrypt
 * @returns {string} HEX encoded encrypted string
 */
const encrypt = (plainText) => {
    try {
        const authKey = decodeBase64(SABPAISA_CONFIG.authKey);
        const authIV = decodeBase64(SABPAISA_CONFIG.authIV);

        // Generate random 12-byte IV for GCM
        const iv = crypto.randomBytes(12);

        // Create cipher with AES-256-GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', authKey, iv);

        // Encrypt the data
        let encrypted = cipher.update(plainText, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);

        // Get the auth tag (16 bytes for tagLength: 128)
        const authTag = cipher.getAuthTag();

        // Combine: IV + encrypted + authTag
        const combined = Buffer.concat([iv, encrypted, authTag]);

        // Create HMAC-SHA384 signature
        const hmac = crypto.createHmac('sha384', authIV);
        hmac.update(combined);
        const signature = hmac.digest();

        // Final format: HMAC (48 bytes) + IV (12 bytes) + encrypted + authTag (16 bytes)
        const final = Buffer.concat([signature, combined]);

        // Return as uppercase HEX
        return toHex(final);
    } catch (error) {
        console.error('SabPaisa Encryption Error:', error.message);
        throw new Error('Payment encryption failed: ' + error.message);
    }
};

/**
 * Decrypt data using AES-256-GCM + HMAC-SHA384
 * @param {string} encryptedHex - HEX encoded encrypted string
 * @returns {string} Decrypted plain text
 */
const decrypt = (encryptedHex) => {
    try {
        const authKey = decodeBase64(SABPAISA_CONFIG.authKey);
        const authIV = decodeBase64(SABPAISA_CONFIG.authIV);

        // Convert HEX to buffer
        const data = fromHex(encryptedHex);

        if (data.length < 76) { // 48 (HMAC) + 12 (IV) + 16 (authTag) minimum
            throw new Error('Invalid ciphertext length');
        }

        // Extract parts: first 48 bytes = HMAC signature
        const signature = data.slice(0, 48);
        const combined = data.slice(48);

        // Verify HMAC
        const hmac = crypto.createHmac('sha384', authIV);
        hmac.update(combined);
        const expectedSignature = hmac.digest();

        if (!crypto.timingSafeEqual(signature, expectedSignature)) {
            throw new Error('HMAC validation failed. Data may be tampered!');
        }

        // Extract IV (12 bytes) and encrypted data + authTag
        const iv = combined.slice(0, 12);
        const encryptedWithTag = combined.slice(12);

        // Last 16 bytes are the auth tag
        const authTag = encryptedWithTag.slice(-16);
        const encrypted = encryptedWithTag.slice(0, -16);

        // Create decipher
        const decipher = crypto.createDecipheriv('aes-256-gcm', authKey, iv);
        decipher.setAuthTag(authTag);

        // Decrypt
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf8');
    } catch (error) {
        console.error('SabPaisa Decryption Error:', error.message);
        throw new Error('Payment decryption failed: ' + error.message);
    }
};

/**
 * Build payment request payload
 * @param {Object} paymentData - Payment details
 * @returns {Object} Formatted request payload
 */
const buildPaymentPayload = (paymentData) => {
    const {
        clientTxnId,
        amount,
        payerName,
        payerEmail,
        payerMobile,
        payerAddress = '',
        udf1 = '',
        udf2 = '',
        udf3 = '',
        udf4 = '',
        udf5 = ''
    } = paymentData;

    // Generate transaction date in required format: YYYY-MM-DD HH:MM:SS
    const now = new Date();
    const pad = n => n < 10 ? '0' + n : n;
    const transDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    return {
        payerName,
        payerEmail,
        payerMobile,
        clientTxnId,
        amount: amount.toString(),
        clientCode: SABPAISA_CONFIG.clientCode,
        transUserName: SABPAISA_CONFIG.username,
        transUserPassword: SABPAISA_CONFIG.password,
        callbackUrl: SABPAISA_CONFIG.callbackUrl,
        channelId: 'W', // Web channel
        mcc: '5666', // Merchant Category Code (required by SabPaisa)
        transDate, // Transaction date (required by SabPaisa)
        udf1,
        udf2,
        udf3,
        udf4,
        udf5
    };
};

/**
 * Generate encrypted payment URL for SabPaisa
 * @param {Object} paymentData - Payment details
 * @returns {Object} { paymentUrl, clientTxnId }
 */
const generatePaymentUrl = (paymentData) => {
    const payload = buildPaymentPayload(paymentData);

    // Build query string WITHOUT URL encoding (matching official SabPaisa sample)
    // SabPaisa expects plain text values, not URL-encoded
    const queryString = Object.entries(payload)
        .filter(([key, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

    console.log('SabPaisa Request (before encryption):', queryString.replace(/transUserPassword=[^&]+/, 'transUserPassword=***'));

    // Encrypt the query string
    const encryptedData = encrypt(queryString);

    // Debug: Log config values
    console.log('SabPaisa Config Check:', {
        clientCode: SABPAISA_CONFIG.clientCode,
        baseUrl: SABPAISA_CONFIG.baseUrl ? 'SET' : 'MISSING',
        username: SABPAISA_CONFIG.username ? 'SET' : 'MISSING'
    });

    // Build final payment URL
    const paymentUrl = `${SABPAISA_CONFIG.baseUrl}&encData=${encryptedData}&clientCode=${SABPAISA_CONFIG.clientCode}`;

    console.log('SabPaisa Payment URL generated:', {
        clientTxnId: payload.clientTxnId,
        urlLength: paymentUrl.length,
        hasClientCode: paymentUrl.includes('clientCode='),
        clientCodeInUrl: SABPAISA_CONFIG.clientCode
    });

    return {
        paymentUrl,
        clientTxnId: payload.clientTxnId,
        encryptedData
    };
};

/**
 * Parse and decrypt SabPaisa callback response
 * @param {string} encResponse - Encrypted response from SabPaisa (HEX)
 * @returns {Object} Parsed response data
 */
const parseCallbackResponse = (encResponse) => {
    if (!encResponse) {
        throw new Error('Empty response from payment gateway');
    }

    // Replace spaces with + (URL encoding issue)
    const cleanedResponse = encResponse.replace(/ /g, '+');

    // Decrypt the response
    const decryptedString = decrypt(cleanedResponse);
    console.log('Decrypted SabPaisa Response:', decryptedString);

    // Parse the URLSearchParams format response
    const params = new URLSearchParams(decryptedString);
    const response = {};

    for (const [key, value] of params.entries()) {
        const cleanKey = key.trim();
        // Trim value if string, handle 'null' string
        let cleanValue = value === 'null' ? null : value;
        if (typeof cleanValue === 'string') {
            cleanValue = cleanValue.trim();
        }
        response[cleanKey] = cleanValue;
    }

    return response;
};

/**
 * Validate payment response
 * @param {Object} response - Parsed response from SabPaisa
 * @returns {Object} { isSuccess, status, message, transactionId }
 */
const validatePaymentResponse = (response) => {
    const {
        status,
        statusCode,
        sabpaisaTxnId,
        clientTxnId,
        paidAmount,
        bankMessage,
        bankTxnId,
        actCode,
        payerName,
        payerEmail,
        payerMobile
    } = response;

    // Check for success using multiple possible success indicators
    // SabPaisa sometimes sends "00", "0", "200" or "SUCCESS"
    const statusSuccess = status && status.toUpperCase() === 'SUCCESS';
    const statusCodeSuccess = statusCode && ['00', '0', '200'].includes(statusCode.toString());
    const actCodeSuccess = actCode && ['00', '0', '200'].includes(actCode.toString());

    const isSuccess = statusSuccess || statusCodeSuccess || actCodeSuccess;

    console.log('Payment Validation Logic:', {
        status,
        statusCode,
        actCode,
        statusSuccess,
        statusCodeSuccess,
        actCodeSuccess,
        finalIsSuccess: isSuccess
    });

    return {
        isSuccess,
        status: status || 'UNKNOWN',
        statusCode: statusCode || actCode || '',
        message: bankMessage || (isSuccess ? 'Payment successful' : 'Payment failed'),
        sabpaisaTxnId: sabpaisaTxnId || null,
        clientTxnId: clientTxnId || null,
        paidAmount: paidAmount ? parseFloat(paidAmount) : 0,
        bankTxnId: bankTxnId || null,
        payerDetails: {
            name: payerName,
            email: payerEmail,
            mobile: payerMobile
        },
        rawResponse: response
    };
};

/**
 * Generate unique client transaction ID
 * @param {number} paymentId - Payment record ID
 * @returns {string} Unique transaction ID (max 20 chars)
 */
const generateClientTxnId = (paymentId) => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `CM${paymentId}${timestamp}${random}`.slice(0, 20);
};

/**
 * Check if SabPaisa is properly configured
 * @returns {boolean}
 */
const isConfigured = () => {
    return !!(
        SABPAISA_CONFIG.clientCode &&
        SABPAISA_CONFIG.authKey &&
        SABPAISA_CONFIG.authIV &&
        SABPAISA_CONFIG.username &&
        SABPAISA_CONFIG.password &&
        SABPAISA_CONFIG.baseUrl &&
        SABPAISA_CONFIG.callbackUrl
    );
};

module.exports = {
    encrypt,
    decrypt,
    buildPaymentPayload,
    generatePaymentUrl,
    parseCallbackResponse,
    validatePaymentResponse,
    generateClientTxnId,
    isConfigured,
    SABPAISA_CONFIG
};
