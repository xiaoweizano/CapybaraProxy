import { createContext, useContext } from "react";
import type { ThemeId } from "../theme/theme";
import type { CloseBehavior } from "../../shared/closeBehavior";
import type { LanguageId } from "../../i18n/language";

export const SETTINGS_MIGRATION_KEY = "flowproxy.settings.migrated.v1";

export type AppPreferences = {
  theme: ThemeId;
  closeBehavior: CloseBehavior;
  language: LanguageId;
};

export type SettingsStorageMode = "loading" | "native" | "preview";

export type SettingsUpdateResult =
  | { ok: true }
  | { ok: false; message: string };

export type AppSettingsContextValue = {
  settings: AppPreferences;
  mode: SettingsStorageMode;
  isSaving: boolean;
  error: string | null;
  updateTheme: (theme: ThemeId) => Promise<SettingsUpdateResult>;
  updateCloseBehavior: (
    behavior: CloseBehavior,
  ) => Promise<SettingsUpdateResult>;
  updateLanguage: (language: LanguageId) => Promise<SettingsUpdateResult>;
  clearError: () => void;
};

export const AppSettingsContext =
  createContext<AppSettingsContextValue | null>(null);

export function useAppSettings(): AppSettingsContextValue {
  const context = useContext(AppSettingsContext);

  if (!context) {
    throw new Error("useAppSettings must be used inside SettingsProvider");
  }

  return context;
}
