/** User-facing messages for account and sync error codes (electron/account.cjs, yzo-cloud API). */
const MESSAGES: Record<string, string> = {
  invalid_server: "Adresse de serveur invalide.",
  insecure_server: "Le serveur doit utiliser https (http n'est accepté que sur cet ordinateur).",
  invalid_email: "Adresse e-mail invalide.",
  weak_password: "Le mot de passe doit faire au moins 10 caractères.",
  email_taken: "Un compte existe déjà avec cette adresse.",
  wrong_credentials: "E-mail ou mot de passe incorrect.",
  vault_locked: "Impossible d'ouvrir tes données avec ce mot de passe.",
  network: "Serveur injoignable. Vérifie ta connexion ou l'adresse du serveur.",
  rate_limited: "Trop de tentatives. Réessaie dans une minute.",
  unauthorized: "Session expirée. Reconnecte-toi.",
  signed_out: "Tu n'es pas connecté.",
  quota_exceeded: "Limite de données du compte atteinte.",
  keys_failed: "Impossible d'enregistrer les clés sur le serveur.",
  delete_failed: "La suppression du compte a échoué.",
  unavailable: "Fonction indisponible.",
};

/**
 * Turns an error code into a French message.
 * @param code Error code.
 * @returns Message for the UI.
 */
export function accountErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Une erreur est survenue (" + code + ").";
}
