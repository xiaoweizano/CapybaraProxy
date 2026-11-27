export const DEFAULT_THEME = "cyber_flow" as const;
export const THEME_STORAGE_KEY = "capybara.theme";

export type ThemeId = "cyber_flow" | "warm_flow";

type ThemeStorageReader = {
  getItem(key: string): string | null;
};

type ThemeStorageWriter = {
  setItem(key: string, value: string): void;
};

export function isTheme(value: unknown): value is ThemeId {
  return value === "cyber_flow" || value === "warm_flow";
}

export function parseTheme(value: string | null): ThemeId {
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function readStoredTheme(storage: ThemeStorageReader): ThemeId {
  return parseTheme(storage.getItem(THEME_STORAGE_KEY));
}

export function writeStoredTheme(
  storage: ThemeStorageWriter,
  theme: ThemeId,
): void {
  if (isTheme(theme)) {
    storage.setItem(THEME_STORAGE_KEY, theme);
  }
}
