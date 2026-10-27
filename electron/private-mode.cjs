// Private browsing: a separate Yzo process, like Zen's private windows. Its tabs use an in-memory
// session (cookies, storage, cache and history never reach the disk), it starts from a fresh state
// and saves nothing, and it has no account, sync or extensions. Each instance gets a throwaway
// profile folder for what Chromium itself writes; folders of closed instances are deleted on the
// next launch.

const { app } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

/** Command-line flag that starts Yzo in private mode. */
const PRIVATE_FLAG = "--yzo-private";
/** Folder, inside the normal profile, holding the private instances' throwaway profiles. */
const PRIVATE_ROOT_NAME = "Private profiles";
/** File holding the running instance's process id, so live profiles are not deleted. */
const PID_FILE = "yzo-private.pid";
/** Age under which a profile is left alone: its instance may not have written its process id yet. */
const STARTUP_GRACE_MS = 60_000;

/**
 * Whether this process is a private instance.
 * @returns {boolean} True when started with the private flag.
 */
function isPrivateInstance() {
  return process.argv.includes(PRIVATE_FLAG);
}

/**
 * Folder holding the private profiles. A private instance's own profile is one of its subfolders.
 * @returns {string} Absolute path.
 */
function privateProfilesRoot() {
  const userData = app.getPath("userData");
  return isPrivateInstance() ? path.dirname(userData) : path.join(userData, PRIVATE_ROOT_NAME);
}

/**
 * Whether a process is still running.
 * @param {number} pid Process id.
 * @returns {boolean} True if alive.
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Deletes the profiles of private instances that are no longer running.
 * @param {string} root Private profiles folder.
 */
function deleteClosedPrivateProfiles(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    // A profile still starting has no process id yet.
    if (Date.now() - fs.statSync(dir).mtimeMs < STARTUP_GRACE_MS) continue;
    let pid = NaN;
    try {
      pid = Number.parseInt(fs.readFileSync(path.join(dir, PID_FILE), "utf8"), 10);
    } catch {
      // No process id: the instance never started or is long gone.
    }
    if (Number.isInteger(pid) && isProcessAlive(pid)) continue;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
  }
}

/**
 * Starts a new private instance in its own process. The Widevine CDM is copied into its profile so
 * protected video works without downloading it again.
 */
function launchPrivateInstance() {
  const root = privateProfilesRoot();
  try {
    deleteClosedPrivateProfiles(root);
  } catch (error) {
    console.warn("[private] cleanup failed:", error);
  }
  const profile = path.join(root, crypto.randomUUID());
  fs.mkdirSync(profile, { recursive: true });
  const widevine = path.join(app.getPath("userData"), "WidevineCdm");
  if (fs.existsSync(widevine)) fs.cpSync(widevine, path.join(profile, "WidevineCdm"), { recursive: true });
  // Unpackaged (dev), Electron needs the app folder; a packaged Yzo is the app itself.
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), PRIVATE_FLAG, `--user-data-dir=${profile}`];
  spawn(process.execPath, args, { detached: true, stdio: "ignore" }).unref();
}

/**
 * Marks this private instance's profile as in use, so other instances do not delete it.
 */
function claimPrivateProfile() {
  fs.writeFileSync(path.join(app.getPath("userData"), PID_FILE), String(process.pid));
}

module.exports = { isPrivateInstance, launchPrivateInstance, claimPrivateProfile };
