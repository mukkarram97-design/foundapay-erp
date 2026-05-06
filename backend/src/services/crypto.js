// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AES-256-GCM symmetric encryption for stored credentials.
//
// Key derivation:
//   key = sha256(APP_ENCRYPTION_KEY)   — 32 bytes
//   iv  = randomBytes(12)              — 96-bit nonce per encryption
//   tag = 16-byte auth tag from GCM
//
// `APP_ENCRYPTION_KEY` MUST persist across restarts. If it changes,
// previously-stored ciphertexts can no longer be decrypted (returning
// the user to "not configured" state). Generate once at deploy and
// keep in /var/www/foundapay/backend/.env. Never log it.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const crypto = require('crypto');

function getKey() {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k || k.length < 16) {
    throw new Error('APP_ENCRYPTION_KEY missing or too short (need ≥16 chars). Set it in .env then pm2 restart.');
  }
  return crypto.createHash('sha256').update(String(k)).digest();
}

function isConfigured() {
  return !!(process.env.APP_ENCRYPTION_KEY && process.env.APP_ENCRYPTION_KEY.length >= 16);
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('hex'), ciphertext: ct.toString('hex'), tag: tag.toString('hex') };
}

function decrypt(payload) {
  if (!payload || !payload.iv || !payload.ciphertext || !payload.tag) return null;
  const key = getKey();
  const iv = Buffer.from(payload.iv, 'hex');
  const ct = Buffer.from(payload.ciphertext, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

module.exports = { encrypt, decrypt, isConfigured };
