// backend/src/core/vaultClient.js
const crypto = require('crypto');
const db = require('../shared/db');
const { encrypt, decrypt } = require('../shared/crypto');
const logger = require('../shared/logger');

const SEED_DETERMINISTIC_IV_PREFIX = '010101010101010101010101:';

// In test mode only these card numbers are accepted. Everything else is rejected
// at the vault boundary so fake / random card numbers never reach a connector.
const TEST_MODE_ALLOWED_CARDS = new Set([
  '4242424242424242',   // succeeds
  '4000000000000002',   // hard decline
  '4000000000009995',   // insufficient funds
]);

function luhnCheck(digits) {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function detectCardNetwork(pan) {
  const digits = String(pan).replace(/\D/g, '');
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(?:011|5)/.test(digits)) return 'discover';
  if (/^5078/.test(digits)) return 'meeza';
  return 'unknown';
}

function validateCardInput(card, envMode) {
  if (!card || typeof card !== 'object') {
    throw Object.assign(new Error('Card object is required for tokenization.'), { statusCode: 400, code: 'invalid_card' });
  }
  const digits = String(card.number || card.card_number || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    throw Object.assign(new Error('Card number must be between 13 and 19 digits.'), { statusCode: 400, code: 'invalid_card_number' });
  }
  if (!luhnCheck(digits)) {
    throw Object.assign(new Error('Invalid card number.'), { statusCode: 400, code: 'invalid_card_number' });
  }
  if (envMode === 'test' && !TEST_MODE_ALLOWED_CARDS.has(digits)) {
    throw Object.assign(new Error('Test card not recognized.'), { statusCode: 400, code: 'invalid_card_number' });
  }
  const cvv = String(card.cvv || card.cvc || '').trim();
  if (!/^\d{3,4}$/.test(cvv)) {
    throw Object.assign(new Error('CVV must be 3 or 4 digits.'), { statusCode: 400, code: 'invalid_cvv' });
  }
  return {
    number: digits,
    cvv,
    exp_month: String(card.exp_month || '12').padStart(2, '0'),
    exp_year: String(card.exp_year || '2029'),
    cardholder_name: card.cardholder_name || 'Cardholder',
  };
}

class LocalVaultProvider {
  async store({ merchantId, envMode, card }) {
    const normalized = validateCardInput(card, envMode);
    const last4 = normalized.number.slice(-4);
    const cardNetwork = detectCardNetwork(normalized.number);
    const token = `vault_tok_${envMode}_${crypto.randomUUID().replace(/-/g, '')}`;
    const encryptedData = encrypt(JSON.stringify(normalized));

    const row = await db.queryOne(
      `INSERT INTO vault_tokens (token, merchant_id, encrypted_data, last4, card_network, env_mode)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING token, last4, card_network, env_mode, created_at, expires_at`,
      [token, merchantId, encryptedData, last4, cardNetwork, envMode]
    );

    return row;
  }

  async retrieve({ token, envMode }) {
    const row = await db.queryOne(
      `SELECT token, merchant_id, encrypted_data, last4, card_network, env_mode, expires_at
       FROM vault_tokens
       WHERE token = $1 AND env_mode = $2 AND expires_at > NOW()`,
      [token, envMode]
    );

    if (!row) {
      throw Object.assign(
        new Error(`Vault token '${token}' not found or expired in '${envMode}' mode.`),
        { statusCode: 404, code: 'vault_token_not_found' }
      );
    }

    try {
      const cardData = JSON.parse(decrypt(row.encrypted_data));
      return {
        token: row.token,
        last4: row.last4,
        card_network: row.card_network,
        card: cardData,
      };
    } catch (err) {
      // Support deterministic seed token in migrations/seed.sql
      if (row.encrypted_data && row.encrypted_data.startsWith(SEED_DETERMINISTIC_IV_PREFIX)) {
        logger.debug({ token: row.token }, 'Using deterministic seed vault card fixture');
        return {
          token: row.token,
          last4: row.last4,
          card_network: row.card_network || 'visa',
          card: {
            number: `424242424242${row.last4}`,
            cvv: '424',
            exp_month: '12',
            exp_year: '2029',
            cardholder_name: 'PayOps Seed Cardholder',
          },
        };
      }
      throw Object.assign(new Error('Vault decryption integrity failure.'), {
        statusCode: 500,
        code: 'vault_decryption_error',
      });
    }
  }
}

class VaultClient {
  constructor(provider = new LocalVaultProvider()) {
    this.provider = provider;
  }

  /**
   * Register an external Bring-Your-Own-Vault (BYOV) provider (e.g. VGS, TokenEx, mTLS Vault)
   */
  setProvider(customProvider) {
    this.provider = customProvider;
  }

  async tokenize({ merchantId, envMode, card }) {
    return this.provider.store({ merchantId, envMode, card });
  }

  async detokenize(token, envMode) {
    return this.provider.retrieve({ token, envMode });
  }
}

module.exports = new VaultClient();
module.exports.VaultClient = VaultClient;
module.exports.detectCardNetwork = detectCardNetwork;
