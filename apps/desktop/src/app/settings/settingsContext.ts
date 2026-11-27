import { createContext, useContext } from "react";
import type { ThemeId } from "../theme/theme";
import type { CloseBehavior } from "../../shared/closeBehavior";
import type { LanguageId } from "../../i18n/language";
import type { MotionPreference } from "../../shared/motion";
import type { CoreLogLevel } from "../../platform/runtime";
import type {
  SettingsMode,
  TraySpeedDisplay,
} from "../../platform/settings";

export const SETTINGS_MIGRATION_KEY = "capybara.settings.migrated.v1";

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
  /** Refresh the stored subscription once, right after launch. */
  updateSubscriptionOnLaunch: boolean;
  /** Connect the core as soon as CapybaraProxy launches. */
  autoConnect: boolean;
  /** User-Agent used when downloading subscriptions; `null` keeps the
   * Clash identifier providers expect. */
  subscriptionUserAgent: string | null;
  /** Bypass list applied to the system proxy; empty keeps the OS list. */
  proxyBypass: string;
  /** Restart the core after an automatic subscription refresh. */
  restartAfterSubscriptionUpdate: boolean;
  /** Whether the operator wants CapybaraProxy to own the system proxy. */
  systemProxyEnabled: boolean;
  /** How many settings groups the Settings page shows. */
  settingsMode: SettingsMode;
  /** Start with the main window hidden so only the tray icon appears. */
  silentStart: boolean;
  /** Interface animation preference. */
  motion: MotionPreference;
  /** Show the connection state and current node in the tray. */
  trayShowInfo: boolean;
  /** What the tray icon does with the live transfer rate. */
  traySpeedDisplay: TraySpeedDisplay;
  /** Mirror Runtime events into a rotating log file. */
  logToFile: boolean;
  /** How many days of log files are kept. */
  logRetentionDays: number;
  /** Merge latency measurements before displaying them. */
  unifiedDelay: boolean;
  /** Allow several parallel connections to one host. */
  tcpConcurrent: boolean;
  /** Fixed mixed-port; `null` picks a free port on every start. */
  fixedProxyPort: number | null;
  /** Base URL of an external Sub-Store backend. */
  substoreUrl: string;
  /** Token sent to the Sub-Store backend as `x-api-token`. */
  substoreToken: string;
  /** Remembered window size, carried through unchanged when any other
   * preference is saved. */
  windowWidth: number | null;
  windowHeight: number | null;
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
  updateUpdateSubscriptionOnLaunch: (
    enabled: boolean,
  ) => Promise<SettingsUpdateResult>;
  updateAutoConnect: (enabled: boolean) => Promise<SettingsUpdateResult>;
  updateSubscriptionUserAgent: (
    userAgent: string,
  ) => Promise<SettingsUpdateResult>;
  updateProxyBypass: (bypass: string) => Promise<SettingsUpdateResult>;
  updateRestartAfterSubscriptionUpdate: (
    enabled: boolean,
  ) => Promise<SettingsUpdateResult>;
  updateSettingsMode: (mode: SettingsMode) => Promise<SettingsUpdateResult>;
  updateSilentStart: (enabled: boolean) => Promise<SettingsUpdateResult>;
  updateMotion: (motion: MotionPreference) => Promise<SettingsUpdateResult>;
  updateTrayShowInfo: (enabled: boolean) => Promise<SettingsUpdateResult>;
  updateTraySpeedDisplay: (
    display: TraySpeedDisplay,
  ) => Promise<SettingsUpdateResult>;
  updateLogToFile: (enabled: boolean) => Promise<SettingsUpdateResult>;
  updateLogRetentionDays: (days: number) => Promise<SettingsUpdateResult>;
  updateUnifiedDelay: (enabled: boolean) => Promise<SettingsUpdateResult>;
  updateTcpConcurrent: (enabled: boolean) => Promise<SettingsUpdateResult>;
  updateFixedProxyPort: (port: number | null) => Promise<SettingsUpdateResult>;
  updateSubStore: (
    url: string,
    token: string,
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
