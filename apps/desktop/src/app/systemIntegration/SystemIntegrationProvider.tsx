import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RuntimeError } from "../../platform/runtime";
import {
  getSystemIntegrationStatus,
  setLaunchAtLoginEnabled as setLaunchAtLoginEnabledCommand,
  setSystemProxyEnabled as setSystemProxyEnabledCommand,
  subscribeSystemIntegration,
  type SystemIntegrationEvent,
  type SystemIntegrationStatus,
} from "../../platform/systemIntegration";
import {
  SystemIntegrationContext,
  type SystemIntegrationAction,
} from "./systemIntegrationContext";

const unavailableNotice =
  "Desktop system integration is unavailable in this preview.";

type IntegrationState = {
  status: SystemIntegrationStatus | null;
  isLoading: boolean;
  pendingAction: SystemIntegrationAction | null;
  notice: string | null;
  error: RuntimeError | null;
};

const initialState: IntegrationState = {
  status: null,
  isLoading: true,
  pendingAction: null,
  notice: null,
  error: null,
};

function unexpectedError(message: string): RuntimeError {
  return { code: "internal", message, retryable: true };
}

export function SystemIntegrationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<IntegrationState>(initialState);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const eventRevisionRef = useRef(0);
  const requestGenerationRef = useRef(0);

  const updateState = useCallback(
    (
      updater:
        | Partial<IntegrationState>
        | ((current: IntegrationState) => IntegrationState),
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

  const applyStatus = useCallback(
    (status: SystemIntegrationStatus) => {
      updateState({
        status,
        isLoading: false,
        pendingAction: null,
        notice: null,
        error: null,
      });
    },
    [updateState],
  );

  const applyEvent = useCallback(
    (event: SystemIntegrationEvent) => {
      eventRevisionRef.current += 1;

      if (event.kind === "status") {
        applyStatus(event.status);
      } else {
        updateState({
          pendingAction: null,
          error: event.error,
          isLoading: false,
        });
      }
    },
    [applyStatus, updateState],
  );

  const refresh = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    const eventRevision = eventRevisionRef.current;
    updateState({ isLoading: true, error: null });

    try {
      const result = await getSystemIntegrationStatus();

      if (
        !mountedRef.current ||
        generation !== requestGenerationRef.current
      ) {
        return;
      }

      if (result.status === "ok") {
        if (eventRevisionRef.current === eventRevision) {
          applyStatus(result.data);
        } else {
          updateState({ isLoading: false });
        }
      } else if (result.status === "unavailable") {
        updateState({ isLoading: false, notice: unavailableNotice });
      } else {
        updateState({ isLoading: false, error: result.error });
      }
    } catch {
      if (mountedRef.current && generation === requestGenerationRef.current) {
        updateState({
          isLoading: false,
          error: unexpectedError(
            "FlowProxy could not read desktop integration state.",
          ),
        });
      }
    }
  }, [applyStatus, updateState]);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void subscribeSystemIntegration(applyEvent)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          cleanup = unlisten;
        }
      })
      .catch(() => {
        if (!disposed) {
          updateState({
            notice: "Desktop integration events are unavailable.",
          });
        }
      });
    void refresh();

    return () => {
      disposed = true;
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      cleanup?.();
    };
  }, [applyEvent, refresh, updateState]);

  const runToggle = useCallback(
    async (
      action: SystemIntegrationAction,
      command: () => ReturnType<typeof setSystemProxyEnabledCommand>,
    ) => {
      if (stateRef.current.pendingAction) {
        return;
      }

      const eventRevision = eventRevisionRef.current;
      updateState({
        pendingAction: action,
        notice: null,
        error: null,
      });

      try {
        const result = await command();

        if (!mountedRef.current) {
          return;
        }

        if (result.status === "ok") {
          if (eventRevisionRef.current === eventRevision) {
            applyStatus(result.data);
          } else {
            updateState({ pendingAction: null });
          }
        } else if (result.status === "unavailable") {
          updateState({ pendingAction: null, notice: unavailableNotice });
        } else {
          updateState({ pendingAction: null, error: result.error });
        }
      } catch {
        if (mountedRef.current) {
          updateState({
            pendingAction: null,
            error: unexpectedError(
              "FlowProxy could not update desktop integration state.",
            ),
          });
        }
      }
    },
    [applyStatus, updateState],
  );

  const setSystemProxyEnabled = useCallback(
    (enabled: boolean) =>
      runToggle("system_proxy", () => setSystemProxyEnabledCommand(enabled)),
    [runToggle],
  );

  const setLaunchAtLoginEnabled = useCallback(
    (enabled: boolean) =>
      runToggle("launch_at_login", () =>
        setLaunchAtLoginEnabledCommand(enabled),
      ),
    [runToggle],
  );

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      setSystemProxyEnabled,
      setLaunchAtLoginEnabled,
    }),
    [
      state,
      refresh,
      setSystemProxyEnabled,
      setLaunchAtLoginEnabled,
    ],
  );

  return (
    <SystemIntegrationContext.Provider value={value}>
      {children}
    </SystemIntegrationContext.Provider>
  );
}
