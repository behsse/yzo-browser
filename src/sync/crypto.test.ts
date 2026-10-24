import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// electron/crypto.cjs is plain Node (no Electron import), so it is tested directly.
const require = createRequire(import.meta.url);
const crypto = require("../../electron/crypto.cjs");

// Low scrypt cost keeps the tests fast; production uses crypto.KDF (N = 2^17).
const FAST = { N: 2 ** 10, r: 8, p: 1 };

describe("key derivation", () => {
  it("is deterministic per e-mail + password and case-insensitive on the e-mail", async () => {
    const a = await crypto.deriveKeys("Me@Yzo.app", "correct horse", FAST);
    const b = await crypto.deriveKeys(" me@yzo.app ", "correct horse", FAST);
    expect(a.authKey).toBe(b.authKey);
    expect(a.authKey).toMatch(/^[0-9a-f]{64}$/);
    expect(a.wrapKey.equals(b.wrapKey)).toBe(true);
  });

  it("separates the auth key (sent) from the wrap key (kept)", async () => {
    const { authKey, wrapKey } = await crypto.deriveKeys("me@yzo.app", "pw", FAST);
    expect(authKey).not.toBe(wrapKey.toString("hex"));
  });

  it("changes with the password or the e-mail", async () => {
    const base = await crypto.deriveKeys("me@yzo.app", "pw", FAST);
    expect((await crypto.deriveKeys("me@yzo.app", "pw2", FAST)).authKey).not.toBe(base.authKey);
    expect((await crypto.deriveKeys("you@yzo.app", "pw", FAST)).authKey).not.toBe(base.authKey);
  });
});

describe("authenticated encryption", () => {
  it("round-trips and rejects tampering, wrong keys and moved records", async () => {
    const key = (await crypto.deriveKeys("me@yzo.app", "pw", FAST)).wrapKey;
    const payload = crypto.encrypt(key, '{"name":"Work"}', "space:1");
    expect(crypto.decrypt(key, payload, "space:1").toString()).toBe('{"name":"Work"}');
    expect(() => crypto.decrypt(key, payload, "space:2")).toThrow();
    const other = (await crypto.deriveKeys("me@yzo.app", "other", FAST)).wrapKey;
    expect(() => crypto.decrypt(other, payload, "space:1")).toThrow();
    const raw = Buffer.from(payload, "base64");
    raw[14] ^= 1;
    expect(() => crypto.decrypt(key, raw.toString("base64"), "space:1")).toThrow();
  });

  it("uses a fresh nonce for every encryption", async () => {
    const key = (await crypto.deriveKeys("me@yzo.app", "pw", FAST)).wrapKey;
    expect(crypto.encrypt(key, "same", "x")).not.toBe(crypto.encrypt(key, "same", "x"));
  });
});

describe("vault and recovery key", () => {
  it("opens the vault with the password and with the recovery key", async () => {
    const { wrapKey } = await crypto.deriveKeys("me@yzo.app", "pw", FAST);
    const { vaultKey, recoveryKey, bundle } = crypto.createVault(wrapKey);
    expect(crypto.openVault(wrapKey, bundle.wrappedVaultKey).equals(vaultKey)).toBe(true);
    expect(crypto.openVaultWithRecoveryKey(recoveryKey, bundle.recoveryWrappedKey).equals(vaultKey)).toBe(true);
    // Users may type it in lowercase, without dashes, with O/I instead of 0/1.
    const typed = recoveryKey.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
    expect(crypto.openVaultWithRecoveryKey(typed, bundle.recoveryWrappedKey).equals(vaultKey)).toBe(true);
  });

  it("formats 13 groups and rejects garbage", () => {
    const key = crypto.formatRecoveryKey(Buffer.alloc(32, 7));
    expect(key.split("-")).toHaveLength(13);
    expect(crypto.parseRecoveryKey(key).equals(Buffer.alloc(32, 7))).toBe(true);
    expect(() => crypto.parseRecoveryKey("not-a-key")).toThrow();
  });
});
