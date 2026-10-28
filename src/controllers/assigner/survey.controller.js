/**
 * Assigner Survey Controller
 */

const db = require("../../config/database");
const {
  success,
  error,
  created,
  notFound,
  paginated,
} = require("../../utils/response");
const {
  generateLAID,
  generateSMSToken,
  generateQRToken,
  parsePagination,
  calculateDistance,
  isWithinSurveyHours,
  normalizeVehicleNumber,
  reverseGeocode,
  geocodeAddress,
  geocodePincode,
  extractCoordsFromMapsLink,
} = require("../../utils/helpers");
const {
  SURVEY_STATUS,
  LOCATION_METHODS,
  SURVEY_TYPES,
} = require("../../utils/constants");
const notificationHelper = require("../../services/notification.helper");
const smsService = require("../../services/sms.service");
const walletController = require("../surveyor/wallet.controller");
// const { surveyBroadcastQueue } = require('../../queues/survey.queue'); // Moved to service

/**
 * Create New Survey (Unified with Type-Specific Details & Documents)
 * POST /api/v1/assigner/surveys
 * Supports: multipart/form-data with documents
 */
const createSurvey = async (req, res, next) => {
  try {
    // Helper to convert form-data string booleans to actual booleans
    const toBoolean = (val) => {
      if (val === "true" || val === true || val === "1" || val === 1)
        return true;
      if (val === "false" || val === false || val === "0" || val === 0)
        return false;
      return !!val;
    };

    const {
      survey_type,
      contact_person_name,
      contact_person_mobile,
      contact_person_available,
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
      // Motor specific
      vehicle_category,
      vehicle_type,
      vehicle_type_other,
      vehicle_number,
      workshop_name,
      workshop_advisor_name,
      workshop_advisor_contact,
      // Marine specific
      name_of_consignee,
      name_of_consignor,
      commodity,
      invoices, // JSON string for marine invoices
      gr_entries, // JSON string for marine GR entries
      // Investigation specific
      loss_item_type,
      investigation_vehicle_number,
      cattle_tag_number,
      cattle_name,
      human_name,
      human_contact_number,
      human_relation,
      other_loss_item_name,
      // Document types
      document_types,
      // Surveyor assignment
      surveyor_mobile,
    } = req.body;

    // Convert string booleans to actual booleans (form-data sends strings)
    const isEmergency = toBoolean(is_emergency);
    const contactAvailable = toBoolean(contact_person_available ?? true);

    // Validate survey timing
    // if (!isWithinSurveyHours(isEmergency)) {
    //   return res.status(400).json(error(
    //     isEmergency
    //       ? 'Emergency surveys can only be created after 5 PM'
    //       : 'Regular surveys can only be created from 7 AM onwards'
    //   ));
    // }

    // Generate LAID
    const laid = generateLAID();

    // Determine initial status based on location method
    let status = SURVEY_STATUS.PENDING;
    let sms_link_token = null;

    // Use mutable variables for coordinates
    let finalLat = latitude;
    let finalLng = longitude;

    // If no coordinates but address provided (Manual Entry), try to geocode
    if ((!finalLat || !finalLng) && (address || city || pincode)) {
      console.log(
        "🌍 Coordinates missing for new survey, attempting to geocode address...",
      );
      const addressStr = [address, city, state, pincode]
        .filter(Boolean)
        .join(", ");
      if (addressStr) {
        const coords = await geocodeAddress(addressStr);
        if (coords) {
          console.log("📍 Geocoded survey location from full address:", coords);
          finalLat = coords.latitude;
          finalLng = coords.longitude;
        }
      }
      // Pincode-only fallback — handles partial addresses or geocoder misses on the full string
      if ((!finalLat || !finalLng) && pincode) {
        const pinCoords = await geocodePincode(pincode);
        if (pinCoords) {
          console.log(
            `📍 Geocoded survey location from pincode ${pincode}:`,
            pinCoords,
          );
          finalLat = pinCoords.latitude;
          finalLng = pinCoords.longitude;
        } else {
          console.warn(
            `⚠️ Failed to geocode survey location for pincode ${pincode}`,
          );
        }
      }
    }

    // Extract coordinates from the Google Maps link ONLY for the dedicated
    // 'google_maps_link' method. Other methods (SMS link, coordinates, pincode)
    // must not pick up a stray maps URL — that bled coordinates into the SMS flow.
    if (
      location_method === LOCATION_METHODS.GOOGLE_MAPS_LINK &&
      (!finalLat || !finalLng) &&
      google_maps_link
    ) {
      const linkCoords = await extractCoordsFromMapsLink(google_maps_link);
      if (linkCoords) {
        console.log(
          "📍 Extracted survey location from Google Maps link:",
          linkCoords,
        );
        finalLat = linkCoords.latitude;
        finalLng = linkCoords.longitude;
      } else {
        console.warn("⚠️ Could not extract coordinates from Google Maps link");
      }
    }

    // If the assigner explicitly chose the maps-link method, coordinates are required.
    if (
      location_method === LOCATION_METHODS.GOOGLE_MAPS_LINK &&
      (!finalLat || !finalLng)
    ) {
      return res
        .status(400)
        .json(
          error(
            "Could not read a location from the Google Maps link. Please paste a valid Maps link (or open it and copy the coordinates).",
          ),
        );
    }

    if (location_method === LOCATION_METHODS.SMS_LINK) {
      sms_link_token = generateSMSToken();
    } else if (finalLat && finalLng) {
      status = SURVEY_STATUS.LOCATION_DETECTED;
    }

    // Calculate distance from assigner to incident
    let distance_from_assigner_km = null;
    if (finalLat && finalLng) {
      const assigner = await db.execute_single(
        "SELECT latitude, longitude FROM assigners WHERE id = ?",
        [req.user.id],
      );
      if (assigner && assigner.latitude && assigner.longitude) {
        distance_from_assigner_km = calculateDistance(
          assigner.latitude,
          assigner.longitude,
          finalLat,
          finalLng,
        );
      }
    }

    // Reverse geocode to get address if coordinates provided but address is missing
    let finalAddress = address;
    let finalCity = city;
    let finalState = state;
    let finalPincode = pincode;

    if (finalLat && finalLng && (!address || !city || !state)) {
      console.log("🌍 Reverse geocoding coordinates:", finalLat, finalLng);
      const geoResult = await reverseGeocode(finalLat, finalLng);
      if (geoResult) {
        console.log("📍 Geocode result:", geoResult);
        finalAddress = finalAddress || geoResult.address;
        finalCity = finalCity || geoResult.city;
        finalState = finalState || geoResult.state;
        finalPincode = finalPincode || geoResult.pincode;
      }
    }

    const sanitizedMapsLink =
      typeof google_maps_link === "string" && google_maps_link.trim()
        ? google_maps_link.trim().slice(0, 2048)
        : null;

    // Insert main survey record
    const result = await db.execute_query(
      `INSERT INTO surveys (
        laid, survey_type, is_emergency, assigner_id, case_reference,
        contact_person_name, contact_person_mobile, contact_person_available,
        alternate_whatsapp_number, location_method,
        latitude, longitude, pincode, city, state, address, google_maps_link,
        sms_link_token, sms_link_sent_at,
        distance_from_assigner_km, name_of_insured, policy_number,
        cause_of_loss, instructions, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        laid,
        survey_type,
        isEmergency,
        req.user.id,
        case_reference,
        contact_person_name,
        contact_person_mobile,
        contactAvailable,
        alternate_whatsapp_number || null,
        location_method,
        finalLat || null,
        finalLng || null,
        finalPincode || null,
        finalCity || null,
        finalState || null,
        finalAddress || null,
        sanitizedMapsLink,
        sms_link_token,
        sms_link_token ? new Date() : null,
        distance_from_assigner_km,
        name_of_insured || null,
        policy_number || null,
        cause_of_loss || null,
        instructions || null,
        status,
      ],
    );

    const surveyId = result.insertId;

    // Log initial status
    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, NULL, ?, 'assigner', ?, 'Survey created')`,
      [surveyId, status, req.user.id],
    );

    // === Insert Type-Specific Details ===
    let typeDetailsId = null;

    if (survey_type.includes("motor") && vehicle_number) {
      // Motor Survey Details
      const motorResult = await db.execute_query(
        `INSERT INTO motor_survey_details (
          survey_id, vehicle_category, vehicle_type, vehicle_type_other, vehicle_number,
          workshop_name, workshop_advisor_name, workshop_advisor_contact
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          surveyId,
          vehicle_category,
          vehicle_type,
          vehicle_type_other || null,
          normalizeVehicleNumber(vehicle_number),
          workshop_name || null,
          workshop_advisor_name || null,
          workshop_advisor_contact || null,
        ],
      );
      typeDetailsId = motorResult.insertId;
    } else if (survey_type.includes("marine") && name_of_consignee) {
      // Marine Survey Details
      const marineResult = await db.execute_query(
        `INSERT INTO marine_survey_details (survey_id, name_of_consignee, name_of_consignor, commodity)
         VALUES (?, ?, ?, ?)`,
        [surveyId, name_of_consignee, name_of_consignor, commodity],
      );
      const marineDetailsId = marineResult.insertId;
      typeDetailsId = marineDetailsId;

      // Process Invoices
      if (invoices) {
        const invoiceList =
          typeof invoices === "string" ? JSON.parse(invoices) : invoices;
        const invoiceFiles = req.files?.invoice_files || [];

        for (let i = 0; i < invoiceList.length; i++) {
          const inv = invoiceList[i];
          const invoiceFile = invoiceFiles[i];

          await db.execute_query(
            `INSERT INTO marine_invoices (
              marine_survey_id, invoice_number, invoice_date, invoice_amount,
              invoice_file_url, invoice_file_type, invoice_file_size_bytes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              marineDetailsId,
              inv.invoice_number,
              inv.invoice_date,
              inv.invoice_amount || null,
              invoiceFile ? `/uploads/documents/${invoiceFile.filename}` : null,
              invoiceFile ? invoiceFile.mimetype.split("/")[1] : null,
              invoiceFile ? invoiceFile.size : null,
            ],
          );
        }
      }

      // Process GR Entries
      if (gr_entries) {
        const grList =
          typeof gr_entries === "string" ? JSON.parse(gr_entries) : gr_entries;
        const grFiles = req.files?.gr_files || [];

        for (let i = 0; i < grList.length; i++) {
          const gr = grList[i];
          const grFile = grFiles[i];

          await db.execute_query(
            `INSERT INTO marine_gr_entries (
              marine_survey_id, gr_number, gr_date,
              gr_file_url, gr_file_type, gr_file_size_bytes
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              marineDetailsId,
              gr.gr_number,
              gr.gr_date,
              grFile ? `/uploads/documents/${grFile.filename}` : null,
              grFile ? grFile.mimetype.split("/")[1] : null,
              grFile ? grFile.size : null,
            ],
          );
        }
      }
    } else if (survey_type === "investigation" && loss_item_type) {
      // Investigation Survey Details
      const invResult = await db.execute_query(
        `INSERT INTO investigation_survey_details (
          survey_id, loss_item_type, vehicle_number, 
          cattle_tag_number, cattle_name,
          human_name, human_contact_number, human_relation,
          other_loss_item_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          surveyId,
          loss_item_type,
          investigation_vehicle_number
            ? normalizeVehicleNumber(investigation_vehicle_number)
            : null,
          cattle_tag_number || null,
          cattle_name || null,
          human_name || null,
          human_contact_number || null,
          human_relation || null,
          other_loss_item_name || null,
        ],
      );
      typeDetailsId = invResult.insertId;
    }

    // === Process Document Uploads ===
    const uploadedDocs = [];
    if (req.files?.documents) {
      const docTypes = document_types
        ? typeof document_types === "string"
          ? JSON.parse(document_types)
          : document_types
        : [];

      for (let i = 0; i < req.files.documents.length; i++) {
        const file = req.files.documents[i];
        const docType = docTypes[i] || "others";

        const docResult = await db.execute_query(
          `INSERT INTO survey_documents (
            survey_id, uploaded_by_type, uploaded_by_id,
            document_type, original_file_name, file_url, file_type,
            original_size_bytes, compressed_size_bytes, is_compressed
          ) VALUES (?, 'assigner', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            surveyId,
            req.user.id,
            docType,
            file.originalname,
            `/uploads/documents/${file.filename}`,
            file.mimetype.includes("pdf")
              ? "pdf"
              : file.mimetype.includes("png")
                ? "png"
                : "jpg",
            file.size,
            file.size,
            false,
          ],
        );

        uploadedDocs.push({
          id: docResult.insertId,
          type: docType,
          filename: file.filename,
          url: `/uploads/documents/${file.filename}`,
        });
      }
    }

    // Build SMS link URL if needed and send SMS
    let smsLink = null;
    console.log(
      `📋 Survey created - location_method: ${location_method}, sms_link_token: ${sms_link_token}`,
    );

    if (sms_link_token) {
      smsLink = `${process.env.SMS_LOCATION_BASE_URL || "http://localhost:3000/api/v1/public/location"}/${sms_link_token}`;
      console.log(
        `📤 Preparing to send SMS to: ${contact_person_mobile}, Link: ${smsLink}`,
      );
      console.log(
        `🔑 SMS Config - API Key: ${process.env.SMS_2FACTOR_API_KEY ? "✅ Set" : "❌ Not Set"}`,
      );

      // Send SMS with location sharing link using DLT registered template
      // Template: Link:https://claimsmitra.com/{#var#}
      // DLT doesn't allow slashes in variable, so using location?=TOKEN format
      try {
        // Format: location?=TOKEN (backend /location route handles this)
        const tokenPath = `location?=${sms_link_token}`;
        await smsService.sendLocationLinkSMS(contact_person_mobile, tokenPath);
        console.log(`📱 Location SMS sent to ${contact_person_mobile}`);

        // Log SMS in database
        const smsMessage = `As part of your insurance claim process, please share the loss location using the link below. This information will be used only to assist our authorized surveyor/investigator.\nLink: www.claimsmitra.com/${tokenPath}`;
        await db.execute_query(
          `INSERT INTO sms_logs (phone_number, message_content, sms_type, reference_type, reference_id, status, sent_at)
           VALUES (?, ?, 'location_link', 'survey', ?, 'sent', NOW())`,
          [contact_person_mobile, smsMessage, surveyId],
        );
      } catch (smsError) {
        console.error("❌ Failed to send location SMS:", smsError.message);
        // Don't fail survey creation if SMS fails
      }
    } else {
      console.log(
        `ℹ️ No SMS sent - location_method is: ${location_method} (SMS only sent for 'sms_link')`,
      );
    }

    // === Handle Surveyor Direct Assignment (Optional) ===
    let assignedSurveyorId = null;
    if (surveyor_mobile) {
      // Look up surveyor by phone number
      const surveyor = await db.execute_single(
        `SELECT id, full_name, phone, verification_status, is_available 
         FROM surveyors WHERE phone = ? AND is_active = 1 LIMIT 1`,
        [surveyor_mobile],
      );

      if (!surveyor) {
        // Rollback: delete the created survey
        await db.execute_query("DELETE FROM surveys WHERE id = ?", [surveyId]);
        return res.status(400).json({
          success: false,
          message: "Surveyor not found with this mobile number",
          code: "SURVEYOR_NOT_FOUND",
          data: { suggestion: "Leave empty to broadcast to all surveyors" },
        });
      }

      // Check if surveyor is verified (optional - can be removed if you want to allow unverified too)
      if (surveyor.verification_status !== "verified") {
        // Rollback: delete the created survey
        await db.execute_query("DELETE FROM surveys WHERE id = ?", [surveyId]);
        return res.status(400).json({
          success: false,
          message: "Surveyor is not verified",
          code: "SURVEYOR_NOT_VERIFIED",
        });
      }

      // v2 §1.4 (revised): the category rule gates BROADCAST only. Direct
      // assignment is a deliberate trust decision by the assigner — they may
      // assign any accepted member of their team regardless of category. No
      // category check here on purpose.

      // Enforce admin-managed team: assigner must have direct-assign enabled and
      // the chosen surveyor must be a member of their team.
      const assignerRow = await db.execute_single(
        "SELECT is_direct_assign FROM assigners WHERE id = ?",
        [req.user.id],
      );
      if (!assignerRow || !assignerRow.is_direct_assign) {
        await db.execute_query("DELETE FROM surveys WHERE id = ?", [surveyId]);
        return res.status(403).json({
          success: false,
          message: "Direct assignment is not enabled for your account",
          code: "DIRECT_ASSIGN_DISABLED",
        });
      }

      // v2 §2.2: consent is required. An invited-but-unanswered surveyor is NOT
      // assignable — without the status check, inviting someone would silently
      // grant the assigner power over them before they ever agreed.
      const teamMember = await db.execute_single(
        "SELECT id, status FROM assigner_surveyor_team WHERE assigner_id = ? AND surveyor_id = ? LIMIT 1",
        [req.user.id, surveyor.id],
      );
      if (!teamMember) {
        await db.execute_query("DELETE FROM surveys WHERE id = ?", [surveyId]);
        return res.status(403).json({
          success: false,
          message: "Surveyor is not in your team. Invite them from your team page first.",
          code: "SURVEYOR_NOT_IN_TEAM",
        });
      }
      if (teamMember.status !== "accepted") {
        await db.execute_query("DELETE FROM surveys WHERE id = ?", [surveyId]);
        return res.status(403).json({
          success: false,
          message: teamMember.status === "pending"
            ? `${surveyor.full_name} has not accepted your team invite yet.`
            : `${surveyor.full_name} declined your team invite.`,
          code: "TEAM_INVITE_NOT_ACCEPTED",
          data: { invite_status: teamMember.status },
        });
      }

      // For direct assignment: decide final status based on location availability
      // SMS link flow has no coordinates yet — wait for location before going in_transit
      const isSmsFlow = location_method === LOCATION_METHODS.SMS_LINK;
      const hasLocation = !!(finalLat && finalLng);
      const canStartImmediately = !isSmsFlow && hasLocation;

      let directAssignStatus = "assigned";
      let qrCodeUrl = null;

      if (canStartImmediately) {
        // Generate QR code and move to in_transit immediately (no payment)
        const qrToken = generateQRToken();
        qrCodeUrl = `${process.env.QR_TRACKING_BASE_URL}/${qrToken}`;
        directAssignStatus = SURVEY_STATUS.IN_TRANSIT;
      }

      await db.execute_query(
        `UPDATE surveys SET
          surveyor_id = ?,
          surveyor_mobile = ?,
          is_direct_assign = TRUE,
          status = ?,
          surveyor_assigned_at = NOW(),
          ${canStartImmediately ? "qr_code_url = ?, qr_code_generated_at = NOW(), in_transit_at = NOW()," : ""}
          updated_at = NOW()
         WHERE id = ?`,
        canStartImmediately
          ? [
              surveyor.id,
              surveyor_mobile,
              directAssignStatus,
              qrCodeUrl,
              surveyId,
            ]
          : [surveyor.id, surveyor_mobile, directAssignStatus, surveyId],
      );

      // Log assigned status
      await db.execute_query(
        `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
         VALUES (?, ?, 'assigned', 'assigner', ?, ?)`,
        [
          surveyId,
          status,
          req.user.id,
          `Direct assignment (no payment) to surveyor: ${surveyor.full_name}`,
        ],
      );

      // Log in_transit status if applicable
      if (canStartImmediately) {
        await db.execute_query(
          `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
           VALUES (?, 'assigned', ?, 'system', NULL, 'Direct assignment — skipped payment, survey started')`,
          [surveyId, SURVEY_STATUS.IN_TRANSIT],
        );
      }

      const assigner = await db.execute_single(
        "SELECT id, company_name, contact_person_name FROM assigners WHERE id = ?",
        [req.user.id],
      );

      notificationHelper
        .notifySurveyorSurveyAssigned(
          surveyor.id,
          { id: surveyId, laid, survey_type, assigner_id: req.user.id },
          assigner,
        )
        .catch((err) => console.error("Notification error:", err));

      notificationHelper
        .notifyAssignerSurveyAssigned(
          req.user.id,
          { id: surveyId, laid, survey_type, surveyor_id: surveyor.id },
          surveyor,
        )
        .catch((err) => console.error("Notification error:", err));

      if (canStartImmediately) {
        // Notify surveyor that they can start immediately
        notificationHelper
          .notifySurveyorPaymentCompleted(surveyor.id, { id: surveyId, laid })
          .catch((err) => console.error("Notification error:", err));
      }

      assignedSurveyorId = surveyor.id;
      status = directAssignStatus;
      console.log(
        `✅ Survey ${surveyId} directly assigned to surveyor ${surveyor.id} — status: ${directAssignStatus}`,
      );
    }

    // Only trigger broadcast if no direct assignment was made
    const { triggerBroadcast } = require("../../services/broadcast.service");
    let notifiedSurveyorsCount = 0;
    if (
      !assignedSurveyorId &&
      finalLat &&
      finalLng &&
      status === SURVEY_STATUS.LOCATION_DETECTED
    ) {
      notifiedSurveyorsCount = await triggerBroadcast(
        surveyId,
        finalLat,
        finalLng,
      );
      console.log(
        `📢 Started broadcast for survey ${surveyId} to ${notifiedSurveyorsCount} surveyors`,
      );
    }

    res.status(201).json(
      created(
        {
          id: surveyId,
          laid,
          survey_type,
          status,
          is_direct_assign: !!assignedSurveyorId,
          type_details_id: typeDetailsId,
          documents_uploaded: uploadedDocs.length,
          documents: uploadedDocs,
          sms_link: smsLink,
          notified_surveyors: assignedSurveyorId ? 0 : notifiedSurveyorsCount,
          assigned_surveyor: assignedSurveyorId
            ? { id: assignedSurveyorId }
            : null,
        },
        "Survey created successfully",
      ),
    );
  } catch (err) {
    next(err);
  }
};

/**
 * List Assigner's Surveys
 * GET /api/v1/assigner/surveys
 */
const listSurveys = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, survey_type, search } = req.query;

    let whereClause = "assigner_id = ?";
    const whereParams = [req.user.id];

    if (status) {
      whereClause += " AND status = ?";
      whereParams.push(status);
    }

    if (survey_type) {
      whereClause += " AND survey_type = ?";
      whereParams.push(survey_type);
    }

    if (search) {
      whereClause +=
        " AND (laid LIKE ? OR case_reference LIKE ? OR contact_person_name LIKE ?)";
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const listParams = [...whereParams, limit, offset];

    const [surveys, countResult] = await Promise.all([
      db.query_rows(
        `SELECT s.*, sv.full_name as surveyor_name, sv.phone as surveyor_phone
         FROM surveys s
         LEFT JOIN surveyors sv ON s.surveyor_id = sv.id
         WHERE ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        listParams,
      ),
      db.query_single(
        `SELECT COUNT(*) as total FROM surveys WHERE ${whereClause}`,
        whereParams,
      ),
    ]);

    res.json(paginated(surveys, { page, limit, total: countResult.total }));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Details
 * GET /api/v1/assigner/surveys/:id
 */
const getSurvey = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      `SELECT s.*, sv.full_name as surveyor_name, sv.phone as surveyor_phone,
              sv.profile_picture_url as surveyor_picture
       FROM surveys s
       LEFT JOIN surveyors sv ON s.surveyor_id = sv.id
       WHERE s.id = ? AND s.assigner_id = ?`,
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    // Mask surveyor details if in 'assigned' status (Blind Assignment)
    if (survey.status === SURVEY_STATUS.ASSIGNED) {
      survey.surveyor_name = "Allocated Surveyor";
      survey.surveyor_phone = null;
      survey.surveyor_picture = null;
      survey.is_blind_assigned = true;
    }

    // Get type-specific details
    let details = null;
    if (survey.survey_type.includes("motor")) {
      details = await db.execute_single(
        "SELECT * FROM motor_survey_details WHERE survey_id = ?",
        [survey.id],
      );
    } else if (survey.survey_type.includes("marine")) {
      details = await db.execute_single(
        "SELECT * FROM marine_survey_details WHERE survey_id = ?",
        [survey.id],
      );
      if (details) {
        details.invoices = await db.execute_query(
          "SELECT * FROM marine_invoices WHERE marine_survey_id = ?",
          [details.id],
        );
        details.gr_entries = await db.execute_query(
          "SELECT * FROM marine_gr_entries WHERE marine_survey_id = ?",
          [details.id],
        );
      }
    } else if (survey.survey_type === "investigation") {
      details = await db.execute_single(
        "SELECT * FROM investigation_survey_details WHERE survey_id = ?",
        [survey.id],
      );
    }

    survey.details = details;

    // Get documents
    survey.documents = await db.execute_query(
      "SELECT * FROM survey_documents WHERE survey_id = ? ORDER BY created_at DESC",
      [survey.id],
    );

    // Get photos — chronological per session so the gallery groups cleanly
    survey.photos = await db.execute_query(
      "SELECT * FROM survey_photos WHERE survey_id = ? ORDER BY session_number ASC, captured_at ASC, id ASC",
      [survey.id],
    );

    // Per-session surveyor remarks (saves a separate /notes round-trip)
    survey.session_notes = await db.execute_query(
      `SELECT session_number, notes, created_at, updated_at
       FROM survey_session_notes
       WHERE survey_id = ?
       ORDER BY session_number ASC`,
      [survey.id],
    );

    // Get reports — same v2 §4.4 gate as GET /surveys/:id/reports. Without it this
    // payload hands the client an unlocked-looking row (the file route still 402s,
    // but the client shows a download button that cannot work).
    const surveyReports = await db.execute_query(
      "SELECT * FROM survey_reports WHERE survey_id = ? ORDER BY version DESC",
      [survey.id],
    );
    const reportAccess = require("../../services/reportAccess.service");
    const reportAccessState = await reportAccess.checkReportAccess(survey.id);
    survey.reports = reportAccessState.locked
      ? reportAccess.redactReports(surveyReports, reportAccessState.reason)
      : surveyReports;

    // Construct SMS link URL if token exists
    if (survey.sms_link_token) {
      survey.sms_link = `${process.env.SMS_LOCATION_BASE_URL || "http://localhost:3000/api/v1/public/location"}/${survey.sms_link_token}`;
    }

    // Backfill Survey Coordinates if missing and address available
    if (
      (!survey.latitude || !survey.longitude) &&
      (survey.address || survey.city || survey.pincode)
    ) {
      console.log(
        "🌍 Survey location missing in detail view, attempting backfill...",
      );
      const addressParts = [
        survey.address,
        survey.city,
        survey.state,
        survey.pincode,
      ].filter(Boolean);

      if (addressParts.length > 0) {
        const coords = await geocodeAddress(addressParts.join(", "));
        if (coords) {
          console.log("📍 Backfilled survey location:", coords);
          survey.latitude = coords.latitude;
          survey.longitude = coords.longitude;
          // Update DB
          await db.execute_query(
            "UPDATE surveys SET latitude = ?, longitude = ? WHERE id = ?",
            [coords.latitude, coords.longitude, survey.id],
          );
        }
      }
    }

    // Get pricing tier if surveyor is assigned
    if (survey.surveyor_id) {
      let distanceKm = survey.distance_from_assigner_km;

      // Calculate distance on-the-fly if not stored but coordinates exist
      // Calculate distance on-the-fly if not stored or if it seems incorrect (e.g. > 500km might signal stale coords)
      if (
        (distanceKm === null || distanceKm > 500) &&
        survey.latitude &&
        survey.longitude
      ) {
        // CHANGED: Calculate distance from SURVEYOR, not Assigner
        // Fetch surveyor details
        const surveyor = await db.execute_single(
          "SELECT id, current_latitude, current_longitude, business_address, city, state, pincode FROM surveyors WHERE id = ?",
          [survey.surveyor_id],
        );

        if (surveyor) {
          let surveyorLat = surveyor.current_latitude;
          let surveyorLng = surveyor.current_longitude;

          // specific fix: if surveyor has no location, try to geocode it from their address
          if (!surveyorLat || !surveyorLng) {
            console.log(
              "🌍 Surveyor location missing, attempting to geocode...",
            );
            const addressParts = [
              surveyor.business_address,
              surveyor.city,
              surveyor.state,
              surveyor.pincode,
            ].filter(Boolean);

            if (addressParts.length > 0) {
              const addressStr = addressParts.join(", ");
              const coords = await geocodeAddress(addressStr);

              if (coords) {
                console.log("📍 Geocoded surveyor location:", coords);
                surveyorLat = coords.latitude;
                surveyorLng = coords.longitude;

                // Save to surveyor profile as their current known location
                await db.execute_query(
                  "UPDATE surveyors SET current_latitude = ?, current_longitude = ? WHERE id = ?",
                  [coords.latitude, coords.longitude, surveyor.id],
                );
              }
            }
          }

          if (surveyorLat && surveyorLng) {
            distanceKm = calculateDistance(
              surveyorLat,
              surveyorLng,
              survey.latitude,
              survey.longitude,
            );

            console.log(
              `📏 Calculated Distance: ${distanceKm}km (Surveyor -> Survey)`,
            );

            // Store it for future use - NOTE: This column name might be misleading now if it's called 'distance_from_assigner_km'
            // but we are using it to store the relevant distance for pricing.
            await db.execute_query(
              "UPDATE surveys SET distance_from_assigner_km = ? WHERE id = ?",
              [distanceKm, survey.id],
            );
            survey.distance_from_assigner_km = distanceKm;
          }
        }
      }

      // Get pricing tier based on distance (or default tier if no distance)
      const pricingTier = await db.execute_single(
        `SELECT tier_name, price_amount FROM pricing_tiers 
         WHERE is_active = TRUE AND min_distance_km <= ? 
         AND (max_distance_km IS NULL OR max_distance_km > ?)
         ORDER BY min_distance_km DESC LIMIT 1`,
        [distanceKm || 0, distanceKm || 0],
      );
      if (pricingTier) {
        survey.pricing_tier = pricingTier;
      }
    }

    // Always get all pricing tiers for display
    const allPricingTiers = await db.execute_query(
      `SELECT id, tier_name, min_distance_km, max_distance_km, price_amount 
       FROM pricing_tiers WHERE is_active = TRUE 
       ORDER BY min_distance_km ASC`,
    );
    survey.all_pricing_tiers = allPricingTiers;

    res.json(success(survey));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Status History
 * GET /api/v1/assigner/surveys/:id/status-history
 */
const getStatusHistory = async (req, res, next) => {
  try {
    // Verify ownership
    const survey = await db.execute_single(
      "SELECT id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    const history = await db.execute_query(
      `SELECT * FROM survey_status_history WHERE survey_id = ? ORDER BY created_at ASC`,
      [req.params.id],
    );

    res.json(success(history));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Photos
 * GET /api/v1/assigner/surveys/:id/photos
 */
const getSurveyPhotos = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    const { type } = req.query; // all, assigner, surveyor

    let whereClause = "survey_id = ?";
    const params = [req.params.id];

    // Photos are uploaded by surveyor, but we can filter by type
    if (type && type !== "all") {
      whereClause += " AND photo_type = ?";
      params.push(type);
    }

    const photos = await db.execute_query(
      `SELECT * FROM survey_photos WHERE ${whereClause} ORDER BY session_number ASC, captured_at ASC, id ASC`,
      params,
    );

    res.json(success(photos));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Per-Session Surveyor Notes
 * GET /api/v1/assigner/surveys/:id/notes
 */
const getSessionNotes = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!survey) return res.status(404).json(notFound("Survey not found"));

    const rows = await db.execute_query(
      `SELECT session_number, notes, created_at, updated_at
       FROM survey_session_notes
       WHERE survey_id = ?
       ORDER BY session_number ASC`,
      [req.params.id],
    );
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Documents
 * GET /api/v1/assigner/surveys/:id/documents
 */
const getSurveyDocuments = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    const { uploaded_by } = req.query; // all, assigner, surveyor

    let whereClause = "survey_id = ?";
    const params = [req.params.id];

    if (uploaded_by && uploaded_by !== "all") {
      whereClause += " AND uploaded_by_type = ?";
      params.push(uploaded_by);
    }

    const documents = await db.execute_query(
      `SELECT * FROM survey_documents WHERE ${whereClause} ORDER BY created_at DESC`,
      params,
    );

    res.json(success(documents));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Survey Reports
 * GET /api/v1/assigner/surveys/:id/reports
 */
const getSurveyReports = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    const reports = await db.execute_query(
      `SELECT r.*, sv.full_name as surveyor_name
       FROM survey_reports r
       JOIN surveyors sv ON r.surveyor_id = sv.id
       WHERE r.survey_id = ?
       ORDER BY r.version DESC`,
      [req.params.id],
    );

    // v2 §4.4: the file is withheld until the invoice balance is settled, but the
    // metadata stays visible — version, submission date and the surveyor's notes.
    // Hiding the rows entirely would make a finished survey look unfinished.
    const reportAccess = require("../../services/reportAccess.service");
    const access = await reportAccess.checkReportAccess(req.params.id);

    if (access.locked) {
      return res.json(success(
        reportAccess.redactReports(reports, access.reason),
        access.reason
      ));
    }

    res.json(success(reports));
  } catch (err) {
    next(err);
  }
};

/**
 * Accept Report
 * PUT /api/v1/assigner/surveys/:id/reports/:reportId/accept
 */
const acceptReport = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id, status, surveyor_id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    if (
      survey.status !== SURVEY_STATUS.REPORT_SUBMITTED &&
      survey.status !== SURVEY_STATUS.NOT_RESOLVED
    ) {
      return res
        .status(400)
        .json(error("Cannot accept report in current status"));
    }

    // Update report
    await db.execute_query(
      `UPDATE survey_reports SET status = 'accepted', accepted_by = ?, accepted_at = NOW()
       WHERE id = ? AND survey_id = ?`,
      [req.user.id, req.params.reportId, req.params.id],
    );

    // Update survey status
    await db.execute_query(
      `UPDATE surveys SET status = ?, completed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [SURVEY_STATUS.FINISHED, req.params.id],
    );

    // Log status change
    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, ?, ?, 'assigner', ?, 'Report accepted')`,
      [req.params.id, survey.status, SURVEY_STATUS.FINISHED, req.user.id],
    );

    // Get payment info and create payout
    const payment = await db.execute_single(
      "SELECT id, surveyor_payout_amount FROM payments WHERE survey_id = ?",
      [req.params.id],
    );

    if (payment) {
      await db.execute_query(
        `INSERT INTO surveyor_payouts (payment_id, survey_id, surveyor_id, payout_amount, payout_method, status)
         VALUES (?, ?, ?, ?, 'bank_transfer', 'pending')`,
        [
          payment.id,
          req.params.id,
          survey.surveyor_id,
          payment.surveyor_payout_amount,
        ],
      );

      // Notify surveyor about payment released
      notificationHelper
        .notifySurveyorPaymentReleased(
          survey.surveyor_id,
          { id: req.params.id, laid: survey.laid },
          payment.surveyor_payout_amount,
        )
        .catch((err) => console.error("Notification error:", err));
    }

    // Notify surveyor about report accepted
    const fullSurvey = await db.execute_single(
      "SELECT id, laid FROM surveys WHERE id = ?",
      [req.params.id],
    );
    notificationHelper
      .notifySurveyorReportAccepted(
        survey.surveyor_id,
        fullSurvey || { id: req.params.id },
      )
      .catch((err) => console.error("Notification error:", err));

    // v2 §5.4: accepting the report can complete export readiness. Generate the
    // composite PDF now (fire-and-forget, self-guarding) so it appears without
    // waiting for the hourly cron.
    require("../../services/cmSync.service").triggerExportAsync(
      req.params.id, "report accepted",
    );

    res.json(success(null, "Report accepted. Survey completed."));
  } catch (err) {
    next(err);
  }
};

/**
 * Reject Report (Creates Dispute)
 * PUT /api/v1/assigner/surveys/:id/reports/:reportId/reject
 */
const rejectReport = async (req, res, next) => {
  try {
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
      return res.status(400).json(error("Rejection reason is required"));
    }

    const survey = await db.execute_single(
      "SELECT id, status, surveyor_id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    if (survey.status !== SURVEY_STATUS.REPORT_SUBMITTED) {
      return res
        .status(400)
        .json(error("Cannot reject report in current status"));
    }

    const report = await db.execute_single(
      "SELECT version FROM survey_reports WHERE id = ? AND survey_id = ?",
      [req.params.reportId, req.params.id],
    );

    if (!report) {
      return res.status(404).json(notFound("Report not found"));
    }

    // Update report
    await db.execute_query(
      `UPDATE survey_reports SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
       WHERE id = ?`,
      [req.user.id, rejection_reason, req.params.reportId],
    );

    // Update survey status
    await db.execute_query(
      `UPDATE surveys SET status = ?, updated_at = NOW() WHERE id = ?`,
      [SURVEY_STATUS.NOT_RESOLVED, req.params.id],
    );

    // Create dispute
    await db.execute_query(
      `INSERT INTO disputes (survey_id, assigner_id, surveyor_id, rejection_reason, report_version_rejected, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [
        req.params.id,
        req.user.id,
        survey.surveyor_id,
        rejection_reason,
        report.version,
      ],
    );

    // Log status change
    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, ?, ?, 'assigner', ?, ?)`,
      [
        req.params.id,
        SURVEY_STATUS.REPORT_SUBMITTED,
        SURVEY_STATUS.NOT_RESOLVED,
        req.user.id,
        `Report rejected: ${rejection_reason}`,
      ],
    );

    // Notify surveyor about report rejection
    const fullSurvey = await db.execute_single(
      "SELECT id, laid FROM surveys WHERE id = ?",
      [req.params.id],
    );
    notificationHelper
      .notifySurveyorReportRejected(
        survey.surveyor_id,
        fullSurvey || { id: req.params.id },
        rejection_reason,
      )
      .catch((err) => console.error("Notification error:", err));

    res.json(success(null, "Report rejected. Dispute created."));
  } catch (err) {
    next(err);
  }
};

/**
 * Escalate Survey to Admin (Timeout)
 * POST /api/v1/assigner/surveys/:id/escalate
 */
const escalateSurvey = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id, status, surveyor_id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    // Check if dispute already exists for this survey
    const existingDispute = await db.execute_single(
      "SELECT id FROM disputes WHERE survey_id = ?",
      [survey.id],
    );

    if (existingDispute) {
      return res
        .status(400)
        .json(error("A dispute already exists for this survey"));
    }

    // Create Dispute (Escalated)
    await db.execute_query(
      `INSERT INTO disputes (survey_id, assigner_id, surveyor_id, rejection_reason, report_version_rejected, status, is_escalated, escalated_at, escalation_reason)
       VALUES (?, ?, ?, 'Survey Timeout - Escalate to Admin', 0, 'escalated', TRUE, NOW(), 'Assigner escalated after timeout')`,
      [survey.id, req.user.id, survey.surveyor_id || 0],
    );

    // Update Status
    await db.execute_query("UPDATE surveys SET status = ? WHERE id = ?", [
      "disputed",
      survey.id,
    ]);

    // Log History
    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, ?, ?, 'assigner', ?, 'Escalated to Admin')`,
      [survey.id, survey.status, "disputed", req.user.id],
    );

    // Notify admin about escalation
    await notificationHelper
      .notifyAdminSurveyEscalated(
        survey.id,
        req.user.id,
        survey.surveyor_id || 0,
      )
      .catch((err) => console.error("Notification error (Admin):", err));

    // Notify surveyor about escalation
    if (survey.surveyor_id) {
      const fullSurvey = await db.execute_single(
        "SELECT id, laid FROM surveys WHERE id = ?",
        [survey.id],
      );
      await notificationHelper
        .notifySurveyorSurveyEscalated(
          survey.surveyor_id,
          fullSurvey || { id: survey.id },
        )
        .catch((err) => console.error("Notification error (Surveyor):", err));
    }

    res.json(success(null, "Survey escalated to admin"));
  } catch (err) {
    next(err);
  }
};

/**
 * Get Surveyor Live Location
 * GET /api/v1/assigner/surveys/:id/surveyor-location
 */
const getSurveyorLocation = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      `SELECT s.id, s.status, s.surveyor_id, sv.current_latitude, sv.current_longitude, sv.location_updated_at
       FROM surveys s
       JOIN surveyors sv ON s.surveyor_id = sv.id
       WHERE s.id = ? AND s.assigner_id = ?`,
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    if (
      ![
        SURVEY_STATUS.IN_TRANSIT,
        SURVEY_STATUS.ARRIVED,
        SURVEY_STATUS.VISIT_COMPLETED,
      ].includes(survey.status)
    ) {
      return res
        .status(400)
        .json(
          error(
            "Surveyor location only available during transit or after arrival",
          ),
        );
    }

    res.json(
      success({
        latitude: survey.current_latitude,
        longitude: survey.current_longitude,
        updated_at: survey.location_updated_at,
      }),
    );
  } catch (err) {
    next(err);
  }
};

/**
 * Send Location SMS
 * POST /api/v1/assigner/surveys/:id/send-location-sms
 */
const sendLocationSMS = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id, status, contact_person_mobile, sms_link_token FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    if (survey.status !== SURVEY_STATUS.PENDING) {
      return res
        .status(400)
        .json(error("Location SMS can only be sent for pending surveys"));
    }

    // Generate new token if not exists
    let token = survey.sms_link_token;
    if (!token) {
      token = generateSMSToken();
      await db.execute_query(
        "UPDATE surveys SET sms_link_token = ?, sms_link_sent_at = NOW() WHERE id = ?",
        [token, req.params.id],
      );
    }

    const smsLink = `${process.env.SMS_LOCATION_BASE_URL}/${token}`;

    // Send SMS using DLT registered template
    // Template: Link:https://claimsmitra.com/{#var#}
    // DLT doesn't allow slashes in variable, so using location?=TOKEN format
    const tokenPath = `location?=${token}`;
    const smsMessage = `As part of your insurance claim process, please share the loss location using the link below. This information will be used only to assist our authorized surveyor/investigator.\nLink: www.claimsmitra.com/${tokenPath}`;

    try {
      await smsService.sendLocationLinkSMS(
        survey.contact_person_mobile,
        tokenPath,
      );
      console.log(`📱 Location SMS resent to ${survey.contact_person_mobile}`);
    } catch (smsError) {
      console.error("❌ Failed to send SMS:", smsError.message);
      return res
        .status(500)
        .json(error("Failed to send SMS. Please try again."));
    }

    // Log SMS
    await db.execute_query(
      `INSERT INTO sms_logs (phone_number, message_content, sms_type, reference_type, reference_id, status, sent_at)
       VALUES (?, ?, 'location_link', 'survey', ?, 'sent', NOW())`,
      [survey.contact_person_mobile, smsMessage, req.params.id],
    );

    res.json(success({ sms_link: smsLink }, "Location SMS sent successfully"));
  } catch (err) {
    next(err);
  }
};

/**
 * Upload Documents to Existing Survey
 * POST /api/v1/assigner/surveys/:id/documents
 */
const uploadDocuments = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json(error("No files uploaded"));
    }

    const { document_types } = req.body;
    const docTypes = document_types
      ? typeof document_types === "string"
        ? JSON.parse(document_types)
        : document_types
      : [];

    const uploadedDocs = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const docType = docTypes[i] || "others";

      const result = await db.execute_query(
        `INSERT INTO survey_documents (
          survey_id, uploaded_by_type, uploaded_by_id,
          document_type, original_file_name, file_url, file_type,
          original_size_bytes, compressed_size_bytes, is_compressed
        ) VALUES (?, 'assigner', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          req.user.id,
          docType,
          file.originalname,
          `/uploads/documents/${file.filename}`,
          file.mimetype.includes("pdf")
            ? "pdf"
            : file.mimetype.includes("png")
              ? "png"
              : "jpg",
          file.size,
          file.size,
          false,
        ],
      );

      uploadedDocs.push({
        id: result.insertId,
        type: docType,
        filename: file.filename,
        url: `/uploads/documents/${file.filename}`,
      });
    }

    res
      .status(201)
      .json(
        created(
          { documents: uploadedDocs },
          `${uploadedDocs.length} document(s) uploaded`,
        ),
      );
  } catch (err) {
    next(err);
  }
};

/**
 * Delete Survey Document
 * DELETE /api/v1/assigner/surveys/:id/documents/:docId
 */
const deleteDocument = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    const doc = await db.execute_single(
      "SELECT id, file_url FROM survey_documents WHERE id = ? AND survey_id = ? AND uploaded_by_type = ? AND uploaded_by_id = ?",
      [req.params.docId, req.params.id, "assigner", req.user.id],
    );

    if (!doc) {
      return res
        .status(404)
        .json(notFound("Document not found or not authorized"));
    }

    await db.execute_query("DELETE FROM survey_documents WHERE id = ?", [
      req.params.docId,
    ]);

    // TODO: Delete file from filesystem/cloud storage

    res.json(success(null, "Document deleted"));
  } catch (err) {
    next(err);
  }
};

/**
 * Mark Survey as Satisfied
 * POST /api/v1/assigner/surveys/:id/satisfied
 */
const markSatisfied = async (req, res, next) => {
  try {
    const survey = await db.execute_single(
      "SELECT id, status, surveyor_id, is_direct_assign FROM surveys WHERE id = ? AND assigner_id = ?",
      [req.params.id, req.user.id],
    );

    if (!survey) {
      return res.status(404).json(notFound("Survey not found"));
    }

    // Check if survey is in a completable state
    const completableStatuses = [
      SURVEY_STATUS.VISIT_COMPLETED,
      SURVEY_STATUS.REPORT_SUBMITTED,
      SURVEY_STATUS.PHOTOS_UPLOADED,
      SURVEY_STATUS.DISPUTED,
    ];
    if (!completableStatuses.includes(survey.status)) {
      return res
        .status(400)
        .json(
          error(
            "Survey must be arrived, photos uploaded, report submitted, or disputed to mark as satisfied",
          ),
        );
    }

    // Check if already paid out (partial)
    const existingPayout = await db.execute_single(
      "SELECT id FROM surveyor_payouts WHERE survey_id = ? AND payout_type = ?",
      [req.params.id, "partial"],
    );

    // if (existingPayout) {
    //   return res.status(400).json(error('Partial payment already released'));
    // }

    // v2 §4.5 — ONE source of truth for the split.
    //
    // Three values used to disagree here: platform_commission_percent (25), a
    // dead surveyor_payout_percentage (40) read into a variable and never used,
    // and a hardcoded 75. The 75 happened to equal 100-25, so nothing looked
    // broken — until an admin edited the percentage, after which the assigner
    // was charged on the new rate and the surveyor credited on the old one.
    const billing = require("../../services/billing.service");
    const billingConfig = await billing.getBillingConfig();

    // Trigger Payout based on Final Amount (Assigner Paid Amount)
    const payment = await db.execute_single(
      "SELECT id, final_amount, surveyor_payout_amount FROM payments WHERE survey_id = ? AND status = ?",
      [req.params.id, "completed"],
    );

    // Get survey details for description
    const surveyDetails = await db.execute_single(
      "SELECT laid FROM surveys WHERE id = ?",
      [req.params.id],
    );

    // v2 §4.6 — the surveyor is paid only after the assigner settles.
    //
    // The itemised invoice (when one exists) is the real basis for the split, not
    // the slab advance. An unsettled invoice holds the payout, which is exactly
    // why billing is mandatory and why admins get nagged about unbilled surveys.
    const bill = await db.execute_single(
      `SELECT id, invoice_number, status, taxable_value, balance_due
         FROM survey_bills
        WHERE survey_id = ? AND status IN ('issued','settled')`,
      [req.params.id],
    );

    if (bill && bill.status !== "settled") {
      return res.status(409).json({
        success: false,
        message:
          `Invoice ${bill.invoice_number} is not settled yet (₹${Number(bill.balance_due).toFixed(2)} outstanding). ` +
          "The surveyor is paid once the balance is cleared.",
        code: "BILL_NOT_SETTLED",
        data: { invoice_number: bill.invoice_number, balance_due: bill.balance_due },
      });
    }

    if (payment) {
      // Payout base: the invoice's PRE-GST taxable value when a bill exists,
      // otherwise the advance. Never the GST-inclusive total — that would pay
      // out a share of collected tax.
      const payoutBase = bill
        ? Number(bill.taxable_value)
        : Number(payment.final_amount);

      const walletCreditAmount = billing.surveyorPayoutFor(
        payoutBase,
        billingConfig.commissionPercent,
      );

      // Credit to surveyor wallet
      await walletController.creditWallet(
        survey.surveyor_id,
        walletCreditAmount,
        "survey_payout",
        payment.id,
        parseInt(req.params.id),
        `Survey ${surveyDetails?.laid || req.params.id} completed`,
      );

      // Also create payout record for tracking (legacy support)
      await db.execute_query(
        `INSERT INTO surveyor_payouts (payment_id, survey_id, surveyor_id, payout_amount, payout_method, status, payout_type)
         VALUES (?, ?, ?, ?, 'wallet', 'completed', 'wallet_credit')`,
        [payment.id, req.params.id, survey.surveyor_id, walletCreditAmount],
      );

      // Notify surveyor about payment credited to wallet
      notificationHelper
        .notifySurveyorPaymentReleased(
          survey.surveyor_id,
          { id: req.params.id, laid: surveyDetails?.laid },
          walletCreditAmount,
        )
        .catch((err) => console.error("Notification error:", err));

      console.log(
        `✅ Survey ${req.params.id}: ₹${walletCreditAmount} ` +
        `(${100 - billingConfig.commissionPercent}% of ` +
        `${bill ? `invoice ${bill.invoice_number} taxable value` : 'the advance'}) ` +
        `credited to surveyor ${survey.surveyor_id}'s wallet`,
      );
    } else if (!survey.is_direct_assign) {
      return res
        .status(400)
        .json(error("No completed payment found for this survey"));
    }

    // Update survey status to FINISHED
    await db.execute_query(
      `UPDATE surveys SET status = ?, completed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [SURVEY_STATUS.FINISHED, req.params.id],
    );

    // Log status change
    await db.execute_query(
      `INSERT INTO survey_status_history (survey_id, previous_status, new_status, changed_by_type, changed_by_id, remarks)
       VALUES (?, ?, ?, 'assigner', ?, 'Assigner marked survey as satisfied')`,
      [req.params.id, survey.status, SURVEY_STATUS.FINISHED, req.user.id],
    );

    // v2 §5.4: fire the composite-PDF generation now (self-guarding no-op if the
    // report is not accepted yet). The hourly cron remains the backstop.
    require("../../services/cmSync.service").triggerExportAsync(
      req.params.id, "survey satisfied",
    );

    res.json(
      success({ status: SURVEY_STATUS.FINISHED }, "Survey marked as satisfied"),
    );
  } catch (err) {
    next(err);
  }
};

/**
 * Get Broadcast Status for a Survey (for assigner during active broadcast)
 * GET /api/v1/assigner/surveys/:id/broadcast-status
 */
const getBroadcastStatus = async (req, res, next) => {
  try {
    const surveyId = req.params.id;

    // Get survey details
    const survey = await db.execute_single(
      `SELECT id, status, survey_type, city, state, case_reference, 
              latitude, longitude, broadcast_ends_at, broadcast_attempt
       FROM surveys WHERE id = ?`,
      [surveyId],
    );

    if (!survey) {
      return res.status(404).json(error("Survey not found"));
    }

    // Survey is in the broadcast phase while it sits in location_detected
    const inLocationDetected = survey.status === "location_detected";

    // Get broadcast stages config
    const configs = await db.query_rows(
      "SELECT config_key, config_value FROM system_config WHERE config_key IN ('broadcast_stage_1_km', 'broadcast_stage_2_km', 'broadcast_stage_3_km', 'broadcast_duration_minutes')",
    );
    const configMap = configs.reduce(
      (acc, row) => ({ ...acc, [row.config_key]: row.config_value }),
      {},
    );

    // Calculate current radius based on attempt
    const stages = [];
    if (configMap.broadcast_stage_1_km)
      stages.push(parseFloat(configMap.broadcast_stage_1_km));
    if (configMap.broadcast_stage_2_km)
      stages.push(parseFloat(configMap.broadcast_stage_2_km));
    if (configMap.broadcast_stage_3_km)
      stages.push(parseFloat(configMap.broadcast_stage_3_km));

    const attempt = survey.broadcast_attempt || 1;
    const stageIndex = Math.min(attempt, stages.length) - 1;
    const currentRadius = stages[Math.max(0, stageIndex)] || 15;

    // Get notified surveyor count (all notifications sent for this survey)
    const notifiedResult = await db.execute_single(
      `SELECT COUNT(*) as count FROM surveyor_notifications WHERE survey_id = ?`,
      [surveyId],
    );
    const notifiedCount = notifiedResult?.count || 0;

    // Get accepted surveyor count (those who accepted and won)
    const acceptedResult = await db.execute_single(
      `SELECT COUNT(*) as count FROM surveyor_notifications WHERE survey_id = ? AND response_status = 'accepted'`,
      [surveyId],
    );
    const acceptedCount = acceptedResult?.count || 0;

    // Broadcast is "exhausted" once every attempt has run and the final timer
    // has passed with nobody assigned. After that we stop reporting it as
    // broadcasting, so the assigner's live card disappears (admin takes over).
    const stagesCount = stages.length || 3;
    const endsAtDate = survey.broadcast_ends_at ? new Date(survey.broadcast_ends_at) : null;
    const timerPassed = endsAtDate ? endsAtDate.getTime() <= Date.now() : true;
    const exhausted = inLocationDetected && attempt >= stagesCount && timerPassed && acceptedCount === 0;
    const isBroadcasting = inLocationDetected && !exhausted;

    // Calculate time remaining
    let timeRemaining = null;
    if (isBroadcasting && survey.broadcast_ends_at) {
      const now = new Date();
      const endsAt = new Date(survey.broadcast_ends_at);
      const diffMs = endsAt - now;
      if (diffMs > 0) {
        timeRemaining = Math.floor(diffMs / 1000); // seconds
      } else {
        timeRemaining = 0;
      }
    }

    res.json(
      success({
        is_broadcasting: isBroadcasting,
        broadcast_exhausted: exhausted,
        status: survey.status,
        broadcast_ends_at: survey.broadcast_ends_at,
        time_remaining_seconds: timeRemaining,
        attempt: attempt,
        radius_km: currentRadius,
        stages: stages,
        notified_count: notifiedCount,
        accepted_count: acceptedCount,
        survey_type: survey.survey_type,
        city: survey.city,
        state: survey.state,
        case_reference: survey.case_reference,
      }),
    );
  } catch (err) {
    next(err);
  }
};

/**
 * Get Route (Proxy to Google Directions API)
 * GET /api/v1/assigner/route
 */
const getRoute = async (req, res, next) => {
  try {
    const { origin, destination } = req.query;

    if (!origin || !destination) {
      return res.status(400).json(error("Origin and destination are required"));
    }

    // Falls back to the shared project key (already public in the apps) so the
    // proxy never calls Google with key=undefined if the env var is unset.
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyAbaQ3ldMRUYmxt39TdasRdU-rtPLyZVhc";
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=driving&key=${apiKey}`;

    const https = require("https");
    https
      .get(url, (apiRes) => {
        let data = "";
        apiRes.on("data", (chunk) => (data += chunk));
        apiRes.on("end", () => {
          try {
            const json = JSON.parse(data);
            res.json(json);
          } catch (e) {
            res.status(500).json(error("Failed to parse Google API response"));
          }
        });
      })
      .on("error", (e) => {
        res.status(500).json(error("Google API request failed: " + e.message));
      });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createSurvey,
  listSurveys,
  getSurvey,
  getStatusHistory,
  getSurveyPhotos,
  getSessionNotes,
  getSurveyDocuments,
  getSurveyReports,
  acceptReport,
  rejectReport,
  getSurveyorLocation,
  sendLocationSMS,
  uploadDocuments,
  deleteDocument,
  markSatisfied,
  getBroadcastStatus,
  getRoute,
  escalateSurvey,
};
