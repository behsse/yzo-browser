import { useState, type FormEvent } from "react";
import { accountErrorMessage } from "../sync/errors";
import { useSync } from "../sync/SyncProvider";
import { Icon } from "./Icon";
import { useUi } from "./UiContext";

type Mode = "signIn" | "signUp";

/**
 * Formats how long ago the last sync happened.
 * @param timestamp Epoch ms, or null.
 * @returns Short French text.
 */
function sinceLabel(timestamp: number | null): string {
  if (!timestamp) return "jamais";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 10) return "à l'instant";
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `il y a ${minutes} min` : new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(timestamp);
}

/**
 * Yzo account panel: sign in or create an account (end-to-end encrypted sync), show the recovery
 * key once, then sync status, manual sync, sign-out and account deletion.
 * @param props.onClose Closes the panel.
 * @returns Modal overlay.
 */
export function AccountPanel({ onClose }: { onClose: () => void }) {
  const sync = useSync();
  const ui = useUi();
  const status = sync.status;
  const [mode, setMode] = useState<Mode>("signIn");
  const [serverUrl, setServerUrl] = useState(status?.serverUrl ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === "signUp" && password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    const result = mode === "signUp" ? await sync.signUp(serverUrl, email, password) : await sync.signIn(serverUrl, email, password);
    setBusy(false);
    setPassword("");
    setConfirm("");
    if (!result.ok) return setError(accountErrorMessage(result.code));
    if (result.value.recoveryKey) setRecoveryKey(result.value.recoveryKey);
    else ui.showToast("Connecté, synchronisation en cours");
  };

  const removeAccount = async () => {
    setBusy(true);
    const result = await sync.deleteAccount();
    setBusy(false);
    if (!result.ok) return setError(accountErrorMessage(result.code));
    ui.showToast("Compte supprimé");
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="panel account-panel" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Compte Yzo">
        <header className="panel-header">
          <h2>Compte Yzo</h2>
          <button title="Fermer" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        {recoveryKey ? (
          <section className="recovery">
            <p>
              <strong>Ta clé de récupération.</strong> Elle seule permet de retrouver tes données si tu oublies ton mot de passe. Personne, pas même
              nous, ne peut la régénérer. Garde-la dans un endroit sûr.
            </p>
            <code className="recovery-key">{recoveryKey}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(recoveryKey);
                ui.showToast("Clé copiée");
              }}
            >
              Copier
            </button>
            <label className="checkbox">
              <input type="checkbox" checked={savedKey} onChange={(event) => setSavedKey(event.target.checked)} />
              J'ai noté ma clé de récupération
            </label>
            <footer className="panel-footer">
              <button className="primary" disabled={!savedKey} onClick={() => setRecoveryKey(null)}>
                Continuer
              </button>
            </footer>
          </section>
        ) : status?.signedIn ? (
          <section className="account-status">
            <p>
              Connecté en tant que <strong>{status.email}</strong>
            </p>
            <p className="muted">
              {sync.syncing ? "Synchronisation…" : sync.error ? accountErrorMessage(sync.error) : `Synchronisé ${sinceLabel(sync.lastSyncAt)}`}
            </p>
            <p className="muted">Espaces, favoris, onglets épinglés et réglages sont chiffrés sur cet appareil avant l'envoi.</p>
            {!status.keychain && <p className="warning">Trousseau système indisponible : la session ne sera pas conservée après redémarrage.</p>}
            <div className="account-actions">
              <button onClick={sync.syncNow} disabled={sync.syncing}>
                <Icon name="sync" size={14} /> Synchroniser maintenant
              </button>
              <button onClick={() => void sync.signOut()}>Se déconnecter</button>
            </div>
            {deleting ? (
              <div className="danger-zone">
                <p>Tape ton adresse e-mail pour supprimer définitivement ton compte et toutes ses données sur le serveur. Les données locales restent sur cet appareil.</p>
                <input className="panel-search" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder={status.email ?? ""} />
                <div className="account-actions">
                  <button onClick={() => setDeleting(false)}>Annuler</button>
                  <button className="danger" disabled={busy || deleteConfirm.trim().toLowerCase() !== status.email} onClick={() => void removeAccount()}>
                    Supprimer définitivement
                  </button>
                </div>
              </div>
            ) : (
              <button className="danger link" onClick={() => setDeleting(true)}>
                Supprimer le compte…
              </button>
            )}
            {error && <p className="warning">{error}</p>}
          </section>
        ) : (
          <form className="account-form" onSubmit={(event) => void submit(event)}>
            <div className="mode-toggle">
              <button type="button" className={mode === "signIn" ? "picked" : ""} onClick={() => setMode("signIn")}>
                Se connecter
              </button>
              <button type="button" className={mode === "signUp" ? "picked" : ""} onClick={() => setMode("signUp")}>
                Créer un compte
              </button>
            </div>
            <p className="muted">Synchronise tes espaces, favoris, onglets épinglés et réglages entre tes ordinateurs, chiffrés de bout en bout.</p>
            <input className="panel-search" type="email" autoComplete="email" placeholder="E-mail" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
            <input
              className="panel-search"
              type="password"
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              placeholder="Mot de passe (10 caractères minimum)"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
            />
            {mode === "signUp" && (
              <input className="panel-search" type="password" autoComplete="new-password" placeholder="Confirmer le mot de passe" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
            )}
            <details>
              <summary className="muted">Serveur</summary>
              <input className="panel-search" placeholder="https://…" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} />
            </details>
            {error && <p className="warning">{error}</p>}
            <footer className="panel-footer">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Chiffrement des clés…" : mode === "signUp" ? "Créer le compte" : "Se connecter"}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
