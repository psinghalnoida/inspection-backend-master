/**
 * File Upload Middleware (Multer Configuration)
 */

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Ensure upload directories exist
const uploadDirs = ['uploads', 'uploads/documents', 'uploads/photos', 'uploads/profiles', 'uploads/reports', 'uploads/videos'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/';

    // Determine folder based on field name
    if (file.fieldname === 'profile_picture') {
      uploadPath = 'uploads/profiles/';
    } else if (
      file.fieldname === 'document' ||
      file.fieldname === 'documents' ||
      file.fieldname === 'kyc_document' ||
      file.fieldname === 'invoice_files' ||
      file.fieldname === 'gr_files' ||
      file.fieldname === 'government_id' ||
      file.fieldname === 'proof_of_address' ||
      file.fieldname === 'surveyor_license'
    ) {
      uploadPath = 'uploads/documents/';
    } else if (file.fieldname === 'photo' || file.fieldname === 'photos' || file.fieldname === 'selfie') {
      uploadPath = 'uploads/photos/';
    } else if (file.fieldname === 'video' || file.fieldname === 'videos') {
      uploadPath = 'uploads/videos/';
    } else if (file.fieldname === 'report') {
      uploadPath = 'uploads/reports/';
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  const allowedDocTypes = [...allowedImageTypes, 'application/pdf'];
  const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp'];

  let allowed = false;

  if (file.fieldname === 'photo' || file.fieldname === 'photos' || file.fieldname === 'selfie' || file.fieldname === 'profile_picture') {
    allowed = allowedImageTypes.includes(file.mimetype);
  } else if (
    file.fieldname === 'document' ||
    file.fieldname === 'documents' ||
    file.fieldname === 'kyc_document' ||
    file.fieldname === 'report' ||
    file.fieldname === 'invoice_files' ||
    file.fieldname === 'gr_files'
  ) {
    allowed = allowedDocTypes.includes(file.mimetype);
  } else if (file.fieldname === 'video' || file.fieldname === 'videos') {
    allowed = allowedVideoTypes.includes(file.mimetype);
  } else {
    // Allow all supported types for generic uploads
    allowed = [...allowedDocTypes, ...allowedVideoTypes].includes(file.mimetype);
  }

  if (allowed) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type for ${file.fieldname}. Allowed types: JPG, PNG, PDF, MP4, MOV`), false);
  }
};

// Create multer instance for images/documents
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default for images
  }
});

// Create multer instance for videos with higher file size limit
const uploadVideo = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_VIDEO_SIZE) || 100 * 1024 * 1024 // 100MB for videos
  }
});

// Upload configurations
const uploadSingle = (fieldName) => upload.single(fieldName);
const uploadMultiple = (fieldName, maxCount = 10) => upload.array(fieldName, maxCount);
const uploadFields = (fields) => upload.fields(fields);

// Specific upload middlewares
const uploadProfilePicture = upload.single('profile_picture');
const uploadDocument = upload.single('document');
const uploadKYCDocument = upload.single('kyc_document');
const uploadPhoto = upload.single('photo');
const uploadSelfie = upload.single('selfie');
const uploadReport = upload.single('report');
const uploadMultiplePhotos = upload.array('photos', 20);
const uploadMultipleDocuments = upload.array('documents', 10);
const uploadMultipleVideos = uploadVideo.array('videos', 10);

// Survey creation - supports documents, invoice files, and GR files
const uploadSurveyFiles = upload.fields([
  { name: 'documents', maxCount: 10 },      // RC, DL, Policy, FIR, Others
  { name: 'invoice_files', maxCount: 20 },  // Marine invoice files
  { name: 'gr_files', maxCount: 20 }        // Marine GR files
]);

// Surveyor registration - Profile picture and KYC document uploads
const uploadSurveyorKYC = upload.fields([
  { name: 'profile_picture', maxCount: 1 },    // Professional headshot
  { name: 'government_id', maxCount: 1 },      // Aadhar, Driver's License, etc.
  { name: 'proof_of_address', maxCount: 1 },   // Utility Bill, etc.
  { name: 'surveyor_license', maxCount: 1 }    // Optional license document
]);

module.exports = {
  upload,
  uploadVideo,
  uploadSingle,
  uploadMultiple,
  uploadFields,
  uploadProfilePicture,
  uploadDocument,
  uploadKYCDocument,
  uploadPhoto,
  uploadSelfie,
  uploadReport,
  uploadMultiplePhotos,
  uploadMultipleDocuments,
  uploadMultipleVideos,
  uploadSurveyFiles,
  uploadSurveyorKYC
};
