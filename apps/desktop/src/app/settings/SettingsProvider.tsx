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
} from "../../platform/settings";
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
      theme: readStoredTheme(window.localStorage),
      closeBehavior: readStoredCloseBehavior(window.localStorage),
      language: readStoredLanguage(window.localStorage),
      uiScale: readStoredUiScale(window.localStorage),
      coreLogLevel: "warning",
      ipv6: false,
      delayProbeUrl: DEFAULT_DELAY_PROBE_URL,
      delayTimeoutMs: DEFAULT_DELAY_TIMEOUT_MS,
      subscriptionUpdateHours: 0,
    };
  } catch {
    return {
      theme: "cyber_flow",
      closeBehavior: "hide_to_tray",
      language: DEFAULT_LANGUAGE,
      uiScale: DEFAULT_UI_SCALE,
      coreLogLevel: "warning",
      ipv6: false,
      delayProbeUrl: DEFAULT_DELAY_PROBE_URL,
      delayTimeoutMs: DEFAULT_DELAY_TIMEOUT_MS,
      subscriptionUpdateHours: 0,
    };
  }
}

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
      clearError,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
