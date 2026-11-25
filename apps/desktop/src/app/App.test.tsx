import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCoreInfo,
  getProfiles,
  getProxyGroups,
  getRules,
  getRuntimeLogs,
  getRuntimeSnapshot,
  getSubscriptionSnapshot,
  getTelemetry,
  subscribeRuntimeLog,
  subscribeRuntimeState,
} from "../platform/runtime";
import { getSettings } from "../platform/settings";
import { SETTINGS_MIGRATION_KEY } from "./settings/settingsContext";
import { App } from "./App";

vi.mock("../platform/runtime", () => ({
  closeConnection: vi.fn(),
  getConnections: vi.fn(),
  getCoreInfo: vi.fn(),
  getProfiles: vi.fn(),
  getSubscriptionSnapshot: vi.fn(),
  getProxyGroups: vi.fn(),
  getRules: vi.fn(),
  getRuntimeLogs: vi.fn(),
  getRuntimeSnapshot: vi.fn(),
  getTelemetry: vi.fn(),
  requestApplicationExit: vi.fn(),
  restartRuntime: vi.fn(),
  selectProxy: vi.fn(),
  simulateRuntimeCrash: vi.fn(),
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
  subscribeRuntimeLog: vi.fn(),
  subscribeRuntimeState: vi.fn(),
  testProxyDelay: vi.fn(),
}));
vi.mock("../platform/settings", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

const getSettingsMock = vi.mocked(getSettings);
const getCoreInfoMock = vi.mocked(getCoreInfo);
const getProfilesMock = vi.mocked(getProfiles);
const getProxyGroupsMock = vi.mocked(getProxyGroups);
const getRulesMock = vi.mocked(getRules);
const getRuntimeLogsMock = vi.mocked(getRuntimeLogs);
const getRuntimeSnapshotMock = vi.mocked(getRuntimeSnapshot);
const getSubscriptionSnapshotMock = vi.mocked(getSubscriptionSnapshot);
const getTelemetryMock = vi.mocked(getTelemetry);
const subscribeRuntimeLogMock = vi.mocked(subscribeRuntimeLog);
const subscribeRuntimeStateMock = vi.mocked(subscribeRuntimeState);

const connectedSnapshot = {
  backend: "mihomo" as const,
  state: "connected" as const,
  sequence: 2,
  started_at_ms: 1_760_000_000_000,
  last_error: null,
  log_count: 1,
};

describe("App shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = "#/";
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ status: "unavailable" });
    getCoreInfoMock.mockReset().mockResolvedValue({
      status: "ok",
      data: { backend: "mihomo", version: "v1.19.33", pid: 42 },
    });
    getProfilesMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [
        {
          id: "profile-1",
          name: "Primary profile",
          active: true,
          updated_at_ms: 1_760_000_000_000,
          source: null,
          proxy_count: null,
        },
      ],
    });
    getProxyGroupsMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [
        {
          name: "Proxy",
          group_type: "Selector",
          selected: "Tokyo 01",
          nodes: [
            {
              name: "Tokyo 01",
              proxy_type: "Shadowsocks",
              udp: true,
              delay_ms: 42,
              alive: true,
            },
          ],
        },
      ],
    });
    getRulesMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [
        {
          index: 0,
          rule_type: "DOMAIN-SUFFIX",
          payload: "example.com",
          proxy: "Proxy",
        },
      ],
    });
    getRuntimeLogsMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [
        {
          sequence: 1,
          timestamp_ms: 1_760_000_000_000,
          level: "info",
          message: "Mihomo core is ready.",
          error_code: null,
        },
      ],
    });
    getRuntimeSnapshotMock.mockReset().mockResolvedValue({
      status: "ok",
      data: connectedSnapshot,
    });
    getSubscriptionSnapshotMock.mockReset().mockResolvedValue({
      status: "ok",
      data: { groups: [], rules: [], has_subscription: false },
    });
    getTelemetryMock.mockReset().mockResolvedValue({
      status: "ok",
      data: {
        state: "connected",
        timestamp_ms: Date.now(),
        upload_bps: 1_024,
        download_bps: 2_048,
        total_upload_bytes: 4_096,
        total_download_bytes: 8_192,
        memory_bytes: 16_384,
        active_connections: 1,
      },
    });
    subscribeRuntimeLogMock.mockReset().mockResolvedValue(() => undefined);
    subscribeRuntimeStateMock.mockReset().mockResolvedValue(() => undefined);
  });

  it("mounts the real Runtime and renders live Overview state", async () => {
    render(<App />);

    expect(await screen.findByText("Connected")).toBeInTheDocument();

    for (const label of [
      "Overview",
      "Proxies",
      "Rules",
      "Connections",
      "Profiles",
      "Logs",
      "Settings",
    ]) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }

    expect(screen.queryByText(/mock preview/i)).not.toBeInTheDocument();
    expect(await screen.findAllByText("Tokyo 01")).toHaveLength(3);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Use Cyber Flow theme" }),
      ).toBeEnabled();
    });
  });

  it("navigates to every real workspace and no longer shows module placeholders", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("Tokyo 01");
    expect(screen.queryByText("UI shell")).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Proxies" }));
    expect(
      await screen.findByRole("heading", { name: "Proxies" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Tokyo 01")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Rules" }));
    expect(
      await screen.findByRole("heading", { name: "Rules" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("example.com")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Connections" }));
    expect(
      await screen.findByRole("heading", { name: "Connections" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Profiles" }));
    expect(
      await screen.findByRole("heading", { name: "Profiles" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Primary profile")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Logs" }));
    expect(
      await screen.findByRole("heading", { name: "Logs" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mihomo core is ready.")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Settings" }));

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cyber Flow")).toBeInTheDocument();
    expect(screen.getByText("Warm Flow")).toBeInTheDocument();
  });

  it("applies settings loaded from the Rust store", async () => {
    window.localStorage.setItem(SETTINGS_MIGRATION_KEY, "1");
    getSettingsMock.mockResolvedValueOnce({
      status: "ok",
      data: {
        version: 1,
        theme: "warm_flow",
        close_behavior: "hide_to_tray",
      },
    });
    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("warm_flow");
    });
  });

  it("keeps the selected Warm Flow theme across an application remount", async () => {
    const user = userEvent.setup();
    const firstRender = render(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    await screen.findByText("Local preview");
    await user.click(
      screen.getByRole("button", { name: "Warm Flow Soft daylight" }),
    );

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("warm_flow");
      expect(window.localStorage.getItem("flowproxy.theme")).toBe("warm_flow");
    });

    firstRender.unmount();
    window.location.hash = "#/";
    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("warm_flow");
    });
    expect(
      screen.getByRole("img", { name: "FlowProxy mascot" }),
    ).toBeInTheDocument();
  });
});

