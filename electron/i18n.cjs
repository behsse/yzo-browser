// Main-process translations, from the same dictionaries as the UI (src/lib/i18n.ts).
const { app } = require("electron");
const DICTIONARIES = { en: require("../shared/locales/en.json"), fr: require("../shared/locales/fr.json") };

/** @type {"en" | "fr" | undefined} */
let locale;

/**
 * Picks the supported locale from the system language, once the app is ready.
 * @returns {"en" | "fr"} "fr" on French systems, otherwise "en".
 */
function currentLocale() {
  locale ??= app.getLocale().toLowerCase().split(/[-_]/)[0] === "fr" ? "fr" : "en";
  return locale;
}

/**
 * Translates a key into the app locale, replacing `{name}` placeholders with params.
 * @param {string} key Message key from shared/locales/en.json.
 * @param {Record<string, string | number>} [params] Placeholder values.
 * @returns {string} Translated text, falling back to English, then to the key.
 */
function t(key, params) {
  const template = DICTIONARIES[currentLocale()][key] ?? DICTIONARIES.en[key] ?? key;
  return params ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : template;
}

module.exports = { t };
