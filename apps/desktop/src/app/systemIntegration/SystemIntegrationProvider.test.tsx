import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSystemIntegrationStatus,
  setLaunchAtLoginEnabled,
  setSystemProxyEnabled,
  subscribeSystemIntegration,
  type SystemIntegrationEvent,
  type SystemIntegrationStatus,
} from "../../platform/systemIntegration";
import { SystemIntegrationProvider } from "./SystemIntegrationProvider";
import { useSystemIntegration } from "./systemIntegrationContext";

vi.mock("../../platform/systemIntegration", () => ({
  getSystemIntegrationStatus: vi.fn(),
  setSystemProxyEnabled: vi.fn(),
  setLaunchAtLoginEnabled: vi.fn(),
  subscribeSystemIntegration: vi.fn(),
}));

const getStatusMock = vi.mocked(getSystemIntegrationStatus);
const setProxyMock = vi.mocked(setSystemProxyEnabled);
const setLoginMock = vi.mocked(setLaunchAtLoginEnabled);
const subscribeMock = vi.mocked(subscribeSystemIntegration);

const availableStatus: SystemIntegrationStatus = {
  platform: "windows",
  capabilities: {
    system_proxy: { state: "available", message: "System proxy is available." },
    launch_at_login: {
      state: "available",
      message: "Launch at login is available.",
    },
    tun: { state: "blocked", message: "The Wintun driver is missing." },
  },
  system_proxy: {
    state: "managed_inactive",
    managed: true,
    active: false,
  },
  launch_at_login: { state: "disabled", enabled: false },
  last_error: null,
};

function Probe() {
  const integration = useSystemIntegration();

  return (
    <div>
      <span>{integration.status?.platform ?? "no-platform"}</span>
      <span>
        Proxy: {integration.status?.system_proxy.state ?? "no-proxy"}
      </span>
      <span>
        Login: {integration.status?.launch_at_login.state ?? "no-login"}
      </span>
      <span>{integration.error?.message ?? "no-error"}</span>
      <span>{integration.notice ?? "no-notice"}</span>
      <button type="button" onClick={() => void integration.refresh()}>
        Refresh
      </button>
      <button
        type="button"
        onClick={() => void integration.setSystemProxyEnabled(true)}
      >
        Enable proxy
      </button>
      <button
        type="button"
        onClick={() => void integration.setLaunchAtLoginEnabled(true)}
      >
        Enable login
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <SystemIntegrationProvider>
      <Probe />
    </SystemIntegrationProvider>,
  );
}

describe("SystemIntegrationProvider", () => {
  beforeEach(() => {
    getStatusMock.mockReset();
    setProxyMock.mockReset();
    setLoginMock.mockReset();
    subscribeMock.mockReset();
    subscribeMock.mockResolvedValue(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads on mount without introducing a polling timer", async () => {
    vi.useFakeTimers();
    getStatusMock.mockResolvedValue({ status: "ok", data: availableStatus });
    renderProvider();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("windows")).toBeInTheDocument();
    expect(getStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getStatusMock).toHaveBeenCalledTimes(1);
  });

  it("retains the previous status when a toggle command fails", async () => {
    const user = userEvent.setup();
    getStatusMock.mockResolvedValue({ status: "ok", data: availableStatus });
    setProxyMock.mockResolvedValue({
      status: "error",
      error: {
        code: "platform_integration",
        message: "CapybaraProxy could not update the system proxy.",
        retryable: true,
      },
    });
    renderProvider();
    await screen.findByText("windows");

    await user.click(
      screen.getByRole("button", { name: "Enable proxy" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Proxy: managed_inactive"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("CapybaraProxy could not update the system proxy."),
    ).toBeInTheDocument();
  });

  it("applies successful proxy and launch-at-login updates", async () => {
    const user = userEvent.setup();
    const proxyEnabled: SystemIntegrationStatus = {
      ...availableStatus,
      system_proxy: { state: "enabled", managed: true, active: true },
    };
    const loginEnabled: SystemIntegrationStatus = {
      ...proxyEnabled,
      launch_at_login: { state: "enabled", enabled: true },
    };
    getStatusMock.mockResolvedValue({ status: "ok", data: availableStatus });
    setProxyMock.mockResolvedValue({ status: "ok", data: proxyEnabled });
    setLoginMock.mockResolvedValue({ status: "ok", data: loginEnabled });
    renderProvider();
    await screen.findByText("windows");

    await user.click(
      screen.getByRole("button", { name: "Enable proxy" }),
    );
    await screen.findByText("Proxy: enabled");
    await user.click(
      screen.getByRole("button", { name: "Enable login" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Login: enabled")).toBeInTheDocument();
    });
    expect(setProxyMock).toHaveBeenCalledWith(true);
    expect(setLoginMock).toHaveBeenCalledWith(true);
  });

  it("updates from typed native events and unsubscribes on unmount", async () => {
    const cleanup = vi.fn();
    let eventListener: ((event: SystemIntegrationEvent) => void) | undefined;
    getStatusMock.mockResolvedValue({ status: "ok", data: availableStatus });
    subscribeMock.mockImplementation(async (listener) => {
      eventListener = listener;
      return cleanup;
    });
    const rendered = renderProvider();
    await screen.findByText("windows");

    act(() => {
      eventListener?.({
        kind: "status",
        status: {
          ...availableStatus,
          system_proxy: {
            state: "enabled",
            managed: true,
            active: true,
          },
        },
      });
    });
    expect(screen.getByText("Proxy: enabled")).toBeInTheDocument();

    act(() => {
      eventListener?.({
        kind: "error",
        error: {
          code: "platform_integration",
          message: "Proxy restoration failed.",
          retryable: true,
        },
      });
    });
    expect(screen.getByText("Proxy restoration failed.")).toBeInTheDocument();

    rendered.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("applies an explicit refresh after a native event", async () => {
    const user = userEvent.setup();
    let eventListener: ((event: SystemIntegrationEvent) => void) | undefined;
    const refreshedStatus: SystemIntegrationStatus = {
      ...availableStatus,
      launch_at_login: { state: "enabled", enabled: true },
    };
    getStatusMock
      .mockResolvedValueOnce({ status: "ok", data: availableStatus })
      .mockResolvedValueOnce({ status: "ok", data: refreshedStatus });
    subscribeMock.mockImplementation(async (listener) => {
      eventListener = listener;
      return () => undefined;
    });
    renderProvider();
    await screen.findByText("windows");

    act(() => {
      eventListener?.({
        kind: "status",
        status: {
          ...availableStatus,
          system_proxy: {
            state: "enabled",
            managed: true,
            active: true,
          },
        },
      });
    });
    expect(screen.getByText("Proxy: enabled")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("Proxy: managed_inactive")).toBeInTheDocument();
    });
    expect(screen.getByText("Login: enabled")).toBeInTheDocument();
  });

  it("shows an explicit preview notice when native integration is unavailable", async () => {
    getStatusMock.mockResolvedValue({ status: "unavailable" });
    renderProvider();

    expect(
      await screen.findByText(
        "Desktop system integration is unavailable in this preview.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Proxy: no-proxy")).toBeInTheDocument();
  });
});
