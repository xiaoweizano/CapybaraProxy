import { render, screen, waitFor } from "@testing-library/react";
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
import type {
  SystemIntegrationStatus,
} from "../../platform/systemIntegration";
import { CLOSE_BEHAVIOR_STORAGE_KEY } from "../../shared/closeBehavior";
import { SettingsPage } from "./SettingsPage";

vi.mock("../../platform/settings", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

const getSettingsMock = vi.mocked(getSettings);
const saveSettingsMock = vi.mocked(saveSettings);

const runtimeValue: RuntimeContextValue = {
  snapshot: null,
  coreInfo: null,
  proxyGroups: [],
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

function renderSettings(
  integration = createIntegrationValue(),
) {
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

describe("SettingsPage close behavior", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    saveSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ status: "unavailable" });
  });

  it("keeps the previous behavior when the Rust update fails", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: {
        version: 1,
        theme: "cyber_flow",
        close_behavior: "hide_to_tray",
      },
    });
    saveSettingsMock.mockResolvedValueOnce({
      status: "error",
      error: {
        code: "settings_io",
        message: "Settings could not be written.",
        retryable: true,
      },
    });
    renderSettings();
    await screen.findByText("Desktop settings");

    await user.click(
      screen.getByRole("button", { name: /Exit application/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Settings could not be written.",
    );
    expect(
      screen.getByRole("button", { name: /Hide to tray/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Exit application/ }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem(CLOSE_BEHAVIOR_STORAGE_KEY)).toBe(
      "hide_to_tray",
    );
  });

  it("persists the preference after the Rust update succeeds", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: {
        version: 1,
        theme: "cyber_flow",
        close_behavior: "hide_to_tray",
      },
    });
    saveSettingsMock.mockImplementationOnce(async (settings) => ({
      status: "ok",
      data: settings,
    }));
    renderSettings();
    await screen.findByText("Desktop settings");

    await user.click(
      screen.getByRole("button", { name: /Exit application/ }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Exit application/ }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    expect(localStorage.getItem(CLOSE_BEHAVIOR_STORAGE_KEY)).toBe(
      "exit_application",
    );
  });

  it("keeps browser preview usable without claiming native persistence", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByText("Local preview");

    await user.click(
      screen.getByRole("button", { name: /Exit application/ }),
    );

    await waitFor(() => {
      expect(localStorage.getItem(CLOSE_BEHAVIOR_STORAGE_KEY)).toBe(
        "exit_application",
      );
    });
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });
});

describe("SettingsPage system integration", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    saveSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ status: "unavailable" });
  });

  it("keeps system proxy controls functional across A/C theme switching", async () => {
    const user = userEvent.setup();
    const integration = createIntegrationValue();
    renderSettings(integration);
    await screen.findByText("Local preview");

    const proxySwitch = screen.getByRole("switch", {
      name: "System proxy",
    });
    expect(proxySwitch).toHaveAttribute("aria-checked", "false");
    expect(proxySwitch).toBeEnabled();

    await user.click(
      screen.getByRole("button", { name: /Warm Flow/ }),
    );

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute(
        "data-theme",
        "warm_flow",
      );
    });
    expect(
      screen.getByRole("switch", { name: "System proxy" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("switch", { name: "Launch at login" }),
    ).toBeEnabled();
  });

  it("calls typed system proxy and launch-at-login actions", async () => {
    const user = userEvent.setup();
    const integration = createIntegrationValue();
    renderSettings(integration);

    await user.click(
      await screen.findByRole("switch", { name: "System proxy" }),
    );
    await user.click(
      screen.getByRole("switch", { name: "Launch at login" }),
    );

    expect(integration.setSystemProxyEnabled).toHaveBeenCalledWith(true);
    expect(integration.setLaunchAtLoginEnabled).toHaveBeenCalledWith(true);
  });

  it("keeps the previous toggle state and shows a safe native error", async () => {
    const integration = createIntegrationValue({
      error: {
        code: "platform_integration",
        message: "FlowProxy could not restore the system proxy.",
        retryable: true,
      },
    });
    renderSettings(integration);

    expect(
      await screen.findByRole("switch", { name: "System proxy" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("FlowProxy could not restore the system proxy."),
    ).toBeInTheDocument();
  });

  it("disables unavailable controls and presents TUN as detection only", async () => {
    const integration = createIntegrationValue({
      status: {
        ...availableIntegrationStatus,
        capabilities: {
          ...availableIntegrationStatus.capabilities,
          system_proxy: {
            state: "blocked",
            message: "System proxy settings could not be read.",
          },
          tun: {
            state: "unverified",
            message:
              "Elevation and Wintun were detected, but TUN activation is not enabled in this phase.",
          },
        },
      },
    });
    renderSettings(integration);

    expect(
      await screen.findByRole("switch", { name: "System proxy" }),
    ).toBeDisabled();
    expect(screen.getByText("Detection only")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Elevation and Wintun were detected, but TUN activation is not enabled in this phase.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "TUN interface" }),
    ).not.toBeInTheDocument();
  });
});
