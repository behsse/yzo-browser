// End-to-end encryption primitives for Yzo sync (docs/sync.md §3–4). Pure Node crypto, no Electron,
// so it is unit-tested directly. Keys never leave the main process.
const crypto = require("node:crypto");

/** scrypt parameters; stored with the key bundle so future versions can raise them. */
const KDF = Object.freeze({ name: "scrypt", N: 2 ** 17, r: 8, p: 1, version: 1 });
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VAULT_AAD = "yzo-vault-key-v1";
// Crockford base32: no I, L, O, U, so recovery keys are easy to read and type.
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Derives the per-account keys from the e-mail and password, entirely on the device.
 * @param {string} email Account e-mail (normalized to lowercase for the salt).
 * @param {string} password User's real password; never sent anywhere.
 * @param {{ N: number, r: number, p: number }} [kdf] scrypt cost parameters.
 * @returns {Promise<{ authKey: string, wrapKey: Buffer }>} authKey (64 hex chars, sent to the
 *   server as the "password") and wrapKey (wraps the vault key, never sent).
 */
async function deriveKeys(email, password, kdf = KDF) {
  const salt = crypto.createHash("sha256").update("yzo-v1:" + email.trim().toLowerCase()).digest();
  const masterKey = await new Promise((resolve, reject) =>
    crypto.scrypt(password.normalize("NFKC"), salt, KEY_BYTES, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 512 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
  const authKey = Buffer.from(crypto.hkdfSync("sha256", masterKey, Buffer.alloc(0), "yzo-auth-v1", KEY_BYTES)).toString("hex");
  const wrapKey = Buffer.from(crypto.hkdfSync("sha256", masterKey, Buffer.alloc(0), "yzo-wrap-v1", KEY_BYTES));
  masterKey.fill(0);
  return { authKey, wrapKey };
}

/**
 * Encrypts with AES-256-GCM. The additional data binds the ciphertext to its context (record id,
 * vault key) so it cannot be moved elsewhere unnoticed.
 * @param {Buffer} key 32-byte key.
 * @param {Buffer | string} plaintext Data to encrypt.
 * @param {string} aad Additional authenticated data.
 * @returns {string} base64(nonce ‖ ciphertext ‖ tag).
 */
function encrypt(key, plaintext, aad) {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
}

/**
 * Decrypts and authenticates an encrypt() output.
 * @param {Buffer} key 32-byte key.
 * @param {string} payload base64(nonce ‖ ciphertext ‖ tag).
 * @param {string} aad Additional data used at encryption.
 * @returns {Buffer} Plaintext.
 * @throws When the key, data or additional data does not match (tampering or wrong password).
 */
function decrypt(key, payload, aad) {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < NONCE_BYTES + TAG_BYTES) throw new Error("ciphertext too short");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, NONCE_BYTES));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
}

/**
 * Creates a fresh vault and its two wrapped copies (password and recovery key).
 * @param {Buffer} wrapKey Password-derived wrap key.
 * @returns {{ vaultKey: Buffer, recoveryKey: string, bundle: { wrappedVaultKey: string, recoveryWrappedKey: string, kdf: typeof KDF } }}
 */
function createVault(wrapKey) {
  const vaultKey = crypto.randomBytes(KEY_BYTES);
  const recoveryBytes = crypto.randomBytes(KEY_BYTES);
  return {
    vaultKey,
    recoveryKey: formatRecoveryKey(recoveryBytes),
    bundle: {
      wrappedVaultKey: encrypt(wrapKey, vaultKey, VAULT_AAD),
      recoveryWrappedKey: encrypt(recoveryBytes, vaultKey, VAULT_AAD),
      kdf: KDF,
    },
  };
}

/**
 * Unwraps the vault key with the password-derived key.
 * @param {Buffer} wrapKey Password-derived wrap key.
 * @param {string} wrappedVaultKey Wrapped key from the server.
 * @returns {Buffer} Vault key.
 */
function openVault(wrapKey, wrappedVaultKey) {
  return decrypt(wrapKey, wrappedVaultKey, VAULT_AAD);
}

/**
 * Unwraps the vault key with the recovery key (lost password).
 * @param {string} recoveryKey Recovery key as shown to the user (spaces/dashes ignored).
 * @param {string} recoveryWrappedKey Recovery-wrapped key from the server.
 * @returns {Buffer} Vault key.
 */
function openVaultWithRecoveryKey(recoveryKey, recoveryWrappedKey) {
  return decrypt(parseRecoveryKey(recoveryKey), recoveryWrappedKey, VAULT_AAD);
}

/**
 * Formats 32 bytes as Crockford base32 in groups of 4 (13 groups).
 * @param {Buffer} bytes Recovery key bytes.
 * @returns {string} e.g. "7Q2M-…".
 */
function formatRecoveryKey(bytes) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  bits = bits.padEnd(Math.ceil(bits.length / 5) * 5, "0");
  let text = "";
  for (let i = 0; i < bits.length; i += 5) text += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return text.match(/.{1,4}/g).join("-");
}

/**
 * Parses a recovery key typed by the user back into bytes.
 * @param {string} text Recovery key, any case, with or without separators.
 * @returns {Buffer} 32 bytes.
 * @throws On invalid characters or length.
 */
function parseRecoveryKey(text) {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  let bits = "";
  for (const char of clean) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error("invalid recovery key");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length && bytes.length < KEY_BYTES; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  if (bytes.length !== KEY_BYTES) throw new Error("invalid recovery key");
  return Buffer.from(bytes);
}

module.exports = { KDF, deriveKeys, encrypt, decrypt, createVault, openVault, openVaultWithRecoveryKey, formatRecoveryKey, parseRecoveryKey };
