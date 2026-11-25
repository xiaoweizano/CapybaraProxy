import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
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
    };
  } catch {
    return {
      theme: "cyber_flow",
      closeBehavior: "hide_to_tray",
      language: DEFAULT_LANGUAGE,
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
  };
}

function toNativeSettings(settings: AppPreferences): DesktopSettings {
  return {
    version: 1,
    theme: settings.theme,
    close_behavior: settings.closeBehavior,
    language: settings.language,
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
      clearError,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
