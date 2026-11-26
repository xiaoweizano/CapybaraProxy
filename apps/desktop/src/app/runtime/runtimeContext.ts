import { createContext, useContext } from "react";
import type {
  CoreInfo,
  CoreLogLevel,
  CorePreferences,
  ProxyGroup,
  RoutingMode,
  RuntimeError,
  RuntimeLogEntry,
  RuntimeSnapshot,
} from "../../platform/runtime";

export type RuntimeAction = "start" | "stop" | "restart";

export type RuntimeViewState = {
  snapshot: RuntimeSnapshot | null;
  coreInfo: CoreInfo | null;
  proxyGroups: ProxyGroup[];
  corePreferences: CorePreferences | null;
  logs: RuntimeLogEntry[];
  isLoading: boolean;
  pendingAction: RuntimeAction | null;
  notice: string | null;
  lastError: RuntimeError | null;
};

export type RuntimeContextValue = RuntimeViewState & {
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  selectProxy: (group: string, proxy: string) => Promise<void>;
  measureDelay: (proxy: string, timeoutMs?: number) => Promise<number | null>;
  /** Probes every node of one group; returns per-node delays keyed by name. */
  measureGroupDelay: (
    group: string,
    timeoutMs?: number,
  ) => Promise<Record<string, number> | null>;
  /** Routing mode and log level the core reports, once connected. */
  corePreferences: CorePreferences | null;
  setRoutingMode: (mode: RoutingMode) => Promise<void>;
  setCoreLogLevel: (level: CoreLogLevel) => Promise<void>;
};

export const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function useRuntime(): RuntimeContextValue {
  const context = useContext(RuntimeContext);

  if (!context) {
    throw new Error("useRuntime must be used inside RuntimeProvider");
  }

  return context;
}
