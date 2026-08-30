// validator.js — Production Input Limits & Safe Error Handling Utility
// Validates text, numeric, date/time, and enum inputs across backend APIs.
// Sanitizes error responses to prevent exposing technical/database stack traces to end users.

const LIMITS = {
  PERSON_NAME: 60,
  BMC_NAME: 100,
  BMC_CODE: 30,
  ROUTE_NAME: 100,
  TANKER_NO: 20,
  EMAIL: 254,
  INVOICE_SERIAL: 30,
  SEAL_NO: 30,
  BROKEN_SEAL_NO: 30,
  REPORT: 1000,
  REMARKS: 500,
  ADDRESS_LOCATION: 200,
  GENERAL_TEXT: 300,

  RATING_MIN: 1,
  RATING_MAX: 5,
  TEMP_MIN: -10,
  TEMP_MAX: 100,
  WEIGHT_MIN: 0,
  WEIGHT_MAX: 100000, // 100,000 KG
  KM_MIN: 0,
  KM_MAX: 10000000,   // 10,000,000 KM
  PERCENT_MIN: 0,
  PERCENT_MAX: 100,   // Lactometer, FAT %, SNF %, COB %
  PH_MIN: 0,
  PH_MAX: 14,
  LAT_MIN: -90,
  LAT_MAX: 90,
  LNG_MIN: -180,
  LNG_MAX: 180
};

/**
 * Validates a text field length. Returns error string or null if valid.
 */
function validateText(val, fieldName, maxLen = LIMITS.GENERAL_TEXT, required = false) {
  if (val === undefined || val === null || String(val).trim() === '') {
    if (required) return `${fieldName} is required.`;
    return null;
  }

  const str = String(val).trim();
  if (str.length > maxLen) {
    return `${fieldName} exceeds maximum length of ${maxLen} characters.`;
  }
  return null;
}

/**
 * Validates a numeric value range. Returns error string or null if valid.
 */
function validateNumber(val, fieldName, min = 0, max = Number.MAX_SAFE_INTEGER, required = false) {
  if (val === undefined || val === null || val === '') {
    if (required) return `${fieldName} is required.`;
    return null;
  }

  const num = Number(val);
  if (isNaN(num)) {
    return `${fieldName} must be a valid number.`;
  }
  if (num < min || num > max) {
    return `${fieldName} must be between ${min} and ${max}.`;
  }
  return null;
}

/**
 * Validates an enum string value. Returns error string or null if valid.
 */
function validateEnum(val, fieldName, allowedValues = [], required = false) {
  if (val === undefined || val === null || String(val).trim() === '') {
    if (required) return `${fieldName} is required.`;
    return null;
  }

  const str = String(val).trim();
  if (!allowedValues.includes(str)) {
    return `Invalid ${fieldName}. Allowed values: ${allowedValues.join(', ')}.`;
  }
  return null;
}

/**
 * Validates date / time inputs. Returns error string or null if valid.
 */
function validateDateTime(val, fieldName, required = false) {
  if (val === undefined || val === null || String(val).trim() === '') {
    if (required) return `${fieldName} is required.`;
    return null;
  }

  const d = new Date(val);
  if (isNaN(d.getTime())) {
    return `${fieldName} must be a valid date/time.`;
  }
  return null;
}

/**
 * Sanitizes backend API error responses.
 * Logs full technical details on server console while returning user-friendly text to client.
 */
function sendErrorResponse(res, statusCode = 500, userMessage = 'An unexpected error occurred. Please try again.', errDetail = null) {
  if (errDetail) {
    console.error(`[API Error ${statusCode}]`, errDetail);
  }
  
  // Clean up user message to prevent exposing technical details
  let cleanMessage = userMessage;
  if (typeof userMessage === 'string' && (userMessage.includes('supabase') || userMessage.includes('postgrest') || userMessage.includes('SELECT') || userMessage.includes('INSERT') || userMessage.includes('UPDATE'))) {
    cleanMessage = 'Database operation failed. Please check your input and try again.';
  }

  return res.status(statusCode).json({
    success: false,
    error: cleanMessage
  });
}

module.exports = {
  LIMITS,
  validateText,
  validateNumber,
  validateEnum,
  validateDateTime,
  sendErrorResponse
};
