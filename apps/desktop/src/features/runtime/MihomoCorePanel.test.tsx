import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimeContext,
  type RuntimeContextValue,
} from "../../app/runtime/runtimeContext";
import {
  SystemIntegrationContext,
  type SystemIntegrationContextValue,
} from "../../app/systemIntegration/systemIntegrationContext";
import type {
  RuntimeLogEntry,
  RuntimeSnapshot,
} from "../../platform/runtime";
import { MihomoCorePanel } from "./MihomoCorePanel";

const connectedSnapshot: RuntimeSnapshot = {
  backend: "mihomo",
  state: "connected",
  sequence: 8,
  started_at_ms: 1_760_000_000_000,
  last_error: null,
  log_count: 105,
};

const logs: RuntimeLogEntry[] = Array.from({ length: 105 }, (_, index) => ({
  sequence: index + 1,
  timestamp_ms: 1_760_000_000_000 + index,
  level: "info" as const,
  message: `Runtime log ${index + 1}`,
  error_code: null,
}));

function createRuntimeValue(
  overrides: Partial<RuntimeContextValue> = {},
): RuntimeContextValue {
  return {
    snapshot: connectedSnapshot,
    coreInfo: {
      backend: "mihomo",
      version: "v1.19.33",
      pid: 4242,
    },
    proxyGroups: [],
    corePreferences: { mode: "rule", log_level: "warning" },
    logs,
    isLoading: false,
    pendingAction: null,
    notice: null,
    lastError: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    selectProxy: vi.fn().mockResolvedValue(undefined),
    measureDelay: vi.fn().mockResolvedValue(null),
    measureGroupDelay: vi.fn().mockResolvedValue({}),
    setRoutingMode: vi.fn().mockResolvedValue(undefined),
    setCoreLogLevel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderPanel(overrides: Partial<RuntimeContextValue> = {}) {
  const value = createRuntimeValue(overrides);
  const integration: SystemIntegrationContextValue = {
    status: {
      platform: "windows",
      capabilities: {
        system_proxy: {
          state: "available",
          message: "Windows system proxy settings are available.",
        },
        launch_at_login: {
          state: "available",
          message: "Windows launch-at-login settings are available.",
        },
        tun: {
          state: "blocked",
          message: "The Wintun driver library is not installed.",
        },
      },
      system_proxy: {
        state: "enabled",
        managed: true,
        active: true,
      },
      launch_at_login: {
        state: "disabled",
        enabled: false,
      },
      last_error: null,
    },
    isLoading: false,
    pendingAction: null,
    notice: null,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    setSystemProxyEnabled: vi.fn().mockResolvedValue(undefined),
    setLaunchAtLoginEnabled: vi.fn().mockResolvedValue(undefined),
  };

  render(
    <SystemIntegrationContext.Provider value={integration}>
      <RuntimeContext.Provider value={value}>
        <MihomoCorePanel />
      </RuntimeContext.Provider>
    </SystemIntegrationContext.Provider>,
  );

  return value;
}

describe("MihomoCorePanel", () => {
  it("renders live core details and current native integration boundaries", () => {
    renderPanel();

    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(screen.getByText("v1.19.33")).toBeInTheDocument();
    expect(screen.getByText("4242")).toBeInTheDocument();
    expect(screen.getByText("mihomo")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.queryByText("Not implemented")).not.toBeInTheDocument();
    expect(screen.getByText("Runtime log 105")).toBeInTheDocument();
    expect(screen.queryByText("Runtime log 5")).not.toBeInTheDocument();
  });

  it("invokes shared lifecycle actions for the current state", async () => {
    const user = userEvent.setup();
    const value = renderPanel();

    await user.click(screen.getByRole("button", { name: "Restart core" }));
    await user.click(screen.getByRole("button", { name: "Stop core" }));

    expect(value.restart).toHaveBeenCalledTimes(1);
    expect(value.stop).toHaveBeenCalledTimes(1);
    expect(value.start).not.toHaveBeenCalled();
  });

  it("disables conflicting controls while a lifecycle action is pending", () => {
    renderPanel({
      pendingAction: "restart",
      snapshot: {
        ...connectedSnapshot,
        state: "stopping",
      },
    });

    expect(screen.getByRole("button", { name: "Start core" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop core" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restarting core" })).toBeDisabled();
  });

  it("shows structured Runtime errors and the shared bridge notice", () => {
    renderPanel({
      notice: "Desktop Runtime is unavailable.",
      lastError: {
        code: "config_invalid",
        message: "The selected Mihomo profile is invalid.",
        retryable: false,
      },
    });

    expect(
      screen.getByText("The selected Mihomo profile is invalid."),
    ).toBeInTheDocument();
    expect(screen.getByText("config_invalid")).toBeInTheDocument();
    expect(
      screen.getByText("Desktop Runtime is unavailable."),
    ).toBeInTheDocument();
  });
});
