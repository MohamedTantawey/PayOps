// backend/src/shared/crypto.js
// AES-256-GCM encryption & decryption for connector credentials and vault tokens
const crypto = require('crypto');
const config = require('./config');

const ALGO = 'aes-256-gcm';

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string} plaintext
 * @param {string} [keyHex] - 32-byte hex key (defaults to config.security.vaultEncryptionKey)
 * @returns {string} ivHex:tagHex:encryptedHex
 */
function encrypt(plaintext, keyHex = null) {
  const activeKeyHex = keyHex || config.security.vaultEncryptionKey;
  const key = Buffer.from(activeKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt ciphertext in ivHex:tagHex:encryptedHex format
 * @param {string} ciphertext
 * @param {string} [keyHex] - 32-byte hex key
 * @returns {string} Plaintext string
 */
function decrypt(ciphertext, keyHex = null) {
  const activeKeyHex = keyHex || config.security.vaultEncryptionKey;
  const key = Buffer.from(activeKeyHex, 'hex');
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  if (!ivHex || !tagHex || !encHex) {
    throw new Error('Invalid ciphertext format. Expected iv:tag:ciphertext');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

module.exports = { encrypt, decrypt };
