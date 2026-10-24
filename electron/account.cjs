// Yzo account: sign-up / sign-in against the sync server, session and vault key kept in the main
// process and stored encrypted with the OS keychain (Electron safeStorage). The UI renderer only gets
// account status and plaintext records it owns; it never sees keys or the session token.
const { safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("./crypto.cjs");

/** Trusted origin declared to the server's Better Auth CSRF check (yzo-cloud src/lib/auth.ts). */
const DESKTOP_ORIGIN = "yzo://app";
const REQUEST_TIMEOUT_MS = 20_000;

class AccountError extends Error {
  /**
   * @param {string} code Stable error code shown to the UI.
   * @param {string} [message] Details.
   */
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

/**
 * Validates a sync server URL: https anywhere, http only on the local machine (development).
 * @param {unknown} value Candidate URL.
 * @returns {string} Normalized origin without trailing slash.
 */
function normalizeServerUrl(value) {
  if (typeof value !== "string") throw new AccountError("invalid_server");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AccountError("invalid_server");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new AccountError("insecure_server");
  return url.origin;
}

/**
 * Creates the account manager.
 * @param {{ userDataPath: string, defaultServerUrl: string }} options Storage folder and default server.
 */
function createAccount({ userDataPath, defaultServerUrl }) {
  const file = path.join(userDataPath, "yzo-account.bin");
  /** @type {{ serverUrl: string, email: string, token: string, vaultKey: Buffer } | null} */
  let session = null;
  let serverUrl = defaultServerUrl;

  /** Persists the session encrypted by the OS keychain; skipped when no keychain is available. */
  const save = () => {
    if (!session || !safeStorage.isEncryptionAvailable()) return;
    const json = JSON.stringify({ ...session, vaultKey: session.vaultKey.toString("base64") });
    fs.writeFileSync(file, safeStorage.encryptString(json), { mode: 0o600 });
  };

  /** Restores a saved session at startup. */
  const load = () => {
    try {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file)) return;
      const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      session = { ...data, vaultKey: Buffer.from(data.vaultKey, "base64") };
      serverUrl = session.serverUrl;
    } catch {
      session = null;
    }
  };

  /** Forgets the session in memory and on disk. */
  const clear = () => {
    session?.vaultKey.fill(0);
    session = null;
    fs.rmSync(file, { force: true });
  };

  /**
   * Calls the sync server.
   * @param {string} base Server origin.
   * @param {string} route API path.
   * @param {{ method?: string, body?: unknown, token?: string }} [options] Request options.
   * @returns {Promise<{ status: number, json: any, headers: Headers }>} Response.
   */
  const request = async (base, route, { method = "GET", body, token } = {}) => {
    let response;
    try {
      response = await fetch(base + route, {
        method,
        headers: {
          origin: DESKTOP_ORIGIN,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new AccountError("network");
    }
    const json = await response.json().catch(() => null);
    if (response.status === 401) {
      if (token) clear();
      throw new AccountError("unauthorized");
    }
    if (response.status === 429) throw new AccountError("rate_limited");
    return { status: response.status, json, headers: response.headers };
  };

  /**
   * Authenticated call; requires a session.
   * @param {string} route API path.
   * @param {{ method?: string, body?: unknown }} [options] Request options.
   */
  const authed = (route, options = {}) => {
    if (!session) throw new AccountError("signed_out");
    return request(session.serverUrl, route, { ...options, token: session.token });
  };

  /**
   * Checks the e-mail and password inputs.
   * @param {unknown} email E-mail.
   * @param {unknown} password Password.
   * @returns {{ email: string, password: string }} Validated values.
   */
  const credentials = (email, password) => {
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) throw new AccountError("invalid_email");
    if (typeof password !== "string" || password.length < 10 || password.length > 1024) throw new AccountError("weak_password");
    return { email: email.trim().toLowerCase(), password };
  };

  /**
   * Creates and uploads a new vault for the signed-in account.
   * @param {Buffer} wrapKey Password-derived wrap key.
   * @returns {Promise<{ vaultKey: Buffer, recoveryKey: string }>} Vault key and recovery key.
   */
  const setupVault = async (base, token, wrapKey) => {
    const { vaultKey, recoveryKey, bundle } = crypto.createVault(wrapKey);
    const res = await request(base, "/api/keys", { method: "PUT", body: bundle, token });
    if (res.status !== 200) throw new AccountError("keys_failed");
    return { vaultKey, recoveryKey };
  };

  load();

  return {
    /** @returns {{ signedIn: boolean, email: string | null, serverUrl: string, keychain: boolean }} */
    status() {
      return { signedIn: Boolean(session), email: session?.email ?? null, serverUrl, keychain: safeStorage.isEncryptionAvailable() };
    },

    /**
     * Creates an account. Returns the recovery key, to show once.
     * @param {unknown} serverUrlInput Server URL.
     * @param {unknown} emailInput E-mail.
     * @param {unknown} passwordInput Password (stays on the device).
     */
    async signUp(serverUrlInput, emailInput, passwordInput) {
      const base = normalizeServerUrl(serverUrlInput);
      const { email, password } = credentials(emailInput, passwordInput);
      const { authKey, wrapKey } = await crypto.deriveKeys(email, password);
      const res = await request(base, "/api/auth/sign-up/email", { method: "POST", body: { email, password: authKey, name: email } });
      if (res.status !== 200) throw new AccountError(res.json?.code === "USER_ALREADY_EXISTS" ? "email_taken" : "sign_up_failed", res.json?.message);
      const token = res.headers.get("set-auth-token");
      if (!token) throw new AccountError("sign_up_failed", "no session token");
      const { vaultKey, recoveryKey } = await setupVault(base, token, wrapKey);
      session = { serverUrl: base, email, token, vaultKey };
      serverUrl = base;
      save();
      return { email, recoveryKey };
    },

    /**
     * Signs in and unlocks the vault.
     * @param {unknown} serverUrlInput Server URL.
     * @param {unknown} emailInput E-mail.
     * @param {unknown} passwordInput Password (stays on the device).
     * @returns {Promise<{ email: string, recoveryKey: string | null }>} recoveryKey only when a vault had to be created.
     */
    async signIn(serverUrlInput, emailInput, passwordInput) {
      const base = normalizeServerUrl(serverUrlInput);
      const { email, password } = credentials(emailInput, passwordInput);
      const { authKey, wrapKey } = await crypto.deriveKeys(email, password);
      const res = await request(base, "/api/auth/sign-in/email", { method: "POST", body: { email, password: authKey } });
      if (res.status !== 200) throw new AccountError("wrong_credentials");
      const token = res.headers.get("set-auth-token");
      if (!token) throw new AccountError("sign_in_failed", "no session token");
      const keys = await request(base, "/api/keys", { token });
      let vaultKey;
      let recoveryKey = null;
      if (keys.status === 404) ({ vaultKey, recoveryKey } = await setupVault(base, token, wrapKey));
      else if (keys.status === 200) {
        try {
          vaultKey = crypto.openVault(wrapKey, keys.json.wrappedVaultKey);
        } catch {
          throw new AccountError("vault_locked");
        }
      } else throw new AccountError("keys_failed");
      session = { serverUrl: base, email, token, vaultKey };
      serverUrl = base;
      save();
      return { email, recoveryKey };
    },

    /** Ends the session on the server (best effort) and forgets it locally. */
    async signOut() {
      if (session) await authed("/api/auth/sign-out", { method: "POST", body: {} }).catch(() => {});
      clear();
    },

    /** Deletes the account and all its data on the server, then signs out. */
    async deleteAccount() {
      const res = await authed("/api/account", { method: "DELETE" });
      if (res.status !== 200) throw new AccountError("delete_failed");
      clear();
    },

    /**
     * Encrypts and uploads records.
     * @param {unknown} records [{ recordId, json, deleted, baseVersion }] from the renderer.
     * @returns {Promise<{ accepted: {recordId: string, version: number}[], conflicts: {recordId: string, version: number}[], cursor: number }>}
     */
    async push(records) {
      if (!session) throw new AccountError("signed_out");
      if (!Array.isArray(records) || records.length === 0 || records.length > 500) throw new AccountError("invalid_records");
      const vaultKey = session.vaultKey;
      const body = {
        records: records.map((r) => {
          if (typeof r?.recordId !== "string" || typeof r.baseVersion !== "number" || (!r.deleted && typeof r.json !== "string")) throw new AccountError("invalid_records");
          return { recordId: r.recordId, deleted: Boolean(r.deleted), baseVersion: r.baseVersion, ciphertext: r.deleted ? "" : crypto.encrypt(vaultKey, r.json, r.recordId) };
        }),
      };
      const res = await authed("/api/sync/push", { method: "POST", body });
      if (res.status !== 200) throw new AccountError(res.json?.error ?? "push_failed");
      return res.json;
    },

    /**
     * Downloads and decrypts records changed after a cursor. Records that fail authentication
     * (tampered or foreign) are skipped and reported.
     * @param {unknown} since Cursor.
     * @returns {Promise<{ records: { recordId: string, json: string | null, deleted: boolean, version: number }[], cursor: number, hasMore: boolean, rejected: number }>}
     */
    async pull(since) {
      if (!session) throw new AccountError("signed_out");
      const cursor = Number.isInteger(since) && since >= 0 ? since : 0;
      const res = await authed(`/api/sync/pull?since=${cursor}`);
      if (res.status !== 200) throw new AccountError(res.json?.error ?? "pull_failed");
      let rejected = 0;
      const records = [];
      for (const r of res.json.records) {
        if (r.deleted) {
          records.push({ recordId: r.recordId, json: null, deleted: true, version: r.version });
          continue;
        }
        try {
          records.push({ recordId: r.recordId, json: crypto.decrypt(session.vaultKey, r.ciphertext, r.recordId).toString("utf8"), deleted: false, version: r.version });
        } catch {
          rejected += 1;
        }
      }
      return { records, cursor: res.json.cursor, hasMore: res.json.hasMore, rejected };
    },
  };
}

module.exports = { createAccount, AccountError, normalizeServerUrl };
