import { useCallback, useSyncExternalStore } from "react";
import {
  getTelemetry,
  type RuntimeBridgeResult,
  type RuntimeError,
  type TelemetrySnapshot,
} from "../../platform/runtime";
import {
  APP_VISIBILITY_EVENT,
  isAppHidden,
} from "../../shared/appVisibility";

export type TelemetryPoint = {
  timestampMs: number;
  uploadBps: number;
  downloadBps: number;
  activeConnections: number;
};

export type TelemetryState = {
  latest: TelemetrySnapshot | null;
  history: TelemetryPoint[];
  lastError: RuntimeError | null;
  isSampling: boolean;
};

type TelemetryFetcher = () => Promise<RuntimeBridgeResult<TelemetrySnapshot>>;

export type TelemetryStore = {
  getSnapshot: () => TelemetryState;
  subscribe: (listener: (state: TelemetryState) => void) => () => void;
  sampleNow: () => Promise<void>;
};

const initialTelemetryState: TelemetryState = {
  latest: null,
  history: [],
  lastError: null,
  isSampling: false,
};

export function createTelemetryStore(
  fetchTelemetry: TelemetryFetcher,
  intervalMs = 1_000,
  historyLimit = 28,
): TelemetryStore {
  let state = initialTelemetryState;
  let timerId: number | undefined;
  let inFlight = false;
  let visibilityBound = false;
  const listeners = new Set<(state: TelemetryState) => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const clearTimer = () => {
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timerId = undefined;
    }
  };

  const scheduleNextSample = () => {
    clearTimer();

    if (listeners.size === 0 || isAppHidden()) {
      return;
    }

    timerId = window.setTimeout(() => {
      timerId = undefined;
      void sampleNow();
    }, intervalMs);
  };

  const syncSampling = () => {
    if (listeners.size === 0 || isAppHidden()) {
      clearTimer();
      return;
    }

    if (!inFlight && timerId === undefined) {
      void sampleNow();
    }
  };

  const bindVisibility = () => {
    if (visibilityBound) {
      return;
    }

    visibilityBound = true;
    document.addEventListener("visibilitychange", syncSampling);
    window.addEventListener(APP_VISIBILITY_EVENT, syncSampling);
  };

  const unbindVisibility = () => {
    if (!visibilityBound || listeners.size > 0) {
      return;
    }

    visibilityBound = false;
    document.removeEventListener("visibilitychange", syncSampling);
    window.removeEventListener(APP_VISIBILITY_EVENT, syncSampling);
  };

  const sampleNow = async (): Promise<void> => {
    if (inFlight || isAppHidden()) {
      return;
    }

    clearTimer();
    inFlight = true;
    state = { ...state, isSampling: true };
    notify();

    try {
      const result = await fetchTelemetry();

      if (result.status === "ok") {
        const previousTimestamp = state.latest?.timestamp_ms;
        const isNewSample =
          previousTimestamp === undefined ||
          result.data.timestamp_ms > previousTimestamp;
        const point: TelemetryPoint = {
          timestampMs: result.data.timestamp_ms,
          uploadBps: result.data.upload_bps,
          downloadBps: result.data.download_bps,
          activeConnections: result.data.active_connections,
        };

        state = {
          latest: result.data,
          history: isNewSample
            ? [...state.history, point].slice(-historyLimit)
            : state.history,
          lastError: null,
          isSampling: true,
        };
      } else if (result.status === "error") {
        state = { ...state, lastError: result.error };
      }
    } catch {
      state = {
        ...state,
        lastError: {
          code: "internal",
          message: "FlowProxy could not read live telemetry.",
          retryable: true,
        },
      };
    } finally {
      inFlight = false;
      state = { ...state, isSampling: false };
      notify();
      scheduleNextSample();
    }
  };

  const subscribe = (listener: (state: TelemetryState) => void) => {
    listeners.add(listener);
    bindVisibility();
    syncSampling();

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        clearTimer();
        unbindVisibility();
      }
    };
  };

  return {
    getSnapshot: () => state,
    subscribe,
    sampleNow,
  };
}

export const telemetryStore = createTelemetryStore(getTelemetry);

export function useTelemetry(enabled = true): TelemetryState {
  const subscribe = useCallback(
    (listener: (state: TelemetryState) => void) =>
      enabled ? telemetryStore.subscribe(listener) : () => undefined,
    [enabled],
  );

  return useSyncExternalStore(
    subscribe,
    telemetryStore.getSnapshot,
    telemetryStore.getSnapshot,
  );
}
