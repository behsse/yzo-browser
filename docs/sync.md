# Yzo account and sync — architecture

Status: **implemented** (client 0.5.0, yzo-cloud 0.1.0).

Goal: sign in with a Yzo account on any computer (Windows, macOS, Linux) and get the same sidebar and settings back, with end-to-end encryption. The server only ever stores data it cannot read.

The desktop client (this repository, GPL-3.0) implements everything described here. The server lives in a separate, private repository. It only stores opaque encrypted records and speaks the HTTP API below. Anyone can audit, from this repository alone, that nothing leaves the device unencrypted.

## 1. Scope

| Synced | Not synced |
|---|---|
| Spaces: name, icon, theme, order | "Today" (unpinned) tabs: each device keeps its own, like Arc |
| Favorites | Open pages, scroll positions, live tab state |
| Pinned tabs, folders, split views in the pinned section | History, archive (possible later, opt-in) |
| Settings: search engine, auto-archive delay, sidebar mode and width | Extensions (they reinstall from the Web Store) |

## 2. Components

```
┌──────────── Yzo (open source) ────────────┐        ┌──── yzo-cloud (private) ────┐
│ Renderer: store ──► sync engine            │        │ Next.js API on Vercel        │
│   records diff / merge (pure, tested)      │ HTTPS  │  Better Auth (email+password) │
│ Main process: crypto (scrypt, AES-GCM),    │◄──────►│  /api/keys, /api/sync/*      │
│   session token in OS keychain (safeStorage)│ bearer │  rate limiting, zod          │
└────────────────────────────────────────────┘        │ Prisma ─► Neon PostgreSQL    │
                                                       │  (RLS on every table)        │
                                                       └──────────────────────────────┘
```

- **Crypto and tokens live in the main process.** The renderer never sees keys or the session token. It asks the main process to encrypt, decrypt, push or pull.
- **The server is dumb storage.** It authenticates, enforces quotas and rate limits, and stores and returns ciphertext. It cannot merge, read or reorder anything.

## 3. Keys and authentication

```
password ─┐
email ────┴─► scrypt(N=2^17, r=8, p=1) ─► masterKey (32 B)       [never leaves the device]
                     masterKey ─ HKDF("yzo-auth-v1") ─► authKey  ─► sent to Better Auth as the "password"
                     masterKey ─ HKDF("yzo-wrap-v1") ─► wrapKey
random vaultKey (32 B) ─ AES-256-GCM(wrapKey)     ─► wrappedVaultKey     ┐ stored on the server
random recoveryKey     ─ AES-256-GCM(recoveryKey) ─► recoveryWrappedKey  ┘ (/api/keys)
```

- **Salt:** `sha256("yzo-v1:" + lowercase(email))`. It is deterministic so any device can derive the same keys before talking to the server.
- **What the server sees:** only `authKey`. It hashes it again (Better Auth's own scrypt) before storing. A server breach reveals neither the password nor the data.
- **Password change:** derive the new keys, re-wrap the same `vaultKey`, update the auth credential. No record has to be re-encrypted.
- **Recovery key:** 32 random bytes, shown once at sign-up as 8 groups of base32. If the password is lost, the recovery key unwraps the vault after an e-mail reset (phase 2, needs Resend). Without either, data is unrecoverable by design.
- **Device session:** the Better Auth session token comes back from sign-in (bearer plugin). It is stored encrypted with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux). The `vaultKey` is cached the same way, so restarting Yzo does not ask for the password again.

## 4. Records

The local state is projected into independent records, each encrypted separately:

| Record id | Content |
|---|---|
| `space:<id>` | name, icon, theme, pinned container id |
| `item:<id>` | one pinned-side node: tab (url, title, favicon), folder (title, collapsed) or split (orientation, factors); plus `parentId` and ordered `childrenIds` |
| `favorites` | ordered favorite ids |
| `spaceOrder` | ordered space ids |
| `settings` | settings object, sidebar mode and width |

Rules:
- Each record is serialized to JSON and compared with the last synced version (kept locally). A record is pushed only when it changed. A record that disappears locally is pushed as a **tombstone** (`deleted: true`).
- **Encryption:** `nonce (12 B) ‖ AES-256-GCM(vaultKey, json, aad = recordId)`. The additional data binds each ciphertext to its id, so the server cannot swap records.
- **Ordering:** order lives in the parent's `childrenIds`. On merge, ids that do not exist are dropped, and children whose `parentId` points to the parent but are missing from its list are appended. The tree can never be broken by a concurrent change.

## 5. Sync protocol

Server table `sync_record(user_id, record_id, ciphertext, deleted, version, updated_at)`, unique on `(user_id, record_id)`. `version` is a per-user, monotonic sequence assigned by the server.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/sign-up/email`, `/sign-in/email`, `/sign-out` | Better Auth; `password` = authKey |
| `GET /api/keys` / `PUT /api/keys` | Wrapped vault key and recovery-wrapped key (opaque) |
| `GET /api/sync/pull?since=<version>` | Records with `version > since`, max 500 per page, plus `cursor` |
| `POST /api/sync/push` | Records `[{ recordId, ciphertext, deleted, baseVersion }]` |
| `DELETE /api/account` | Deletes the account and every record (GDPR) |

**Push** is optimistic: a record is accepted only if its `baseVersion` equals the server's current version. Otherwise it is returned as a conflict.

**Client loop** (`src/sync/SyncProvider.tsx`; on startup, every 60 s, and 2 s after any synced change):
1. **Pull** every page since the stored cursor, decrypt, and merge in **one pass** (`applyRemote`). The tree repair drops items whose parent is missing, so it must see the complete set.
   - A record not changed locally since the last sync takes the remote version.
   - A record changed on both sides keeps the local version, which is then pushed over the remote one. Local changes are pushed within about 2 s, so in practice the most recent edit wins. After an offline period, the device that reconnects wins.
2. **Push** the local changes (`collectChanges`): changed or new records, plus tombstones for records that left the synced set (deleted, or moved to "today").
3. **Conflicts:** the server returns them when another device wrote first. The client pulls and retries after 1 s.

**First sync on a device:** if the account already has spaces and the local sidebar is still the untouched first-launch setup, the device adopts the account's data instead of merging a duplicate default space. Its own "today" tabs are kept.

**Limits:**
- 1 MB per request, 2,000 records per account, 64 kB per record.
- Rate limit of 60 requests per minute per account and per IP.

## 6. Server security

- Better Auth only: no hand-made authentication. Sessions are checked server-side on every route.
- Every input is validated with zod: ids, base64 sizes, versions.
- PostgreSQL RLS on every table: each query runs with `app.user_id` set, and policies restrict rows to that user. This is defense in depth on top of the `where user_id` checks.
- Secrets live in Vercel environment variables only: `DATABASE_URL`, `BETTER_AUTH_SECRET`.
- Even with a leaked database: no passwords, no keys, no readable data.

## 7. Client UI

The **Account** panel is reached from the app menu behind the logo ("Sign in", or the account entry once signed in):
- create an account or sign in;
- sync status (last sync, errors) and a "Sync now" button;
- show the recovery key again (after re-entering the password);
- sign out (wipes the local token and key);
- delete the account.

## 8. Delivery plan

1. **Server:** `yzo-cloud` (Next.js, Better Auth, Prisma/Neon, RLS, tests).
2. **Client crypto and session:** main process, `safeStorage`, IPC.
3. **Sync engine:** records, diff and merge as pure, unit-tested functions, then the push/pull loop.
4. **Account panel.**
5. **End-to-end test** against a local server, then deploy to Vercel and Neon.

Prerequisites on your side: a Neon account (project + `DATABASE_URL`), a Vercel account, and later Resend for password-reset e-mails.
