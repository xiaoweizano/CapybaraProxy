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
  getProxyGroups,
  getRuntimeLogs,
  getRuntimeSnapshot,
  restartRuntime,
  selectProxy as selectProxyCommand,
  startRuntime,
  stopRuntime,
  subscribeRuntimeLog,
  subscribeRuntimeState,
  testProxyDelay,
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

const MAX_VISIBLE_LOGS = 100;
const DEFAULT_DELAY_TIMEOUT_MS = 5_000;
const unavailableNotice =
  "Desktop Runtime is unavailable. No native state is simulated.";

const initialState: RuntimeViewState = {
  snapshot: null,
  coreInfo: null,
  proxyGroups: [],
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
    const [coreResult, groupsResult] = await Promise.all([
      getCoreInfo().catch(() => ({
        status: "error" as const,
        error: unexpectedError("FlowProxy could not read Mihomo Core details."),
      })),
      getProxyGroups().catch(() => ({
        status: "error" as const,
        error: unexpectedError("FlowProxy could not read proxy groups."),
      })),
    ]);

    if (!mountedRef.current || generation !== resourceGenerationRef.current) {
      return;
    }

    if (coreResult.status === "ok") {
      updateState({ coreInfo: coreResult.data });
    } else if (coreResult.status === "unavailable") {
      updateState({ notice: unavailableNotice });
    } else {
      updateState({ lastError: coreResult.error });
    }

    if (groupsResult.status === "ok") {
      updateState({ proxyGroups: groupsResult.data });
    } else if (groupsResult.status === "unavailable") {
      updateState({ notice: unavailableNotice });
    } else {
      updateState({ lastError: groupsResult.error });
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
        updateState({ coreInfo: null, proxyGroups: [] });
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
        updateState({ notice: unavailableNotice });
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
          "FlowProxy could not read the Desktop Runtime.",
        ),
      })),
      getRuntimeLogs().catch(() => ({
        status: "error" as const,
        error: unexpectedError("FlowProxy could not read Runtime logs."),
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
            notice: "Runtime state events are unavailable.",
          });
        }
      });
    void subscribeRuntimeLog(appendLog)
      .then(retainCleanup)
      .catch(() => {
        if (mountedRef.current) {
          updateState({ notice: "Runtime log events are unavailable." });
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
          updateState({ pendingAction: null, notice: unavailableNotice });
        } else {
          updateState({ pendingAction: null, lastError: result.error });
        }
      } catch {
        if (mountedRef.current) {
          updateState({
            pendingAction: null,
            lastError: unexpectedError(
              "The Desktop Runtime command failed unexpectedly.",
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
          updateState({ notice: unavailableNotice });
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
              "FlowProxy could not change the selected proxy.",
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
          updateState({ notice: unavailableNotice });
        } else {
          updateState({ lastError: result.error });
        }
      } catch {
        if (mountedRef.current) {
          updateState({
            lastError: unexpectedError(
              "FlowProxy could not measure the proxy delay.",
            ),
          });
        }
      }

      return null;
    },
    [updateState],
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
    }),
    [
      state,
      refresh,
      start,
      stop,
      restart,
      selectProxy,
      measureDelay,
    ],
  );

  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}
