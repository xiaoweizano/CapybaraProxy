import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getCoreInfo,
  getCorePreferences,
  getProxyGroups,
  getRuntimeLogs,
  getRuntimeSnapshot,
  restartRuntime,
  selectProxy as selectProxyCommand,
  setCorePreferences,
  startRuntime,
  stopRuntime,
  subscribeRuntimeLog,
  subscribeRuntimeState,
  testGroupDelay,
  testProxyDelay,
  type CoreLogLevel,
  type CorePreferences,
  type RoutingMode,
  type RuntimeBridgeResult,
  type RuntimeError,
  type RuntimeLogEntry,
  type RuntimeSnapshot,
} from "../../platform/runtime";
import {
  RuntimeContext,
  type RuntimeAction,
  type RuntimeContextValue,
  type RuntimeViewState,
} from "./runtimeContext";
import { i18n } from "../../i18n";

const MAX_VISIBLE_LOGS = 100;
const DEFAULT_DELAY_TIMEOUT_MS = 5_000;
const unavailableNotice = (): string => i18n.t("errors.runtimeUnavailable");

const initialState: RuntimeViewState = {
  snapshot: null,
  coreInfo: null,
  proxyGroups: [],
  corePreferences: null,
  logs: [],
  isLoading: true,
  pendingAction: null,
  notice: null,
  lastError: null,
};

function mergeLogEntries(
  current: RuntimeLogEntry[],
  incoming: RuntimeLogEntry[],
): RuntimeLogEntry[] {
  const entries = new Map<number, RuntimeLogEntry>();

  for (const entry of [...current, ...incoming]) {
    entries.set(entry.sequence, entry);
  }

  return [...entries.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-MAX_VISIBLE_LOGS);
}

function unexpectedError(message: string): RuntimeError {
  return { code: "internal", message, retryable: true };
}

/**
 * Runs a bridge read and turns a missing command or a rejection into an error
 * result, so one unavailable endpoint cannot blank the whole page.
 */
async function safeRead<T>(
  read: () => Promise<RuntimeBridgeResult<T>>,
  failureMessage: string,
): Promise<RuntimeBridgeResult<T>> {
  try {
    const result = await read();
    return result ?? {
      status: "error",
      error: unexpectedError(failureMessage),
    };
  } catch {
    return { status: "error", error: unexpectedError(failureMessage) };
  }
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RuntimeViewState>(initialState);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const resourceGenerationRef = useRef(0);

  const updateState = useCallback(
    (
      updater:
        | Partial<RuntimeViewState>
        | ((current: RuntimeViewState) => RuntimeViewState),
    ) => {
      setState((current) => {
        const next =
          typeof updater === "function"
            ? updater(current)
            : { ...current, ...updater };
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  const loadConnectedResources = useCallback(async () => {
    const generation = ++resourceGenerationRef.current;
    // Each read is best-effort: a build whose bridge lacks one command must
    // not take the whole page down with it.
    const [coreResult, groupsResult, preferencesResult] = await Promise.all([
      safeRead(() => getCoreInfo(), i18n.t("errors.coreDetails")),
      safeRead(() => getProxyGroups(), i18n.t("errors.proxyGroups")),
      safeRead(() => getCorePreferences(), i18n.t("errors.corePreferences")),
    ]);

    if (!mountedRef.current || generation !== resourceGenerationRef.current) {
      return;
    }

    if (coreResult.status === "ok") {
      updateState({ coreInfo: coreResult.data });
    } else if (coreResult.status === "unavailable") {
      updateState({ notice: unavailableNotice() });
    } else {
      updateState({ lastError: coreResult.error });
    }

    if (groupsResult.status === "ok") {
      updateState({ proxyGroups: groupsResult.data });
    } else if (groupsResult.status === "unavailable") {
      updateState({ notice: unavailableNotice() });
    } else {
      updateState({ lastError: groupsResult.error });
    }

    // Preferences are informational: an older core that does not answer this
    // endpoint must not surface an error banner.
    if (preferencesResult.status === "ok") {
      updateState({ corePreferences: preferencesResult.data });
    }
  }, [updateState]);

  const applySnapshot = useCallback(
    (snapshot: RuntimeSnapshot) => {
      const current = stateRef.current.snapshot;

      if (current && snapshot.sequence < current.sequence) {
        return;
      }

      updateState({
        snapshot,
        pendingAction: null,
        lastError: null,
      });

      if (snapshot.state === "connected") {
        void loadConnectedResources();
      } else {
        resourceGenerationRef.current += 1;
        updateState({ coreInfo: null, proxyGroups: [], corePreferences: null });
      }
    },
    [loadConnectedResources, updateState],
  );

  const appendLog = useCallback(
    (entry: RuntimeLogEntry) => {
      updateState((current) => ({
        ...current,
        logs: mergeLogEntries(current.logs, [entry]),
      }));
    },
    [updateState],
  );

  const applyInitialResult = useCallback(
    <T,>(result: RuntimeBridgeResult<T>, apply: (data: T) => void) => {
      if (result.status === "ok") {
        apply(result.data);
      } else if (result.status === "unavailable") {
        updateState({ notice: unavailableNotice() });
      } else {
        updateState({ lastError: result.error });
      }
    },
    [updateState],
  );

  const refresh = useCallback(async () => {
    updateState({ isLoading: true });

    const [snapshotResult, logsResult] = await Promise.all([
      getRuntimeSnapshot().catch(() => ({
        status: "error" as const,
        error: unexpectedError(
          i18n.t("errors.desktopRuntime"),
        ),
      })),
      getRuntimeLogs().catch(() => ({
        status: "error" as const,
        error: unexpectedError(i18n.t("errors.runtimeLogs")),
      })),
    ]);

    if (!mountedRef.current) {
      return;
    }

    applyInitialResult(snapshotResult, applySnapshot);
    applyInitialResult(logsResult, (logs) => {
      updateState((current) => ({
        ...current,
        logs: mergeLogEntries(current.logs, logs),
      }));
    });
    updateState({ isLoading: false });
  }, [applyInitialResult, applySnapshot, updateState]);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    const cleanups: Array<() => void> = [];

    const retainCleanup = (cleanup: () => void) => {
      if (!disposed) {
        cleanups.push(cleanup);
      } else {
        cleanup();
      }
    };

    void subscribeRuntimeState(applySnapshot)
      .then(retainCleanup)
      .catch(() => {
        if (mountedRef.current) {
          updateState({
            notice: i18n.t("errors.stateEvents"),
          });
        }
      });
    void subscribeRuntimeLog(appendLog)
      .then(retainCleanup)
      .catch(() => {
        if (mountedRef.current) {
          updateState({ notice: i18n.t("errors.logEvents") });
        }
      });
    void refresh();

    return () => {
      disposed = true;
      mountedRef.current = false;
      resourceGenerationRef.current += 1;

      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [appendLog, applySnapshot, refresh, updateState]);

  const runLifecycleAction = useCallback(
    async (
      action: RuntimeAction,
      command: () => Promise<RuntimeBridgeResult<RuntimeSnapshot>>,
    ) => {
      if (stateRef.current.pendingAction) {
        return;
      }

      updateState({ pendingAction: action, lastError: null, notice: null });

      try {
        const result = await command();

        if (!mountedRef.current) {
          return;
        }

        if (result.status === "ok") {
          applySnapshot(result.data);
        } else if (result.status === "unavailable") {
          updateState({ pendingAction: null, notice: unavailableNotice() });
        } else {
          updateState({ pendingAction: null, lastError: result.error });
        }
      } catch {
        if (mountedRef.current) {
          updateState({
            pendingAction: null,
            lastError: unexpectedError(
              i18n.t("errors.commandFailed"),
            ),
          });
        }
      }
    },
    [applySnapshot, updateState],
  );

  const start = useCallback(
    () => runLifecycleAction("start", startRuntime),
    [runLifecycleAction],
  );
  const stop = useCallback(
    () => runLifecycleAction("stop", stopRuntime),
    [runLifecycleAction],
  );
  const restart = useCallback(
    () => runLifecycleAction("restart", restartRuntime),
    [runLifecycleAction],
  );

  const selectProxy = useCallback(
    async (group: string, proxy: string) => {
      updateState({ lastError: null, notice: null });

      try {
        const result = await selectProxyCommand(group, proxy);

        if (!mountedRef.current) {
          return;
        }

        if (result.status === "unavailable") {
          updateState({ notice: unavailableNotice() });
        } else if (result.status === "error") {
          updateState({ lastError: result.error });
        } else {
          const groups = await getProxyGroups();

          if (!mountedRef.current) {
            return;
          }

          if (groups.status === "ok") {
            updateState({ proxyGroups: groups.data });
          } else if (groups.status === "error") {
            updateState({ lastError: groups.error });
          }
        }
      } catch {
        if (mountedRef.current) {
          updateState({
            lastError: unexpectedError(
              i18n.t("errors.selectProxy"),
            ),
          });
        }
      }
    },
    [updateState],
  );

  const measureDelay = useCallback(
    async (
      proxy: string,
      timeoutMs = DEFAULT_DELAY_TIMEOUT_MS,
    ): Promise<number | null> => {
      updateState({ lastError: null, notice: null });

      try {
        const result = await testProxyDelay(proxy, timeoutMs);

        if (!mountedRef.current) {
          return null;
        }

        if (result.status === "ok") {
          return result.data;
        }

        if (result.status === "unavailable") {
          updateState({ notice: unavailableNotice() });
        } else {
          updateState({ lastError: result.error });
        }
      } catch {
        if (mountedRef.current) {
          updateState({
            lastError: unexpectedError(
              i18n.t("errors.measureDelay"),
            ),
          });
        }
      }

      return null;
    },
    [updateState],
  );

  const measureGroupDelay = useCallback(
    async (
      group: string,
      timeoutMs = DEFAULT_DELAY_TIMEOUT_MS,
    ): Promise<Record<string, number> | null> => {
      updateState({ lastError: null, notice: null });

      try {
        const result = await testGroupDelay(group, timeoutMs);

        if (!mountedRef.current) {
          return null;
        }

        if (result.status === "ok") {
          return Object.fromEntries(
            result.data.delays.map((sample) => [sample.proxy, sample.delay_ms]),
          );
        }

        if (result.status === "unavailable") {
          updateState({ notice: unavailableNotice() });
        } else {
          updateState({ lastError: result.error });
        }
      } catch {
        if (mountedRef.current) {
          updateState({
            lastError: unexpectedError(i18n.t("errors.measureDelay")),
          });
        }
      }

      return null;
    },
    [updateState],
  );

  const applyCorePreferences = useCallback(
    async (
      mode: RoutingMode | null,
      logLevel: CoreLogLevel | null,
    ): Promise<CorePreferences | null> => {
      updateState({ lastError: null, notice: null });

      try {
        const result = await setCorePreferences(mode, logLevel);

        if (!mountedRef.current) {
          return null;
        }

        if (result.status === "ok") {
          updateState({ corePreferences: result.data });
          return result.data;
        }

        if (result.status === "unavailable") {
          updateState({ notice: unavailableNotice() });
        } else {
          updateState({ lastError: result.error });
        }
      } catch {
        if (mountedRef.current) {
          updateState({
            lastError: unexpectedError(i18n.t("errors.corePreferences")),
          });
        }
      }

      return null;
    },
    [updateState],
  );

  const setRoutingMode = useCallback(
    async (mode: RoutingMode) => {
      await applyCorePreferences(mode, null);
    },
    [applyCorePreferences],
  );

  const setCoreLogLevel = useCallback(
    async (level: CoreLogLevel) => {
      await applyCorePreferences(null, level);
    },
    [applyCorePreferences],
  );

  const value = useMemo<RuntimeContextValue>(
    () => ({
      ...state,
      refresh,
      start,
      stop,
      restart,
      selectProxy,
      measureDelay,
      measureGroupDelay,
      setRoutingMode,
      setCoreLogLevel,
    }),
    [
      state,
      refresh,
      start,
      stop,
      restart,
      selectProxy,
      measureDelay,
      measureGroupDelay,
      setRoutingMode,
      setCoreLogLevel,
    ],
  );

  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}
