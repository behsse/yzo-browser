// Production VMP signing of packaged builds with castLabs EVS (needed for Netflix, Disney+…).
// Docs: https://github.com/castlabs/electron-releases/wiki/EVS
// Requires `python -m pip install --upgrade castlabs-evs` and an EVS account (free, personal).
// Enabled with YZO_VMP_SIGN=1; credentials come from the EVS CLI login or EVS_ACCOUNT_NAME /
// EVS_PASSWD in CI. Without it, builds keep castLabs' development VMP signature.
const { execFileSync } = require("node:child_process");

/**
 * VMP-signs the packaged app directory with the EVS CLI.
 * @param {string} appOutDir Directory containing Yzo.exe or Yzo.app (not the binary itself).
 */
function vmpSign(appOutDir) {
  if (process.env.YZO_VMP_SIGN !== "1") {
    console.warn("  • VMP signing skipped (set YZO_VMP_SIGN=1 with an EVS account for production DRM)");
    return;
  }
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "py" : "python3");
  const prefix = process.platform === "win32" && !process.env.PYTHON ? ["-3"] : [];
  console.log(`  • VMP signing ${appOutDir}`);
  execFileSync(python, [...prefix, "-m", "castlabs_evs.vmp", "--no-ask", "sign-pkg", appOutDir], { stdio: "inherit" });
}

module.exports = { vmpSign };
