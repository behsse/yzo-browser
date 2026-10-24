// electron-builder afterSign hook. Windows must be VMP-signed AFTER code signing.
// Linux has no VMP (its Widevine CDM does not support it).
const { vmpSign } = require("./vmp.cjs");

/**
 * @param {import("electron-builder").AfterPackContext} context Packaging context.
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName === "win32") vmpSign(context.appOutDir);
};
