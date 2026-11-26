import { createContext, useContext } from "react";
import type { ThemeId } from "../theme/theme";
import type { CloseBehavior } from "../../shared/closeBehavior";
import type { LanguageId } from "../../i18n/language";
import type { CoreLogLevel } from "../../platform/runtime";

export const SETTINGS_MIGRATION_KEY = "flowproxy.settings.migrated.v1";

export type AppPreferences = {
  theme: ThemeId;
  closeBehavior: CloseBehavior;
  language: LanguageId;
  /** Interface scale in percent, clamped by `shared/uiScale`. */
  uiScale: number;
  /** Core log verbosity, applied the next time the core starts. */
  coreLogLevel: CoreLogLevel;
  /** Whether the core may use IPv6, applied the next time it starts. */
  ipv6: boolean;
  /** URL the core requests when measuring node latency. */
  delayProbeUrl: string;
  /** Latency probe timeout in milliseconds. */
  delayTimeoutMs: number;
  /** Automatic subscription refresh interval in hours; 0 disables it. */
  subscriptionUpdateHours: number;
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
  updateUiScale: (scale: number) => Promise<SettingsUpdateResult>;
  updateCoreLogLevel: (level: CoreLogLevel) => Promise<SettingsUpdateResult>;
  updateIpv6: (enabled: boolean) => Promise<SettingsUpdateResult>;
  updateDelayProbe: (
    url: string,
    timeoutMs: number,
) => Promise<SettingsUpdateResult>;
  updateSubscriptionUpdateHours: (
    hours: number,
) => Promise<SettingsUpdateResult>;
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
