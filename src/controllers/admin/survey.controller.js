/**
 * Admin Survey Controller
 * Handles survey creation by admin on behalf of assigners
 */

const db = require('../../config/database');
const { success, error, created, notFound } = require('../../utils/response');
const { generateLAID, generateSMSToken, calculateDistance, reverseGeocode, geocodeAddress, geocodePincode, normalizeVehicleNumber } = require('../../utils/helpers');
const { SURVEY_STATUS, LOCATION_METHODS } = require('../../utils/constants');
const notificationHelper = require('../../services/notification.helper');
const smsService = require('../../services/sms.service');

/**
 * Create Survey (Admin)
 * POST /api/v1/admin/surveys
 */
const createSurvey = async (req, res, next) => {
    try {
        const {
            assigner_id,
            surveyor_id,
            survey_type,
            contact_person_name,
            contact_person_mobile,
            alternate_whatsapp_number,
            location_method,
            latitude,
            longitude,
            pincode,
            city,
            state,
            address,
            google_maps_link,
            case_reference,
            name_of_insured,
            policy_number,
            cause_of_loss,
            instructions,
            is_emergency,
            vehicle_category,
            vehicle_type,
            vehicle_number,
            workshop_name,
            workshop_advisor_name,
            workshop_advisor_contact,
            name_of_consignee,
            name_of_consignor,
            commodity,
            loss_item_type,
            investigation_vehicle_number,
            cattle_tag_number,
            cattle_name,
            human_name,
            human_contact_number,
            other_loss_item_name,
        } = req.body;

        // Validate assigner exists
        const assigner = await db.execute_single(
            'SELECT id, latitude, longitude, company_name, contact_person_name FROM assigners WHERE id = ? AND is_active = TRUE',
            [assigner_id]
        );

        if (!assigner) {
            return res.status(400).json(error('Invalid or inactive assigner'));
        }

        // Generate LAID
        const laid = generateLAID();

        // Determine initial status
        let status = SURVEY_STATUS.PENDING;
        let sms_link_token = null;

        // Mutable coordinates
        let finalLat = latitude;
        let finalLng = longitude;

        // Geocode address if coordinates missing
        if ((!finalLat || !finalLng) && (address || city || pincode)) {
            const addressStr = [address, city, state, pincode].filter(Boolean).join(', ');
            if (addressStr) {
                const coords = await geocodeAddress(addressStr);
                if (coords) {
                    finalLat = coords.latitude;
                    finalLng = coords.longitude;
                }
            }
            // Pincode-only fallback for partial addresses or geocoder misses
            if ((!finalLat || !finalLng) && pincode) {
                const pinCoords = await geocodePincode(pincode);
                if (pinCoords) {
                    finalLat = pinCoords.latitude;
                    finalLng = pinCoords.longitude;
                }
            }
        }

        if (location_method === LOCATION_METHODS.SMS_LINK) {
            sms_link_token = generateSMSToken();
        } else if (finalLat && finalLng) {
            status = SURVEY_STATUS.LOCATION_DETECTED;
        }

        // Calculate distance from assigner
        let distance_from_assigner_km = null;
        if (finalLat && finalLng && assigner.latitude && assigner.longitude) {
            distance_from_assigner_km = calculateDistance(
                assigner.latitude, assigner.longitude,
                finalLat, finalLng
            );
        }

        // Reverse geocode if needed
        let finalAddress = address;
        let finalCity = city;
        let finalState = state;
        let finalPincode = pincode;

        if (finalLat && finalLng && (!address || !city || !state)) {
            const geoResult = await reverseGeocode(finalLat, finalLng);
            if (geoResult) {
                finalAddress = finalAddress || geoResult.address;
                finalCity = finalCity || geoResult.city;
                finalState = finalState || geoResult.state;
                finalPincode = finalPincode || geoResult.pincode;
            }
        }

        const sanitizedMapsLink = (typeof google_maps_link === 'string' && google_maps_link.trim()) ? google_maps_link.trim().slice(0, 2048) : null;

        // Insert survey
        const result = await db.execute_query(
            `INSERT INTO surveys (
        laid, survey_type, is_emergency, assigner_id, case_reference,
        contact_person_name, contact_person_mobile, alternate_whatsapp_number, contact_person_available,
        location_method,
        latitude, longitude, pincode, city, state, address, google_maps_link,
        sms_link_token, sms_link_sent_at,
        distance_from_assigner_km, name_of_insured, policy_number,
        cause_of_loss, instructions, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                laid, survey_type, is_emergency || false, assigner_id, case_reference,
                contact_person_name, contact_person_mobile, alternate_whatsapp_number || null, true,
                location_method,
                finalLat || null, finalLng || null, finalPincode || null, finalCity || null, finalState || null, finalAddress || null, sanitizedMapsLink,
                sms_link_token, sms_link_token ? new Date() : null,
                distance_from_assigner_km, name_of_insured || null, policy_number || null,
                cause_of_loss || null, instructions || null, status
            ]
        );

        const surveyId = result.insertId;

        // Log initial status
        await db.execute_query(
            `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, NULL, ?, 'admin', ?, 'Survey created by admin')`,
            [surveyId, status, req.user.id]
        );

        // Insert type-specific details
        if (survey_type.includes('motor') && vehicle_number) {
            await db.execute_query(
                `INSERT INTO motor_survey_details (
          survey_id, vehicle_category, vehicle_type, vehicle_number,
          workshop_name, workshop_advisor_name, workshop_advisor_contact
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    surveyId, vehicle_category, vehicle_type,
                    normalizeVehicleNumber(vehicle_number),
                    workshop_name || null,
                    workshop_advisor_name || null,
                    workshop_advisor_contact || null
                ]
            );
        }

        if (survey_type.includes('marine')) {
            await db.execute_query(
                `INSERT INTO marine_survey_details (survey_id, name_of_consignee, name_of_consignor, commodity)
         VALUES (?, ?, ?, ?)`,
                [surveyId, name_of_consignee || null, name_of_consignor || null, commodity || null]
            );
        }

        if (survey_type === 'investigation' && loss_item_type) {
            await db.execute_query(
                `INSERT INTO investigation_survey_details (
          survey_id, loss_item_type, vehicle_number, cattle_tag_number, cattle_name,
          human_name, human_contact_number, other_loss_item_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    surveyId, loss_item_type,
                    investigation_vehicle_number || null,
                    cattle_tag_number || null, cattle_name || null,
                    human_name || null, human_contact_number || null,
                    other_loss_item_name || null
                ]
            );
        }

        // If surveyor is specified, assign directly
        if (surveyor_id) {
            const surveyor = await db.execute_single(
                'SELECT id, full_name FROM surveyors WHERE id = ? AND is_active = TRUE AND verification_status = ?',
                [surveyor_id, 'verified']
            );

            if (surveyor) {
                await db.execute_query(
                    `UPDATE surveys SET 
            surveyor_id = ?, 
            surveyor_assigned_at = NOW(),
            status = 'assigned'
           WHERE id = ?`,
                    [surveyor_id, surveyId]
                );

                await db.execute_query(
                    `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
           VALUES (?, ?, 'assigned', 'admin', ?, ?)`,
                    [surveyId, status, req.user.id, `Assigned to ${surveyor.full_name} by admin`]
                );

                // Notify surveyor
                const surveyObj = { id: surveyId, laid, survey_type };
                await notificationHelper.notifySurveyorSurveyAssigned(surveyor_id, surveyObj, assigner);
            }
        }

        // If surveyor is specified, assign directly
        if (surveyor_id) {
            // ... (existing assignment logic, untouched)
            // But wait, the context above is tricky. I'll just insert the SMS block BEFORE the final res.json
        }

        // === SMS Logic ===
        let smsLink = null;
        if (sms_link_token) {
            smsLink = `${process.env.SMS_LOCATION_BASE_URL || 'http://localhost:3000/api/v1/public/location'}/${sms_link_token}`;
            console.log(`📤 Preparing to send SMS to: ${contact_person_mobile}, Link: ${smsLink}`);

            try {
                const tokenPath = `location?=${sms_link_token}`;
                await smsService.sendLocationLinkSMS(contact_person_mobile, tokenPath);
                console.log(`📱 Location SMS sent to ${contact_person_mobile}`);

                // Log SMS in database
                const smsMessage = `As part of your insurance claim process, please share the loss location using the link below. This information will be used only to assist our authorized surveyor/investigator.\nLink: www.claimsmitra.com/${tokenPath}`;
                await db.execute_query(
                    `INSERT INTO sms_logs (phone_number, message_content, sms_type, reference_type, reference_id, status, sent_at)
           VALUES (?, ?, 'location_link', 'survey', ?, 'sent', NOW())`,
                    [contact_person_mobile, smsMessage, surveyId]
                );
            } catch (smsError) {
                console.error('❌ Failed to send location SMS:', smsError.message);
            }
        }

        res.status(201).json(created({ id: surveyId, laid, sms_link: smsLink }, 'Survey created successfully'));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    createSurvey
};
