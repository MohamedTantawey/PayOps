// backend/src/middleware/piiMasker.js
const logger = require('../shared/logger');

const COMPLETE_REDACT_KEYS = new Set([
  'cvv',
  'cvc',
  'security_code',
  'card_cvv',
  'encrypted_data',
  'encrypted_credentials',
  'encrypted_creds',
  'signing_secret',
  'key_hash',
  'password',
]);

const CARD_NUMBER_KEYS = new Set([
  'card_number',
  'number',
  'pan',
  'cardNumber',
]);

const EMAIL_KEYS = new Set(['email', 'customer_email', 'customerEmail']);

// Matches raw 13-19 digit PAN sequences inside freeform strings
const RAW_PAN_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

function maskCardNumber(val) {
  const digits = String(val).replace(/\D/g, '');
  if (digits.length < 8) return '***REDACTED***';
  return `${digits.slice(0, 6)}${'*'.repeat(Math.max(4, digits.length - 10))}${digits.slice(-4)}`;
}

function maskEmail(val) {
  const str = String(val);
  const atIdx = str.indexOf('@');
  if (atIdx <= 1) return '***@***';
  return `${str[0]}***${str.slice(atIdx)}`;
}

function scrubString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(RAW_PAN_REGEX, (match) => maskCardNumber(match));
}

/**
 * Deep-clone and mask sensitive PII / PCI fields for logs
 */
function maskSensitiveData(input, { maskEmails = true } = {}) {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return scrubString(input);
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((item) => maskSensitiveData(item, { maskEmails }));
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const lowerKey = key.toLowerCase();
    if (COMPLETE_REDACT_KEYS.has(key) || COMPLETE_REDACT_KEYS.has(lowerKey)) {
      output[key] = '***REDACTED***';
    } else if (CARD_NUMBER_KEYS.has(key) || CARD_NUMBER_KEYS.has(lowerKey)) {
      output[key] = value ? maskCardNumber(value) : value;
    } else if (maskEmails && (EMAIL_KEYS.has(key) || EMAIL_KEYS.has(lowerKey))) {
      output[key] = value ? maskEmail(value) : value;
    } else if (typeof value === 'object' && value !== null) {
      output[key] = maskSensitiveData(value, { maskEmails });
    } else if (typeof value === 'string') {
      output[key] = scrubString(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**
 * Strip raw PCI fields before sending JSON responses to clients
 */
function sanitizeResponsePayload(input, { allowWebhookSigningSecret = false } = {}) {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeResponsePayload(item, { allowWebhookSigningSecret }));
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const lowerKey = key.toLowerCase();
    if (COMPLETE_REDACT_KEYS.has(key) || COMPLETE_REDACT_KEYS.has(lowerKey)) {
      if (lowerKey === 'signing_secret' && allowWebhookSigningSecret) output[key] = value;
      continue;
    }
    if (CARD_NUMBER_KEYS.has(key) || CARD_NUMBER_KEYS.has(lowerKey)) {
      output.masked_pan = maskCardNumber(value);
      continue;
    }
    output[key] = typeof value === 'object'
      ? sanitizeResponsePayload(value, { allowWebhookSigningSecret })
      : value;
  }
  return output;
}

/**
 * Express middleware: attaches masked body, sanitizes outbound JSON, and logs safely
 */
function piiMaskerMiddleware(req, res, next) {
  const start = Date.now();
  req.maskedBody = maskSensitiveData(req.body || {});

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const safeBody = sanitizeResponsePayload(body, {
      allowWebhookSigningSecret: res.locals.includeWebhookSigningSecret === true,
    });
    return originalJson(safeBody);
  };

  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/metrics') return;
    logger.info(
      {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        envMode: req.envMode || null,
        merchantId: req.merchantId || null,
        body: req.method !== 'GET' ? req.maskedBody : undefined,
      },
      'HTTP request processed'
    );
  });

  next();
}

module.exports = {
  maskSensitiveData,
  maskCardNumber,
  sanitizeResponsePayload,
  piiMaskerMiddleware,
};
