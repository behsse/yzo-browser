import { DICTIONARIES, t, type MessageKey } from "../lib/i18n";

/**
 * Turns an account or sync error code (electron/account.cjs, yzo-cloud API) into a user-facing
 * message in the UI locale; each known code has an `error.<code>` key in shared/locales/.
 * @param code Error code.
 * @returns Message for the UI.
 */
export function accountErrorMessage(code: string): string {
  const key = ("error." + code) as MessageKey;
  return Object.hasOwn(DICTIONARIES.en, key) ? t(key) : t("error.unknown", { code });
}
