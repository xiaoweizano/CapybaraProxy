/**
 * View preferences for the Proxies page.
 *
 * Node ordering and collapsed groups are presentation state, not settings the
 * core cares about, so they live in `localStorage` instead of `settings.json`:
 * they must survive a page switch and a relaunch, but they are worthless to
 * the native side. The preview build reads the same keys.
 */
export type NodeSort = "default" | "delay" | "name";

const SORT_STORAGE_KEY = "capybara.proxies.sort";
const COLLAPSED_STORAGE_KEY = "capybara.proxies.collapsed";
const FAVORITES_STORAGE_KEY = "capybara.proxies.favorites";

type Reader = { getItem(key: string): string | null };
type Writer = { setItem(key: string, value: string): void };

const NODE_SORTS: readonly NodeSort[] = ["default", "delay", "name"];

export function isNodeSort(value: unknown): value is NodeSort {
  return (
    typeof value === "string" && NODE_SORTS.includes(value as NodeSort)
  );
}

export function readStoredSort(storage: Reader): NodeSort {
  try {
    const value = storage.getItem(SORT_STORAGE_KEY);
    return isNodeSort(value) ? value : "default";
  } catch {
    return "default";
  }
}

export function writeStoredSort(storage: Writer, sort: NodeSort): void {
  try {
    storage.setItem(SORT_STORAGE_KEY, isNodeSort(sort) ? sort : "default");
  } catch {
    // A full quota only loses the preference, never the page.
  }
}

export function readStoredCollapsed(storage: Reader): Set<string> {
  try {
    const raw = storage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function writeStoredCollapsed(
  storage: Writer,
  collapsed: ReadonlySet<string>,
): void {
  try {
    storage.setItem(
      COLLAPSED_STORAGE_KEY,
      JSON.stringify([...collapsed].sort()),
    );
  } catch {
    // Same as above: losing this preference is not worth an error.
  }
}

export function readStoredFavorites(storage: Reader): Set<string> {
  try {
    const raw = storage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function writeStoredFavorites(
  storage: Writer,
  favorites: ReadonlySet<string>,
): void {
  try {
    storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites].sort()));
  } catch {
    // A full quota only loses the preference, never the page.
  }
}
