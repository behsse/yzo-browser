import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from "react";
import { parseState, serializeState } from "./persistence";
import { createInitialState, reducer, type Action } from "./reducer";
import type { AppState } from "./types";

const SAVE_DELAY_MS = 400;

interface StoreValue {
  state: AppState;
  dispatch: Dispatch<Action>;
}

const StoreContext = createContext<StoreValue | null>(null);

/**
 * Provides the app state, loads it from disk once and saves it (debounced) after each change.
 * Children render only after loading so the UI never flashes the default state.
 * @param props.children App tree.
 * @returns Provider element.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState(Date.now()));
  const [ready, setReady] = useState(!window.yzo);
  const saveTimer = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!window.yzo) return;
    window.yzo.loadState().then((json) => {
      const loaded = parseState(json);
      if (loaded) dispatch({ type: "hydrate", state: loaded });
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready || !window.yzo) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => window.yzo?.saveState(serializeState(state)), SAVE_DELAY_MS);
  }, [state, ready]);

  useEffect(() => {
    // Flush pending changes when the window closes.
    const flush = () => window.yzo?.saveState(serializeState(stateRef.current));
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  if (!ready) return null;
  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

/**
 * Reads the app store.
 * @returns Current state and dispatch.
 */
export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}
