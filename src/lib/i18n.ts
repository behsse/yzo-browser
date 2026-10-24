import en from "../../shared/locales/en.json";
import fr from "../../shared/locales/fr.json";

/**
 * UI translations. The dictionaries in shared/locales/ are shared with the main process
 * (electron/i18n.cjs). English is the reference locale and the fallback for missing keys.
 */

export type Locale = "en" | "fr";
export type MessageKey = keyof typeof en;
export type MessageParams = Record<string, string | number>;

export const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, fr };

/**
 * Picks the supported locale for a BCP 47 language tag.
 * @param tag Language tag such as "fr-FR", or undefined.
 * @returns "fr" for French tags, otherwise "en".
 */
export function resolveLocale(tag: string | undefined | null): Locale {
  return tag?.toLowerCase().split(/[-_]/)[0] === "fr" ? "fr" : "en";
}

/**
 * Translates a key for a given locale, replacing `{name}` placeholders with params.
 * @param locale Target locale.
 * @param key Message key.
 * @param params Placeholder values.
 * @returns Translated text, the English text when the locale lacks the key, or the key itself.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const template = DICTIONARIES[locale][key] ?? DICTIONARIES.en[key] ?? key;
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : template;
}

/** Locale of this UI, read once from the language Chromium reports (it follows app.getLocale()). */
export const locale: Locale = resolveLocale(typeof navigator === "undefined" ? undefined : navigator.language);

/**
 * Translates a key into the UI locale.
 * @param key Message key.
 * @param params Placeholder values.
 * @returns Translated text.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(locale, key, params);
}
