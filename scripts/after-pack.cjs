// electron-builder afterPack hook. macOS must be VMP-signed BEFORE code signing.
const { vmpSign } = require("./vmp.cjs");

/**
 * @param {import("electron-builder").AfterPackContext} context Packaging context.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName === "darwin") vmpSign(context.appOutDir);
};
