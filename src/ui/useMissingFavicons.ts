import { useEffect, useRef } from "react";
import type { Action } from "../state/reducer";
import { isTab } from "../state/tree";
import type { AppState, ID } from "../state/types";
import { FAVICON_BROKEN_EVENT } from "./Favicon";

/** Icon lookups running at once, so a big import does not flood the network. */
const CONCURRENCY = 3;
/** A failed lookup (network not ready at startup, slow site) is tried once more after this delay. */
const RETRY_DELAY_MS = 30_000;

/**
 * Fills in the favicon of tabs that never reported one (never opened since an import, a restore or
 * a sync): the main process finds the site's icon without loading the page in a tab. Each URL is
 * looked up at most twice per session. A stored icon that fails to load (behind a sign-in, gone) is
 * looked up again once.
 * @param state App state.
 * @param dispatch Store dispatch.
 */
export function useMissingFavicons(state: AppState, dispatch: (action: Action) => void): void {
  const attempted = useRef(new Set<string>());
  const queue = useRef<{ id: ID; url: string; retry: boolean }[]>([]);
  const running = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pump = useRef<() => void>(() => undefined);

  useEffect(() => {
    const onBroken = (event: Event) => {
      const src = (event as CustomEvent<string>).detail;
      if (attempted.current.has("broken:" + src)) return;
      attempted.current.add("broken:" + src);
      for (const item of Object.values(stateRef.current.items)) {
        if (isTab(item) && item.data.favicon === src) queue.current.push({ id: item.id, url: item.data.url || item.data.savedUrl, retry: false });
      }
      pump.current();
    };
    window.addEventListener(FAVICON_BROKEN_EVENT, onBroken);
    return () => window.removeEventListener(FAVICON_BROKEN_EVENT, onBroken);
  }, []);

  useEffect(() => {
    const resolve = window.yzo?.resolveFavicon;
    if (!resolve) return;
    for (const item of Object.values(state.items)) {
      if (!isTab(item) || item.data.favicon) continue;
      const url = item.data.url || item.data.savedUrl;
      if (!/^https?:\/\//i.test(url) || attempted.current.has(url)) continue;
      attempted.current.add(url);
      queue.current.push({ id: item.id, url, retry: true });
    }
    const next = () => {
      while (running.current < CONCURRENCY && queue.current.length) {
        const job = queue.current.shift()!;
        running.current += 1;
        void resolve(job.url)
          .then((favicon) => {
            if (favicon) dispatch({ type: "updateTab", id: job.id, favicon, now: Date.now() });
            else if (job.retry) {
              window.setTimeout(() => {
                queue.current.push({ ...job, retry: false });
                next();
              }, RETRY_DELAY_MS);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            running.current -= 1;
            next();
          });
      }
    };
    pump.current = next;
    next();
  }, [state.items, dispatch]);
}
