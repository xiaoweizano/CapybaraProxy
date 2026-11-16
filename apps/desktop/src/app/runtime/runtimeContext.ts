import { createContext, useContext } from "react";
import type {
  CoreInfo,
  ProxyGroup,
  RuntimeError,
  RuntimeLogEntry,
  RuntimeSnapshot,
} from "../../platform/runtime";

export type RuntimeAction = "start" | "stop" | "restart";

export type RuntimeViewState = {
  snapshot: RuntimeSnapshot | null;
  coreInfo: CoreInfo | null;
  proxyGroups: ProxyGroup[];
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
};

export const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function useRuntime(): RuntimeContextValue {
  const context = useContext(RuntimeContext);

  if (!context) {
    throw new Error("useRuntime must be used inside RuntimeProvider");
  }

  return context;
}
