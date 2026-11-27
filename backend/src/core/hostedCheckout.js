<<<<<<< HEAD
const crypto = require('crypto');
const db = require('../shared/db');

const CHECKOUT_TTL_MS = 30 * 60 * 1000;

function validateRedirectUrl(value, allowedOrigins = process.env.CHECKOUT_ALLOWED_ORIGINS || '') {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error('Both return_url and cancel_url are required for hosted checkout.'), {
      statusCode: 400,
      code: 'invalid_checkout_redirect',
    });
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error('Checkout redirect URLs must be valid absolute URLs.'), {
      statusCode: 400,
      code: 'invalid_checkout_redirect',
    });
  }

  const origins = allowedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    !origins.includes(url.origin)
  ) {
    throw Object.assign(new Error('Checkout redirect origin is not allowed.'), {
      statusCode: origins.length ? 400 : 503,
      code: origins.length ? 'checkout_redirect_not_allowed' : 'checkout_redirects_not_configured',
    });
  }
  return url.toString();
}

function hashCheckoutSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function checkoutSecretMatches(secret, expectedHash) {
  if (typeof secret !== 'string' || !secret || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  const supplied = Buffer.from(hashCheckoutSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function createHostedCheckout(intentId, returnUrl, cancelUrl) {
  const safeReturnUrl = validateRedirectUrl(returnUrl);
  const safeCancelUrl = validateRedirectUrl(cancelUrl);
  const secret = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);

  await db.queryOne(
    `INSERT INTO checkout_sessions (intent_id, secret_hash, return_url, cancel_url, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING intent_id`,
    [intentId, hashCheckoutSecret(secret), safeReturnUrl, safeCancelUrl, expiresAt]
  );

  return { payPath: `/checkout/${intentId}#${secret}`, expiresAt };
}

async function findHostedCheckout(intentId, secret) {
  const row = await db.queryOne(
    `SELECT cs.secret_hash, cs.return_url, cs.cancel_url, cs.expires_at,
            pi.id, pi.merchant_id, pi.env_mode, pi.amount_cents, pi.currency,
            pi.capture_method, pi.attempt_count, pi.metadata, pi.status,
            pi.customer_email, pi.description
     FROM checkout_sessions cs
     JOIN payment_intents pi ON pi.id = cs.intent_id
     WHERE cs.intent_id = $1`,
    [intentId]
  );

  if (!row || !checkoutSecretMatches(secret, row.secret_hash)) return null;
  return row;
}

module.exports = {
  CHECKOUT_TTL_MS,
  validateRedirectUrl,
  hashCheckoutSecret,
  checkoutSecretMatches,
  createHostedCheckout,
  findHostedCheckout,
};
=======
const crypto = require('crypto');
const db = require('../shared/db');

const CHECKOUT_TTL_MS = 30 * 60 * 1000;

function validateRedirectUrl(value, allowedOrigins = process.env.CHECKOUT_ALLOWED_ORIGINS || '') {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error('Both return_url and cancel_url are required for hosted checkout.'), {
      statusCode: 400,
      code: 'invalid_checkout_redirect',
    });
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error('Checkout redirect URLs must be valid absolute URLs.'), {
      statusCode: 400,
      code: 'invalid_checkout_redirect',
    });
  }

  const origins = allowedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    !origins.includes(url.origin)
  ) {
    throw Object.assign(new Error('Checkout redirect origin is not allowed.'), {
      statusCode: origins.length ? 400 : 503,
      code: origins.length ? 'checkout_redirect_not_allowed' : 'checkout_redirects_not_configured',
    });
  }
  return url.toString();
}

function hashCheckoutSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function checkoutSecretMatches(secret, expectedHash) {
  if (typeof secret !== 'string' || !secret || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  const supplied = Buffer.from(hashCheckoutSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function createHostedCheckout(intentId, returnUrl, cancelUrl) {
  const safeReturnUrl = validateRedirectUrl(returnUrl);
  const safeCancelUrl = validateRedirectUrl(cancelUrl);
  const secret = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);

  await db.queryOne(
    `INSERT INTO checkout_sessions (intent_id, secret_hash, return_url, cancel_url, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING intent_id`,
    [intentId, hashCheckoutSecret(secret), safeReturnUrl, safeCancelUrl, expiresAt]
  );

  return { payPath: `/checkout/${intentId}#${secret}`, expiresAt };
}

async function findHostedCheckout(intentId, secret) {
  const row = await db.queryOne(
    `SELECT cs.secret_hash, cs.return_url, cs.cancel_url, cs.expires_at,
            pi.id, pi.merchant_id, pi.env_mode, pi.amount_cents, pi.currency,
            pi.capture_method, pi.attempt_count, pi.metadata, pi.status,
            pi.customer_email, pi.description
     FROM checkout_sessions cs
     JOIN payment_intents pi ON pi.id = cs.intent_id
     WHERE cs.intent_id = $1`,
    [intentId]
  );

  if (!row || !checkoutSecretMatches(secret, row.secret_hash)) return null;
  return row;
}

module.exports = {
  CHECKOUT_TTL_MS,
  validateRedirectUrl,
  hashCheckoutSecret,
  checkoutSecretMatches,
  createHostedCheckout,
  findHostedCheckout,
};
>>>>>>> origin/payops-control
