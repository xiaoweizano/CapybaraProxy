/**
 * Sidebar collapse state.
 *
 * Three values rather than a boolean: "auto" follows the window width, while
 * an explicit expand/collapse overrides it. Storing the intent means a window
 * resize does not silently undo the operator's choice.
 */
export type SidebarPreference = "auto" | "expanded" | "collapsed";

export const DEFAULT_SIDEBAR: SidebarPreference = "auto";

const STORAGE_KEY = "capybara.sidebar";

type Reader = { getItem(key: string): string | null };
type Writer = { setItem(key: string, value: string): void };

export function isSidebarPreference(value: unknown): value is SidebarPreference {
  return value === "auto" || value === "expanded" || value === "collapsed";
}

export function readStoredSidebar(storage: Reader): SidebarPreference {
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isSidebarPreference(value) ? value : DEFAULT_SIDEBAR;
  } catch {
    return DEFAULT_SIDEBAR;
  }
}

export function writeStoredSidebar(
  storage: Writer,
  preference: SidebarPreference,
): void {
  try {
    storage.setItem(STORAGE_KEY, isSidebarPreference(preference) ? preference : DEFAULT_SIDEBAR);
  } catch {
    // A full quota only loses the preference, never the page.
  }
}

/** The `data-sidebar` value for the document root. */
export function sidebarAttribute(preference: SidebarPreference): string {
  // "auto" maps to no attribute so the media query decides.
  return preference === "auto" ? "" : preference;
}
