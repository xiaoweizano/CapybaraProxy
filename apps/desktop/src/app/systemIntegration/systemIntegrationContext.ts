import { createContext, useContext } from "react";
import type {
  SystemIntegrationStatus,
} from "../../platform/systemIntegration";
import type { RuntimeError } from "../../platform/runtime";

export type SystemIntegrationAction =
  | "system_proxy"
  | "launch_at_login";

export type SystemIntegrationContextValue = {
  status: SystemIntegrationStatus | null;
  isLoading: boolean;
  pendingAction: SystemIntegrationAction | null;
  notice: string | null;
  error: RuntimeError | null;
  refresh: () => Promise<void>;
  setSystemProxyEnabled: (enabled: boolean) => Promise<void>;
  setLaunchAtLoginEnabled: (enabled: boolean) => Promise<void>;
};

export const SystemIntegrationContext =
  createContext<SystemIntegrationContextValue | null>(null);

export function useSystemIntegration(): SystemIntegrationContextValue {
  const context = useContext(SystemIntegrationContext);

  if (!context) {
    throw new Error(
      "useSystemIntegration must be used inside SystemIntegrationProvider",
    );
  }

  return context;
}
