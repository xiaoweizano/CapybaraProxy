import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeContext,
  type RuntimeContextValue,
} from "../../app/runtime/runtimeContext";
import { SettingsProvider } from "../../app/settings/SettingsProvider";
import {
  SystemIntegrationContext,
  type SystemIntegrationContextValue,
} from "../../app/systemIntegration/systemIntegrationContext";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import { getSettings, saveSettings } from "../../platform/settings";
import type { SystemIntegrationStatus } from "../../platform/systemIntegration";
import { SettingsPage } from "./SettingsPage";

vi.mock("../../platform/settings", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  applyNativeUiScale: vi.fn(),
}));

const getSettingsMock = vi.mocked(getSettings);
const saveSettingsMock = vi.mocked(saveSettings);

const runtimeValue: RuntimeContextValue = {
  snapshot: null,
  coreInfo: null,
  proxyGroups: [],
  corePreferences: null,
  logs: [],
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
};

const availableIntegrationStatus: SystemIntegrationStatus = {
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
    state: "disabled",
    managed: false,
    active: false,
  },
  launch_at_login: {
    state: "disabled",
    enabled: false,
  },
  last_error: null,
};

function createIntegrationValue(
  overrides: Partial<SystemIntegrationContextValue> = {},
): SystemIntegrationContextValue {
  return {
    status: availableIntegrationStatus,
    isLoading: false,
    pendingAction: null,
    notice: null,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    setSystemProxyEnabled: vi.fn().mockResolvedValue(undefined),
    setLaunchAtLoginEnabled: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderSettings(integration = createIntegrationValue()) {
  return render(
    <RuntimeContext.Provider value={runtimeValue}>
      <SystemIntegrationContext.Provider value={integration}>
        <SettingsProvider>
          <ThemeProvider>
            <SettingsPage />
          </ThemeProvider>
        </SettingsProvider>
      </SystemIntegrationContext.Provider>
    </RuntimeContext.Provider>,
  );
}

function nativeSettings(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    theme: "cyber_flow" as const,
    close_behavior: "hide_to_tray" as const,
    ...overrides,
  };
}

describe("SettingsPage layout modes", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    saveSettingsMock.mockReset();
    localStorage.clear();
  });

  it("shows only the essential groups in simple mode", async () => {
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: nativeSettings({ settings_mode: "simple" }),
    });
    renderSettings();

    expect(
      await screen.findByRole("heading", { name: "Appearance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Window" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "System integration" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Subscription" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sub-Store" })).not.toBeInTheDocument();
  });

  it("shows subscription, logs and core in standard mode", async () => {
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: nativeSettings({ settings_mode: "standard" }),
    });
    renderSettings();

    expect(
      await screen.findByRole("heading", { name: "Subscription" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Core" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Tray" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Advanced core" }),
    ).not.toBeInTheDocument();
  });

  it("shows every group in relaxed mode", async () => {
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: nativeSettings({ settings_mode: "relaxed" }),
    });
    renderSettings();

    expect(
      await screen.findByRole("heading", { name: "Tray" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Advanced core" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sub-Store" }),
    ).toBeInTheDocument();
  });

  it("persists a mode change and re-renders the visible groups", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: nativeSettings({ settings_mode: "simple" }),
    });
    saveSettingsMock.mockImplementation(async (settings) => ({
      status: "ok",
      data: settings,
    }));
    renderSettings();

    await user.click(await screen.findByRole("button", { name: /Relaxed/ }));

    expect(
      await screen.findByRole("heading", { name: "Sub-Store" }),
    ).toBeInTheDocument();
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ settings_mode: "relaxed" }),
    );
  });
});

describe("SettingsPage preferences", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    saveSettingsMock.mockReset();
    localStorage.clear();
  });

  it("persists the silent start toggle", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: nativeSettings(),
    });
    saveSettingsMock.mockImplementation(async (settings) => ({
      status: "ok",
      data: settings,
    }));
    renderSettings();

    await user.click(
      await screen.findByRole("switch", { name: "Silent start" }),
    );

    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ silent_start: true }),
    );
  });

  it("round-trips the window size so saving another preference keeps it", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: nativeSettings({ window_width: 1290, window_height: 840 }),
    });
    saveSettingsMock.mockImplementation(async (settings) => ({
      status: "ok",
      data: settings,
    }));
    renderSettings();

    await user.click(
      await screen.findByRole("switch", { name: "Silent start" }),
    );

    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        window_width: 1290,
        window_height: 840,
      }),
    );
  });

  it("writes the reduced-motion preference to the document root", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: nativeSettings({ settings_mode: "relaxed" }),
    });
    saveSettingsMock.mockImplementation(async (settings) => ({
      status: "ok",
      data: settings,
    }));
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Reduced" }));

    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ motion: "reduced" }),
    );
  });

  it("rejects a privileged mixed-port instead of saving it", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: nativeSettings({ settings_mode: "relaxed" }),
    });
    saveSettingsMock.mockImplementation(async (settings) => ({
      status: "ok",
      data: settings,
    }));
    renderSettings();

    const portInput = await screen.findByRole("spinbutton", {
      name: "Mixed port",
    });
    await user.clear(portInput);
    await user.type(portInput, "80");
    await user.tab();

    expect(
      await screen.findByText("Enter a port between 1024 and 65535."),
    ).toBeInTheDocument();
    expect(saveSettingsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ fixed_proxy_port: 80 }),
    );
  });
});
