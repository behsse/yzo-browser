// Site details for the site menu: the certificate a host presented (shown in the system's own
// certificate window) and clearing one site's cache or cookies.

const { dialog } = require("electron");

/** Most hosts whose certificate is remembered; the oldest are dropped past it. */
const MAX_CERTIFICATES = 500;

/** @type {{ createContext: Function, freeContext: Function, viewContext: Function } | null | undefined} */
let cryptoApi;

/**
 * Loads the Windows functions that show a certificate, once. Null elsewhere or if loading fails.
 * @returns {typeof cryptoApi} Bound functions, or null.
 */
function loadCryptoApi() {
  if (cryptoApi !== undefined) return cryptoApi;
  cryptoApi = null;
  if (process.platform !== "win32") return cryptoApi;
  try {
    const koffi = require("koffi");
    const crypt32 = koffi.load("crypt32.dll");
    const cryptui = koffi.load("cryptui.dll");
    cryptoApi = {
      createContext: crypt32.func("void* __stdcall CertCreateCertificateContext(uint32_t dwCertEncodingType, const uint8_t* pbCertEncoded, uint32_t cbCertEncoded)"),
      freeContext: crypt32.func("bool __stdcall CertFreeCertificateContext(void* pCertContext)"),
      viewContext: cryptui.func(
        "bool __stdcall CryptUIDlgViewContext(uint32_t dwContextType, void* pvContext, uintptr_t hwnd, const char16_t* pwszTitle, uint32_t dwFlags, void* pvReserved)",
      ),
    };
  } catch (error) {
    console.warn("[site-info] certificate window unavailable:", error);
  }
  return cryptoApi;
}

/**
 * Decodes a PEM certificate into its DER bytes.
 * @param {string} pem PEM text.
 * @returns {Buffer} DER bytes.
 */
function pemToDer(pem) {
  return Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""), "base64");
}

/**
 * Remembers the certificates of the tabs' session and acts on one site's data.
 * @param {Electron.Session} session Tabs' session.
 */
function createSiteInfo(session) {
  /** @type {Map<string, Electron.Certificate>} */
  const certificates = new Map();

  // Chromium still decides (-3 keeps its verdict); this only records what each host presented.
  session.setCertificateVerifyProc((request, callback) => {
    certificates.delete(request.hostname);
    certificates.set(request.hostname, request.certificate);
    if (certificates.size > MAX_CERTIFICATES) certificates.delete(certificates.keys().next().value);
    callback(-3);
  });

  return {
    /**
     * Whether a certificate is known for a host.
     * @param {string} host Host name.
     * @returns {boolean} True once the host was visited over https.
     */
    hasCertificate(host) {
      return certificates.has(host);
    },

    /**
     * Opens the certificate a host presented in the system's certificate window (Windows, macOS).
     * @param {import("electron").BaseWindow} win Parent window.
     * @param {string} host Host name.
     * @returns {Promise<boolean>} False when unknown or unsupported.
     */
    async showCertificate(win, host) {
      const certificate = certificates.get(host);
      if (!certificate) return false;
      if (process.platform === "darwin") {
        await dialog.showCertificateTrustDialog(win, { certificate, message: host });
        return true;
      }
      const api = loadCryptoApi();
      if (!api) return false;
      const der = pemToDer(certificate.data);
      // X509_ASN_ENCODING | PKCS_7_ASN_ENCODING
      const context = api.createContext(0x10001, der, der.length);
      if (!context) return false;
      const handle = win.getNativeWindowHandle();
      const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
      // The window is modal: run it off the main thread so the browser keeps working behind it.
      // CERT_STORE_CERTIFICATE_CONTEXT = 1.
      await new Promise((resolve) => api.viewContext.async(1, context, hwnd, null, 0, null, () => resolve()));
      api.freeContext(context);
      return true;
    },

    /**
     * Clears what the tabs keep for one site.
     * @param {string} url Page URL.
     * @param {"cache" | "cookies"} kind Cache of the site's origin, or the cookies sent to it.
     * @returns {Promise<boolean>} False for non-web URLs.
     */
    async clear(url, kind) {
      let origin;
      try {
        origin = new URL(url).origin;
      } catch {
        return false;
      }
      if (!/^https?:/.test(origin)) return false;
      if (kind === "cache") {
        await session.clearData({ dataTypes: ["cache"], origins: [origin] });
        return true;
      }
      const cookies = await session.cookies.get({ url: origin });
      await Promise.all(
        cookies.map((cookie) => {
          const host = (cookie.domain ?? "").replace(/^\./, "");
          return session.cookies.remove(`${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`, cookie.name);
        }),
      );
      return true;
    },
  };
}

module.exports = { createSiteInfo };
