/**
 * SMS Service using 2Factor.in API
 * API Documentation: https://2factor.in/API/R1/
 */

const https = require('https');
const http = require('http');

class SMSService {
    constructor() {
        this.apiKey = process.env.SMS_2FACTOR_API_KEY;
        this.senderId = process.env.SMS_SENDER_ID || 'ADWITT';
        this.peId = process.env.SMS_PE_ID;
        this.ctId = process.env.SMS_CT_ID;
        this.baseUrl = 'https://2factor.in/API/R1/';
    }

    /**
     * Send transactional SMS
     * @param {string} phoneNumber - 10-digit phone number (without country code)
     * @param {string} message - SMS text content
     * @returns {Promise<object>} - API response
     */
    async sendSMS(phoneNumber, message) {
        // Ensure phone number is 10 digits (remove +91 or 91 prefix if present)
        const cleanPhone = phoneNumber.replace(/^(\+91|91)/, '').trim();

        if (cleanPhone.length !== 10) {
            throw new Error(`Invalid phone number: ${phoneNumber}. Must be 10 digits.`);
        }

        const params = new URLSearchParams({
            module: 'TRANS_SMS',
            apikey: this.apiKey,
            to: cleanPhone,
            from: this.senderId,
            msg: message,
            peid: this.peId,
            ctid: this.ctId
        });

        const url = `${this.baseUrl}?${params.toString()}`;

        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;

            protocol.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.Status === 'Success') {
                            console.log(`✅ SMS sent to ${cleanPhone}: ${response.Details}`);
                            resolve(response);
                        } else {
                            console.error(`❌ SMS failed to ${cleanPhone}:`, response);
                            reject(new Error(response.Details || 'SMS sending failed'));
                        }
                    } catch (parseError) {
                        console.error('❌ Failed to parse SMS API response:', data);
                        reject(new Error('Invalid SMS API response'));
                    }
                });
            }).on('error', (err) => {
                console.error('❌ SMS API request error:', err.message);
                reject(err);
            });
        });
    }

    /**
     * Send location sharing SMS to claimant using 2Factor.in R1 API
     * Template Name: "Location of Survey"
     * Template Content: "As part of your insurance claim process, please share the loss location using the link below. This information will be used only to assist our authorized surveyor/investigator. Link:https://claimsmitra.com/{#var#}"
     * @param {string} phoneNumber - Claimant's phone number
     * @param {string} tokenOrPath - Token or path (used as var1 in template)
     * @returns {Promise<object>}
     */
    async sendLocationLinkSMS(phoneNumber, tokenOrPath) {
        // Ensure phone number is 10 digits (remove +91 or 91 prefix if present)
        const cleanPhone = phoneNumber.replace(/^(\+91|91)/, '').trim();

        if (cleanPhone.length !== 10) {
            throw new Error(`Invalid phone number: ${phoneNumber}. Must be 10 digits.`);
        }

        // Build URL manually (URLSearchParams encodes chars that break 2Factor API)
        const url = `${this.baseUrl}?module=TRANS_SMS&apikey=${this.apiKey}&to=${cleanPhone}&from=${this.senderId}&templatename=${encodeURIComponent('Location of Survey')}&var1=${tokenOrPath}`;
        console.log(`📤 Location SMS: R1 TRANS_SMS to ${cleanPhone}, template=Location of Survey, var1=${tokenOrPath}`);

        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;

            protocol.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.Status === 'Success') {
                            console.log(`✅ Location SMS sent to ${cleanPhone}: ${response.Details}`);
                            resolve(response);
                        } else {
                            console.error(`❌ Location SMS failed to ${cleanPhone}:`, response);
                            reject(new Error(response.Details || 'Location SMS sending failed'));
                        }
                    } catch (parseError) {
                        console.error('❌ Failed to parse Location SMS API response:', data);
                        reject(new Error('Invalid Location SMS API response'));
                    }
                });
            }).on('error', (err) => {
                console.error('❌ Location SMS API request error:', err.message);
                reject(err);
            });
        });
    }

    /**
     * Send location tracking SMS to claimant
     * @param {string} phoneNumber - Claimant's phone number
     * @param {string} trackingLink - Unique tracking link
     * @param {string} surveyorName - Name of the assigned surveyor
     * @returns {Promise<object>}
     */
    async sendTrackingLinkSMS(phoneNumber, trackingLink, surveyorName) {
        const message = `Your survey has been assigned. Track your surveyor ${surveyorName}'s live location here: ${trackingLink} - ClaimsMitra`;
        return this.sendSMS(phoneNumber, message);
    }

    /**
     * Send OTP SMS using 2Factor.in V1 OTP API
     * New DLT-compliant URL format: https://2factor.in/API/V1/{apikey}/SMS/{mobile}/{otp}/{template_name}
     * @param {string} phoneNumber - User's phone number
     * @param {string} otp - One-time password
     * @returns {Promise<object>}
     */
    async sendOTP(phoneNumber, otp) {
        // Ensure phone number is 10 digits (remove +91 or 91 prefix if present)
        const cleanPhone = phoneNumber.replace(/^(\+91|91)/, '').trim();

        if (cleanPhone.length !== 10) {
            throw new Error(`Invalid phone number: ${phoneNumber}. Must be 10 digits.`);
        }

        // Template name as registered in 2Factor.in (URL encoded with + for spaces)
        const templateName = 'Claimsmitra+Phone+Verification';

        // New V1 OTP API URL format
        const url = `https://2factor.in/API/V1/${this.apiKey}/SMS/${cleanPhone}/${otp}/${templateName}`;
        console.log(`📤 OTP SMS URL: https://2factor.in/API/V1/****/SMS/${cleanPhone}/${otp}/${templateName}`);

        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.Status === 'Success') {
                            console.log(`✅ OTP SMS sent to ${cleanPhone}: ${response.Details}`);
                            resolve(response);
                        } else {
                            console.error(`❌ OTP SMS failed to ${cleanPhone}:`, response);
                            reject(new Error(response.Details || 'OTP SMS sending failed'));
                        }
                    } catch (parseError) {
                        console.error('❌ Failed to parse OTP SMS API response:', data);
                        reject(new Error('Invalid OTP SMS API response'));
                    }
                });
            }).on('error', (err) => {
                console.error('❌ OTP SMS API request error:', err.message);
                reject(err);
            });
        });
    }

    /**
     * Send survey assignment notification to surveyor
     * @param {string} phoneNumber - Surveyor's phone number
     * @param {string} surveyId - Survey reference ID
     * @param {string} location - Survey location
     * @returns {Promise<object>}
     */
    async sendSurveyAssignmentSMS(phoneNumber, surveyId, location) {
        const message = `New survey assigned! ID: ${surveyId}, Location: ${location}. Open the ClaimsMitra app for details.`;
        return this.sendSMS(phoneNumber, message);
    }
}

// Export singleton instance
module.exports = new SMSService();
