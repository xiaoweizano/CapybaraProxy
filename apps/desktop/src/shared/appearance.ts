/**
 * Light / dark appearance.
 *
 * This is separate from the theme: a theme owns the palette family (accent
 * colours, card radius), while the appearance decides whether that family is
 * drawn on a light or a dark canvas. `system` follows the OS and reacts to it
 * while the app is running.
 *
 * The resolved value is written to `data-appearance` on the document root,
 * where the design tokens read it.
 */
export type AppearancePreference = "system" | "light" | "dark";

export const DEFAULT_APPEARANCE: AppearancePreference = "system";

const STORAGE_KEY = "capybara.appearance";

export function isAppearance(value: unknown): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

type Reader = { getItem(key: string): string | null };
type Writer = { setItem(key: string, value: string): void };

export function readStoredAppearance(storage: Reader): AppearancePreference {
  return isAppearance(storage.getItem(STORAGE_KEY))
    ? (storage.getItem(STORAGE_KEY) as AppearancePreference)
    : DEFAULT_APPEARANCE;
}

export function writeStoredAppearance(
  storage: Writer,
  appearance: AppearancePreference,
): void {
  if (isAppearance(appearance)) {
    storage.setItem(STORAGE_KEY, appearance);
  }
}

/** The media query the `system` preference follows. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Resolves a preference to the value written into `data-appearance`. */
export function resolveAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): "light" | "dark" {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return preference;
}

/** Applies the preference to the document root. */
export function applyAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): void {
  document.documentElement.dataset.appearance = resolveAppearance(
    preference,
    systemPrefersDark,
  );
}

/** Subscribes to OS appearance changes; returns an unsubscribe function. */
export function watchSystemAppearance(
  listener: (prefersDark: boolean) => void,
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => undefined;
  }
  const query = window.matchMedia(DARK_QUERY);
  const handler = (event: MediaQueryListEvent) => listener(event.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_QUERY).matches
  );
}
