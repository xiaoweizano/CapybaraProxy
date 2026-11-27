import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applyNativeUiScale,
  getSettings,
  saveSettings,
  type DesktopSettings,
  type SettingsMode,
  type TraySpeedDisplay,
} from "../../platform/settings";
import {
  DEFAULT_LOG_RETENTION_DAYS,
  normalizeLogRetention,
  normalizeProxyPort,
} from "../../shared/settingsLimits";
import {
  readStoredCloseBehavior,
  writeStoredCloseBehavior,
  type CloseBehavior,
} from "../../shared/closeBehavior";
import {
  DEFAULT_UI_SCALE,
  applyUiScale,
  normalizeUiScale,
  readStoredUiScale,
  writeStoredUiScale,
} from "../../shared/uiScale";
import {
  isTheme,
  readStoredTheme,
  writeStoredTheme,
  type ThemeId,
} from "../theme/theme";
import {
  DEFAULT_LANGUAGE,
  detectSystemLanguage,
  isLanguage,
  readStoredLanguage,
  writeStoredLanguage,
  type LanguageId,
} from "../../i18n/language";
import { applyLanguage } from "../../i18n";
import {
  DEFAULT_MOTION,
  applyMotion,
  type MotionPreference,
} from "../../shared/motion";
import {
  DEFAULT_DELAY_PROBE_URL,
  DEFAULT_DELAY_TIMEOUT_MS,
  normalizeDelayTimeout,
} from "../../shared/delayProbe";
import type { CoreLogLevel } from "../../platform/runtime";
import {
  AppSettingsContext,
  SETTINGS_MIGRATION_KEY,
  type AppPreferences,
  type SettingsStorageMode,
  type SettingsUpdateResult,
} from "./settingsContext";

type PreferencePatch = Partial<AppPreferences>;

function readPreviewPreferences(): AppPreferences {
  try {
    return {
      ...DEFAULT_PREFERENCES,
      theme: readStoredTheme(window.localStorage),
      closeBehavior: readStoredCloseBehavior(window.localStorage),
      language: readStoredLanguage(window.localStorage),
      uiScale: readStoredUiScale(window.localStorage),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Mirrors `DesktopSettings::default()` on the Rust side. */
const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "cyber_flow",
  closeBehavior: "hide_to_tray",
  language: DEFAULT_LANGUAGE,
  uiScale: DEFAULT_UI_SCALE,
  coreLogLevel: "warning",
  ipv6: false,
  delayProbeUrl: DEFAULT_DELAY_PROBE_URL,
  delayTimeoutMs: DEFAULT_DELAY_TIMEOUT_MS,
  subscriptionUpdateHours: 0,
  updateSubscriptionOnLaunch: false,
  autoConnect: false,
  subscriptionUserAgent: null,
  settingsMode: "standard",
  silentStart: false,
  motion: DEFAULT_MOTION,
  trayShowInfo: true,
  traySpeedDisplay: "icon",
  logToFile: true,
  logRetentionDays: DEFAULT_LOG_RETENTION_DAYS,
  unifiedDelay: true,
  tcpConcurrent: true,
  fixedProxyPort: null,
  substoreUrl: "",
  substoreToken: "",
  windowWidth: null,
  windowHeight: null,
};

function fromNativeSettings(settings: DesktopSettings): AppPreferences {
  return {
    theme: settings.theme,
    closeBehavior: settings.close_behavior,
    // A `settings.json` written before the field existed has no language;
    // follow the system locale instead of forcing English on a fresh upgrade.
    language: settings.language ?? detectSystemLanguage(),
    uiScale: normalizeUiScale(settings.ui_scale),
    coreLogLevel: settings.log_level ?? "warning",
    ipv6: settings.ipv6 ?? false,
    delayProbeUrl: settings.delay_probe_url ?? DEFAULT_DELAY_PROBE_URL,
    delayTimeoutMs: settings.delay_timeout_ms ?? DEFAULT_DELAY_TIMEOUT_MS,
    subscriptionUpdateHours: settings.subscription_update_hours ?? 0,
    updateSubscriptionOnLaunch: settings.update_subscription_on_launch ?? false,
    autoConnect: settings.auto_connect ?? false,
    subscriptionUserAgent: settings.subscription_user_agent ?? null,
    settingsMode: settings.settings_mode ?? "standard",
    silentStart: settings.silent_start ?? false,
    motion: settings.motion ?? DEFAULT_MOTION,
    trayShowInfo: settings.tray_show_info ?? true,
    traySpeedDisplay: settings.tray_speed_display ?? "icon",
    logToFile: settings.log_to_file ?? true,
    logRetentionDays:
      settings.log_retention_days ?? DEFAULT_LOG_RETENTION_DAYS,
    unifiedDelay: settings.unified_delay ?? true,
    tcpConcurrent: settings.tcp_concurrent ?? true,
    fixedProxyPort: settings.fixed_proxy_port ?? null,
    substoreUrl: settings.substore_url ?? "",
    substoreToken: settings.substore_token ?? "",
    windowWidth: settings.window_width ?? null,
    windowHeight: settings.window_height ?? null,
  };
}

function toNativeSettings(settings: AppPreferences): DesktopSettings {
  return {
    version: 1,
    theme: settings.theme,
    close_behavior: settings.closeBehavior,
    language: settings.language,
    ui_scale: settings.uiScale,
    log_level: settings.coreLogLevel,
    ipv6: settings.ipv6,
    delay_probe_url: settings.delayProbeUrl,
    delay_timeout_ms: settings.delayTimeoutMs,
    subscription_update_hours: settings.subscriptionUpdateHours,
    update_subscription_on_launch: settings.updateSubscriptionOnLaunch,
    auto_connect: settings.autoConnect,
    subscription_user_agent: settings.subscriptionUserAgent,
    settings_mode: settings.settingsMode,
    silent_start: settings.silentStart,
    motion: settings.motion,
    tray_show_info: settings.trayShowInfo,
    tray_speed_display: settings.traySpeedDisplay,
    log_to_file: settings.logToFile,
    log_retention_days: settings.logRetentionDays,
    unified_delay: settings.unifiedDelay,
    tcp_concurrent: settings.tcpConcurrent,
    fixed_proxy_port: settings.fixedProxyPort,
    substore_url: settings.substoreUrl,
    substore_token: settings.substoreToken,
    // Round-tripped so saving any other preference cannot clear the window
    // size the native side remembered.
    window_width: settings.windowWidth,
    window_height: settings.windowHeight,
  };
}

function writePreferenceCache(settings: AppPreferences): void {
  try {
    writeStoredTheme(window.localStorage, settings.theme);
    writeStoredCloseBehavior(
      window.localStorage,
      settings.closeBehavior,
    );
    writeStoredLanguage(window.localStorage, settings.language);
    writeStoredUiScale(window.localStorage, settings.uiScale);
  } catch {
    // The native settings store remains authoritative when cache writes fail.
  }
}

function hasLegacyPreferences(): boolean {
  try {
    return (
      window.localStorage.getItem("flowproxy.theme") !== null ||
      window.localStorage.getItem("flowproxy.closeBehavior") !== null
    );
  } catch {
    return false;
  }
}

/** Clamps a retention window to the range the native side accepts. */
function markSettingsMigrated(): void {
  try {
    window.localStorage.setItem(SETTINGS_MIGRATION_KEY, "1");
  } catch {
    // A failed marker write retries migration on the next launch.
  }
}

function hasCompletedMigration(): boolean {
  try {
    return (
      window.localStorage.getItem(SETTINGS_MIGRATION_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] =
    useState<AppPreferences>(readPreviewPreferences);
  const [mode, setMode] =
    useState<SettingsStorageMode>("loading");
  const [savingCount, setSavingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const modeRef = useRef(mode);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const changeMode = useCallback((nextMode: SettingsStorageMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const applySettings = useCallback((nextSettings: AppPreferences) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    writePreferenceCache(nextSettings);
    applyLanguage(nextSettings.language);
    applyUiScale(nextSettings.uiScale);
    applyMotion(nextSettings.motion);
  }, []);

  useEffect(() => {
    let disposed = false;

    const initialize = async () => {
      try {
        const result = await getSettings();

        if (disposed) {
          return;
        }

        if (result.status === "unavailable") {
          changeMode("preview");
          return;
        }

        if (result.status === "error") {
          changeMode("native");
          setError(result.error.message);
          return;
        }

        let resolvedSettings = fromNativeSettings(result.data);

        if (!hasCompletedMigration()) {
          if (hasLegacyPreferences()) {
            const migrated = readPreviewPreferences();
            const migrationResult = await saveSettings(
              toNativeSettings(migrated),
            );

            if (disposed) {
              return;
            }

            if (migrationResult.status === "ok") {
              resolvedSettings = fromNativeSettings(
                migrationResult.data,
              );
              markSettingsMigrated();
            } else {
              applySettings(resolvedSettings);
              changeMode("native");
              setError(
                migrationResult.status === "error"
                  ? migrationResult.error.message
                  : "Native settings migration is unavailable.",
              );
              return;
            }
          } else {
            markSettingsMigrated();
          }
        }

        applySettings(resolvedSettings);
        changeMode("native");
      } catch {
        if (!disposed) {
          changeMode("native");
          setError("FlowProxy settings could not be loaded.");
        }
      }
    };

    void initialize();

    return () => {
      disposed = true;
    };
  }, [applySettings, changeMode]);

  const enqueueUpdate = useCallback(
    (patch: PreferencePatch): Promise<SettingsUpdateResult> => {
      setSavingCount((count) => count + 1);

      const operation = saveQueueRef.current.then(async () => {
        if (modeRef.current === "loading") {
          const message = "Settings are still loading. Try again.";
          setError(message);
          return { ok: false, message } as const;
        }

        setError(null);
        const nextSettings = {
          ...settingsRef.current,
          ...patch,
        };

        if (modeRef.current === "preview") {
          applySettings(nextSettings);
          return { ok: true } as const;
        }

        let result: Awaited<ReturnType<typeof saveSettings>>;
        try {
          result = await saveSettings(toNativeSettings(nextSettings));
        } catch {
          const message = "FlowProxy could not save desktop settings.";
          setError(message);
          return { ok: false, message } as const;
        }

        if (result.status === "ok") {
          applySettings(fromNativeSettings(result.data));
          return { ok: true } as const;
        }

        const message =
          result.status === "error"
            ? result.error.message
            : "Native settings storage is unavailable.";
        setError(message);
        return { ok: false, message } as const;
      });

      saveQueueRef.current = operation.then(
        () => undefined,
        () => undefined,
      );

      return operation.finally(() => {
        setSavingCount((count) => Math.max(0, count - 1));
      });
    },
    [applySettings],
  );

  const updateTheme = useCallback(
    (theme: ThemeId): Promise<SettingsUpdateResult> => {
      if (!isTheme(theme)) {
        const message = "Unknown FlowProxy theme.";
        setError(message);
        return Promise.resolve({ ok: false, message });
      }

      return enqueueUpdate({ theme });
    },
    [enqueueUpdate],
  );

  const updateCloseBehavior = useCallback(
    (closeBehavior: CloseBehavior): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ closeBehavior }),
    [enqueueUpdate],
  );

  const updateLanguage = useCallback(
    (language: LanguageId): Promise<SettingsUpdateResult> => {
      if (!isLanguage(language)) {
        const message = "Unknown FlowProxy language.";
        setError(message);
        return Promise.resolve({ ok: false, message });
      }

      return enqueueUpdate({ language });
    },
    [enqueueUpdate],
  );

  const updateUiScale = useCallback(
    (scale: number): Promise<SettingsUpdateResult> => {
      const uiScale = normalizeUiScale(scale);
      // Zoom immediately so dragging a slider feels responsive; the persisted
      // value is applied again from `applySettings` once the save completes.
      applyUiScale(uiScale);
      void applyNativeUiScale(uiScale);
      return enqueueUpdate({ uiScale });
    },
    [enqueueUpdate],
  );

  const updateCoreLogLevel = useCallback(
    (coreLogLevel: CoreLogLevel): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ coreLogLevel }),
    [enqueueUpdate],
  );

  const updateIpv6 = useCallback(
    (ipv6: boolean): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ ipv6 }),
    [enqueueUpdate],
  );

  const updateDelayProbe = useCallback(
    (url: string, timeoutMs: number): Promise<SettingsUpdateResult> =>
      enqueueUpdate({
        delayProbeUrl: url.trim() === "" ? DEFAULT_DELAY_PROBE_URL : url.trim(),
        delayTimeoutMs: normalizeDelayTimeout(timeoutMs),
      }),
    [enqueueUpdate],
  );

  const updateSubscriptionUpdateHours = useCallback(
    (hours: number): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ subscriptionUpdateHours: Math.max(0, Math.round(hours)) }),
    [enqueueUpdate],
  );

  const updateUpdateSubscriptionOnLaunch = useCallback(
    (updateSubscriptionOnLaunch: boolean): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ updateSubscriptionOnLaunch }),
    [enqueueUpdate],
  );

  const updateAutoConnect = useCallback(
    (autoConnect: boolean): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ autoConnect }),
    [enqueueUpdate],
  );

  const updateSubscriptionUserAgent = useCallback(
    (userAgent: string): Promise<SettingsUpdateResult> => {
      const trimmed = userAgent.trim();
      return enqueueUpdate({
        // An empty field means "use the built-in Clash identifier", which the
        // native side spells as an absent value.
        subscriptionUserAgent: trimmed === "" ? null : trimmed,
      });
    },
    [enqueueUpdate],
  );

  const updateSettingsMode = useCallback(
    (settingsMode: SettingsMode): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ settingsMode }),
    [enqueueUpdate],
  );

  const updateSilentStart = useCallback(
    (silentStart: boolean): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ silentStart }),
    [enqueueUpdate],
  );

  const updateMotion = useCallback(
    (motion: MotionPreference): Promise<SettingsUpdateResult> => {
      // Flip the class immediately; the persisted value is re-applied from
      // `applySettings` once the save completes.
      applyMotion(motion);
      return enqueueUpdate({ motion });
    },
    [enqueueUpdate],
  );

  const updateTrayShowInfo = useCallback(
    (trayShowInfo: boolean): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ trayShowInfo }),
    [enqueueUpdate],
  );

  const updateTraySpeedDisplay = useCallback(
    (traySpeedDisplay: TraySpeedDisplay): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ traySpeedDisplay }),
    [enqueueUpdate],
  );

  const updateLogToFile = useCallback(
    (logToFile: boolean): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ logToFile }),
    [enqueueUpdate],
  );

  const updateLogRetentionDays = useCallback(
    (days: number): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ logRetentionDays: normalizeLogRetention(days) }),
    [enqueueUpdate],
  );

  const updateUnifiedDelay = useCallback(
    (unifiedDelay: boolean): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ unifiedDelay }),
    [enqueueUpdate],
  );

  const updateTcpConcurrent = useCallback(
    (tcpConcurrent: boolean): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ tcpConcurrent }),
    [enqueueUpdate],
  );

  const updateFixedProxyPort = useCallback(
    (port: number | null): Promise<SettingsUpdateResult> =>
      enqueueUpdate({ fixedProxyPort: normalizeProxyPort(port) }),
    [enqueueUpdate],
  );

  const updateSubStore = useCallback(
    (url: string, token: string): Promise<SettingsUpdateResult> =>
      enqueueUpdate({
        substoreUrl: url.trim(),
        // The native side clears the token when the URL is empty; mirror it
        // here so the UI and the persisted file agree immediately.
        substoreToken: url.trim() === "" ? "" : token.trim(),
      }),
    [enqueueUpdate],
  );

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({
      settings,
      mode,
      isSaving: savingCount > 0,
      error,
      updateTheme,
      updateCloseBehavior,
      updateLanguage,
      updateUiScale,
      updateCoreLogLevel,
      updateIpv6,
      updateDelayProbe,
      updateSubscriptionUpdateHours,
      updateUpdateSubscriptionOnLaunch,
      updateAutoConnect,
      updateSubscriptionUserAgent,
      updateSettingsMode,
      updateSilentStart,
      updateMotion,
      updateTrayShowInfo,
      updateTraySpeedDisplay,
      updateLogToFile,
      updateLogRetentionDays,
      updateUnifiedDelay,
      updateTcpConcurrent,
      updateFixedProxyPort,
      updateSubStore,
      clearError,
    }),
    [
      settings,
      mode,
      savingCount,
      error,
      updateTheme,
      updateCloseBehavior,
      updateLanguage,
      updateUiScale,
      updateCoreLogLevel,
      updateIpv6,
      updateDelayProbe,
      updateSubscriptionUpdateHours,
      updateUpdateSubscriptionOnLaunch,
      updateAutoConnect,
      updateSubscriptionUserAgent,
      updateSettingsMode,
      updateSilentStart,
      updateMotion,
      updateTrayShowInfo,
      updateTraySpeedDisplay,
      updateLogToFile,
      updateLogRetentionDays,
      updateUnifiedDelay,
      updateTcpConcurrent,
      updateFixedProxyPort,
      updateSubStore,
      clearError,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
