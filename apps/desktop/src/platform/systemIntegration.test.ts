import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSystemIntegrationStatus,
  setLaunchAtLoginEnabled,
  setSystemProxyEnabled,
  subscribeSystemIntegration,
  type SystemIntegrationStatus,
} from "./systemIntegration";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

const status: SystemIntegrationStatus = {
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
    state: "managed_inactive",
    managed: true,
    active: false,
  },
  launch_at_login: {
    state: "conflict",
    enabled: false,
  },
  last_error: null,
};

function enableTauriRuntime() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

describe("system integration bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("reports unavailable in browser preview", async () => {
    await expect(getSystemIntegrationStatus()).resolves.toEqual({
      status: "unavailable",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads a narrow validated integration status", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({ ok: true, data: status });

    await expect(getSystemIntegrationStatus()).resolves.toEqual({
      status: "ok",
      data: status,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "get_system_integration_status",
      undefined,
    );
  });

  it("passes only boolean toggle intent to fixed commands", async () => {
    enableTauriRuntime();
    invokeMock
      .mockResolvedValueOnce({ ok: true, data: status })
      .mockResolvedValueOnce({ ok: true, data: status });

    await setSystemProxyEnabled(true);
    await setLaunchAtLoginEnabled(false);

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "set_system_proxy_enabled",
      { enabled: true },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "set_launch_at_login_enabled",
      { enabled: false },
    );
  });

  it("preserves the structured platform integration error", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "platform_integration",
        message: "CapybaraProxy could not update the system proxy.",
        retryable: true,
      },
    });

    await expect(setSystemProxyEnabled(false)).resolves.toEqual({
      status: "error",
      error: {
        code: "platform_integration",
        message: "CapybaraProxy could not update the system proxy.",
        retryable: true,
      },
    });
  });

  it("rejects unsupported payload fields instead of exposing native details", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        ...status,
        registry_path:
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      },
    });

    const result = await getSystemIntegrationStatus();

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("internal");
      expect(result.error.message).not.toContain("HKCU");
    }
  });

  it("accepts only validated status events and ignores raw native errors", async () => {
    enableTauriRuntime();
    const listener = vi.fn();
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementationOnce(
      async (_eventName: string, handler: typeof eventHandler) => {
        eventHandler = handler;
        return () => undefined;
      },
    );

    await subscribeSystemIntegration(listener);
    eventHandler?.({ payload: { kind: "status", status } });
    eventHandler?.({
      payload: {
        kind: "status",
        status: { ...status, executable_path: "C:\\secret\\CapybaraProxy.exe" },
      },
    });
    eventHandler?.({
      payload: {
        kind: "error",
        error: {
          code: "platform_integration",
          message: "CapybaraProxy could not restore the system proxy.",
          retryable: true,
        },
      },
    });
    eventHandler?.({
      payload: {
        kind: "error",
        error: {
          code: "platform_integration",
          message: "raw backend details",
          retryable: true,
          registry_value: "ProxyServer=127.0.0.1:7890",
        },
      },
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { kind: "status", status });
    expect(listener).toHaveBeenNthCalledWith(2, {
      kind: "error",
      error: {
        code: "platform_integration",
        message: "CapybaraProxy could not restore the system proxy.",
        retryable: true,
      },
    });
  });
});
