import { useState, type FormEvent } from "react";
import { locale, t } from "../lib/i18n";
import { accountErrorMessage } from "../sync/errors";
import { useSync } from "../sync/SyncProvider";
import { Icon } from "./Icon";
import { useUi, type AccountMode } from "./UiContext";

/**
 * Formats how long ago the last sync happened.
 * @param timestamp Epoch ms, or null.
 * @returns Short text in the UI locale.
 */
function sinceLabel(timestamp: number | null): string {
  if (!timestamp) return t("account.since.never");
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 10) return t("account.since.now");
  if (seconds < 60) return t("account.since.seconds", { n: seconds });
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? t("account.since.minutes", { n: minutes }) : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(timestamp);
}

/**
 * Yzo account panel: sign in or create an account (end-to-end encrypted sync), show the recovery
 * key once, then sync status, manual sync, sign-out and account deletion.
 * @param props.initialMode Form shown first when signed out.
 * @param props.onClose Closes the panel.
 * @returns Modal overlay.
 */
export function AccountPanel({ initialMode = "signIn", onClose }: { initialMode?: AccountMode; onClose: () => void }) {
  const sync = useSync();
  const ui = useUi();
  const status = sync.status;
  const [mode, setMode] = useState<AccountMode>(initialMode);
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
    if (mode === "signUp" && password !== confirm) return setError(t("account.passwordMismatch"));
    setBusy(true);
    const result = mode === "signUp" ? await sync.signUp(serverUrl, email, password) : await sync.signIn(serverUrl, email, password);
    setBusy(false);
    setPassword("");
    setConfirm("");
    if (!result.ok) return setError(accountErrorMessage(result.code));
    if (result.value.recoveryKey) setRecoveryKey(result.value.recoveryKey);
    else ui.showToast(t("account.signedInToast"));
  };

  const removeAccount = async () => {
    setBusy(true);
    const result = await sync.deleteAccount();
    setBusy(false);
    if (!result.ok) return setError(accountErrorMessage(result.code));
    ui.showToast(t("account.deletedToast"));
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="panel account-panel" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label={t("account.title")}>
        <header className="panel-header">
          <h2>{t("account.title")}</h2>
          <button title={t("common.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        {recoveryKey ? (
          <section className="recovery">
            <p>
              <strong>{t("account.recoveryTitle")}</strong> {t("account.recoveryText")}
            </p>
            <code className="recovery-key">{recoveryKey}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(recoveryKey);
                ui.showToast(t("account.keyCopied"));
              }}
            >
              {t("common.copy")}
            </button>
            <label className="checkbox">
              <input type="checkbox" checked={savedKey} onChange={(event) => setSavedKey(event.target.checked)} />
              {t("account.keySaved")}
            </label>
            <footer className="panel-footer">
              <button className="primary" disabled={!savedKey} onClick={() => setRecoveryKey(null)}>
                {t("account.continue")}
              </button>
            </footer>
          </section>
        ) : status?.signedIn ? (
          <section className="account-status">
            <p>
              {t("account.signedInAs")} <strong>{status.email}</strong>
            </p>
            <p className="muted">
              {sync.syncing ? t("account.syncing") : sync.error ? accountErrorMessage(sync.error) : t("account.syncedSince", { since: sinceLabel(sync.lastSyncAt) })}
            </p>
            <p className="muted">{t("account.encryptedNote")}</p>
            {!status.keychain && <p className="warning">{t("account.noKeychain")}</p>}
            <div className="account-actions">
              <button onClick={sync.syncNow} disabled={sync.syncing}>
                <Icon name="sync" size={16} /> {t("account.syncNow")}
              </button>
              <button onClick={() => void sync.signOut()}>{t("account.signOut")}</button>
            </div>
            {deleting ? (
              <div className="danger-zone">
                <p>{t("account.deleteConfirmText")}</p>
                <input className="panel-search" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder={status.email ?? ""} />
                <div className="account-actions">
                  <button onClick={() => setDeleting(false)}>{t("common.cancel")}</button>
                  <button className="danger" disabled={busy || deleteConfirm.trim().toLowerCase() !== status.email} onClick={() => void removeAccount()}>
                    {t("account.deleteForever")}
                  </button>
                </div>
              </div>
            ) : (
              <button className="danger link" onClick={() => setDeleting(true)}>
                {t("account.deleteAccount")}
              </button>
            )}
            {error && <p className="warning">{error}</p>}
          </section>
        ) : (
          <form className="account-form" onSubmit={(event) => void submit(event)}>
            <div className="mode-toggle">
              <button type="button" className={mode === "signIn" ? "picked" : ""} onClick={() => setMode("signIn")}>
                {t("account.signIn")}
              </button>
              <button type="button" className={mode === "signUp" ? "picked" : ""} onClick={() => setMode("signUp")}>
                {t("account.signUp")}
              </button>
            </div>
            <p className="muted">{t("account.pitch")}</p>
            <input className="panel-search" type="email" autoComplete="email" placeholder={t("account.email")} value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
            <input
              className="panel-search"
              type="password"
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              placeholder={t("account.password")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
            />
            {mode === "signUp" && (
              <input className="panel-search" type="password" autoComplete="new-password" placeholder={t("account.confirmPassword")} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
            )}
            <details>
              <summary className="muted">{t("account.server")}</summary>
              <input className="panel-search" placeholder="https://…" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} />
            </details>
            {error && <p className="warning">{error}</p>}
            <footer className="panel-footer">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? t("account.encryptingKeys") : mode === "signUp" ? t("account.createAccount") : t("account.signIn")}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
