import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AccountResult, AccountStatus } from "../env";
import { reducer } from "../state/reducer";
import { useStore } from "../state/store";
import { collectChanges, hashString, projectRecords, type RemoteRecord } from "./records";

const SYNC_INTERVAL_MS = 60_000;
const CHANGE_DEBOUNCE_MS = 2_000;
const CONFLICT_RETRY_MS = 1_000;
const MAX_PULL_PAGES = 20;

interface SyncValue {
  /** Account status from the main process (null until known). */
  status: AccountStatus | null;
  syncing: boolean;
  /** Last error code, cleared by the next successful sync. */
  error: string | null;
  lastSyncAt: number | null;
  signUp(serverUrl: string, email: string, password: string): Promise<AccountResult<{ email: string; recoveryKey: string }>>;
  signIn(serverUrl: string, email: string, password: string): Promise<AccountResult<{ email: string; recoveryKey: string | null }>>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<AccountResult<void>>;
  syncNow(): void;
}

const SyncContext = createContext<SyncValue | null>(null);

/**
 * Owns the sync loop (docs/sync.md §5): on sign-in, at startup, every 60 s and 2 s after a synced
 * change, it pulls every page from the server, merges them in one pass, then pushes local changes.
 * Keys, tokens and encryption stay in the main process; this provider only handles plaintext records.
 * @param props.children App tree.
 * @returns Provider element.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const running = useRef(false);
  const again = useRef(false);
  const retryTimer = useRef<number | undefined>(undefined);

  const refreshStatus = useCallback(async () => {
    const result = await window.yzo?.account.status();
    if (result?.ok) setStatus(result.value);
    return result?.ok ? result.value : null;
  }, []);

  const cycle = useCallback(async () => {
    const account = window.yzo?.account;
    if (!account) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setSyncing(true);
    try {
      // 1. Pull every page, then merge once (the merge's repair pass needs the complete set).
      const records: RemoteRecord[] = [];
      let cursor = stateRef.current.sync.cursor;
      for (let page = 0; page < MAX_PULL_PAGES; page++) {
        const pulled = await account.pull(cursor);
        if (!pulled.ok) throw new Error(pulled.code);
        records.push(...pulled.value.records);
        cursor = pulled.value.cursor;
        if (!pulled.value.hasMore) break;
      }
      const applied = { type: "applySync" as const, records, cursor, now: Date.now() };
      // The reducer is pure: computing the merged state here gives exactly what the store will hold.
      const merged = reducer(stateRef.current, applied);
      dispatch(applied);

      // 2. Push what differs from the server.
      const changes = collectChanges(merged, merged.sync);
      if (changes.records.length) {
        for (let i = 0; i < changes.records.length; i += 500) {
          const batch = { records: changes.records.slice(i, i + 500), hashes: changes.hashes };
          const pushed = await account.push(batch.records);
          if (!pushed.ok) throw new Error(pushed.code);
          dispatch({ type: "syncPushed", changes: batch, accepted: pushed.value.accepted, cursor: pushed.value.cursor, now: Date.now() });
          // Another device wrote first: pull its version and retry shortly.
          if (pushed.value.conflicts.length) {
            window.clearTimeout(retryTimer.current);
            retryTimer.current = window.setTimeout(() => void cycle(), CONFLICT_RETRY_MS);
          }
        }
      }
      setError(null);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "internal";
      setError(code);
      if (code === "unauthorized" || code === "signed_out") await refreshStatus();
    } finally {
      running.current = false;
      setSyncing(false);
      if (again.current) {
        again.current = false;
        void cycle();
      }
    }
  }, [dispatch, refreshStatus]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const signedIn = Boolean(status?.signedIn);
  const email = status?.email ?? null;

  // Bookkeeping belongs to one account: start fresh when another account signs in.
  useEffect(() => {
    if (signedIn && state.sync.email !== email) dispatch({ type: "resetSync", email });
  }, [signedIn, email, state.sync.email, dispatch]);

  // Periodic sync while signed in (and right away).
  useEffect(() => {
    if (!signedIn || stateRef.current.sync.email !== email) return;
    void cycle();
    const timer = window.setInterval(() => void cycle(), SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [signedIn, email, state.sync.email, cycle]);

  // Debounced sync after a change to synced data (not after tab switches or page navigation).
  const fingerprint = useMemo(() => hashString([...projectRecords(state).values()].join("\n")), [state]);
  const lastFingerprint = useRef(fingerprint);
  useEffect(() => {
    if (fingerprint === lastFingerprint.current) return;
    lastFingerprint.current = fingerprint;
    if (!signedIn) return;
    const timer = window.setTimeout(() => void cycle(), CHANGE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [fingerprint, signedIn, cycle]);

  const value = useMemo<SyncValue>(
    () => ({
      status,
      syncing,
      error,
      lastSyncAt: state.sync.lastSyncAt,
      async signUp(serverUrl, mail, password) {
        const result = await window.yzo!.account.signUp(serverUrl, mail, password);
        await refreshStatus();
        return result;
      },
      async signIn(serverUrl, mail, password) {
        const result = await window.yzo!.account.signIn(serverUrl, mail, password);
        await refreshStatus();
        return result;
      },
      async signOut() {
        await window.yzo?.account.signOut();
        dispatch({ type: "resetSync", email: null });
        await refreshStatus();
      },
      async deleteAccount() {
        const result = await window.yzo!.account.deleteAccount();
        if (result.ok) dispatch({ type: "resetSync", email: null });
        await refreshStatus();
        return result;
      },
      syncNow: () => void cycle(),
    }),
    [status, syncing, error, state.sync.lastSyncAt, refreshStatus, dispatch, cycle],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * Reads the account and sync controller.
 * @returns Status, errors and account actions.
 */
export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync must be used inside SyncProvider");
  return value;
}
