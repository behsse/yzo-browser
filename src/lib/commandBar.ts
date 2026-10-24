import { isTab } from "../state/tree";
import type { AppState, ID, SidebarItem, SuggestionKind } from "../state/types";
import { buildSearchUrl, displayHost, looksLikeUrl, toNavigableUrl } from "./url";

/**
 * Hosts whose pages are deduplicated by title + host instead of full URL. Taken from the
 * `dedupByTitleAndHostList` shipped in Arc's command_bar_behavior.json (re/…§4.2): apps whose URLs
 * carry volatile state (Figma, Notion, Maps…) would otherwise flood the list with one page.
 */
export const DEDUP_BY_TITLE_AND_HOST = [
  "figma.com",
  "maps.google.com",
  "notion.so",
  "app.notion.com",
  "zoom.us",
  "opentable.com",
  "zillow.com",
  "github.com",
  "app.mode.com",
  "console.cloud.google.com",
];

export const MAX_SUGGESTIONS = 8;

export interface Suggestion {
  kind: SuggestionKind;
  /** Stable React key and dedup identity. */
  key: string;
  title: string;
  url: string;
  favicon: string | null;
  /** Tab to switch to, for kind "tab". */
  tabId?: ID;
}

/**
 * Computes the identity used to merge duplicate suggestions.
 * @param url Page URL.
 * @param title Page title.
 * @returns "host|title" for hosts in the dedup list, otherwise the URL without its fragment.
 */
export function dedupKey(url: string, title: string): string {
  const host = displayHost(url);
  if (DEDUP_BY_TITLE_AND_HOST.some((h) => host === h || host.endsWith("." + h))) {
    return `${host}|${title.trim().toLowerCase()}`;
  }
  return url.replace(/#.*$/, "");
}

/**
 * Scores how well a text matches every query token; 0 means no match.
 * Title prefix matches beat substring matches, and host matches beat path matches.
 * @param tokens Lower-cased query tokens.
 * @param title Candidate title.
 * @param url Candidate URL.
 * @returns Match score.
 */
export function matchScore(tokens: string[], title: string, url: string): number {
  if (!tokens.length) return 1;
  const t = title.toLowerCase();
  const host = displayHost(url).toLowerCase();
  const u = url.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (host.startsWith(token)) score += 6;
    else if (t.startsWith(token) || t.includes(" " + token)) score += 5;
    else if (host.includes(token)) score += 4;
    else if (t.includes(token)) score += 3;
    else if (u.includes(token)) score += 1;
    else return 0;
  }
  return score;
}

/**
 * Builds the ranked command bar suggestions: open tabs of the current space (switch to), history,
 * a direct URL when the input looks like one, and a web search. The kind the user picked last time
 * for the same query (Arc's queriesToSelectedArchetype) is moved to the top.
 * @param query Raw input.
 * @param state App state.
 * @returns At most MAX_SUGGESTIONS suggestions, best first.
 */
export function buildSuggestions(query: string, state: AppState): Suggestion[] {
  const text = query.trim();
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const engine = state.settings.searchEngine;
  const space = state.spaces[state.window.focusedSpaceId];
  const visibleRoots = new Set([state.favoritesId, space?.pinnedId, space?.todayId]);

  const scored: { s: Suggestion; score: number }[] = [];
  for (const item of Object.values(state.items)) {
    if (!isTab(item) || item.data.url === "about:blank") continue;
    let root: SidebarItem = item;
    while (root.parentId && state.items[root.parentId]) root = state.items[root.parentId];
    if (!visibleRoots.has(root.id)) continue;
    const score = matchScore(tokens, item.data.title, item.data.url);
    if (!score) continue;
    scored.push({
      s: { kind: "tab", key: "tab:" + item.id, title: item.data.title || item.data.url, url: item.data.url, favicon: item.data.favicon, tabId: item.id },
      // Recently used tabs first when the query is empty; open tabs outrank history otherwise.
      score: tokens.length ? score + 2 : item.data.lastActiveAt / 1e13,
    });
  }
  if (tokens.length) {
    for (const entry of state.history) {
      const score = matchScore(tokens, entry.title, entry.url);
      if (!score) continue;
      scored.push({
        s: { kind: "history", key: "history:" + entry.url, title: entry.title || entry.url, url: entry.url, favicon: null },
        score: score + Math.min(2, Math.log10(entry.visitCount + 1)),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const results: Suggestion[] = [];
  for (const { s } of scored) {
    const key = dedupKey(s.url, s.title);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(s);
  }

  if (text) {
    const search: Suggestion = { kind: "search", key: "search", title: text, url: buildSearchUrl(text, engine), favicon: null };
    if (looksLikeUrl(text)) {
      const url = toNavigableUrl(text, engine);
      results.unshift({ kind: "url", key: "url", title: url, url, favicon: null });
      results.push(search);
    } else {
      results.splice(Math.min(results.length, results[0]?.kind === "tab" ? 1 : 0), 0, search);
    }
  }

  const remembered = state.commandMemory[text.toLowerCase()];
  if (remembered) {
    const index = results.findIndex((r) => r.kind === remembered);
    if (index > 0) results.unshift(...results.splice(index, 1));
  }
  return results.slice(0, MAX_SUGGESTIONS);
}
