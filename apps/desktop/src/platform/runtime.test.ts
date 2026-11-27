import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeConnection,
  getConnections,
  getCoreInfo,
  getProfiles,
  getProxyGroups,
  getRuntimeLogs,
  getRuntimeSnapshot,
  getRules,
  getTelemetry,
  selectProxy,
  startRuntime,
  subscribeRuntimeLog,
  subscribeRuntimeState,
  testProxyDelay,
} from "./runtime";

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

const stoppedSnapshot = {
  backend: "demo",
  state: "stopped",
  sequence: 0,
  started_at_ms: null,
  last_error: null,
  log_count: 0,
} as const;

function enableTauriRuntime() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

describe("runtime bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("reports unavailable without invoking Tauri in browser preview", async () => {
    const result = await getRuntimeSnapshot();

    expect(result).toEqual({ status: "unavailable" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads a validated runtime snapshot through the fixed command", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: stoppedSnapshot,
    });

    const result = await getRuntimeSnapshot();

    expect(result).toEqual({
      status: "ok",
      data: stoppedSnapshot,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_runtime_snapshot", undefined);
  });

  it("preserves a structured Runtime error from a command", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "already_running",
        message: "CapybaraProxy Runtime is already running.",
        retryable: false,
      },
    });

    const result = await startRuntime();

    expect(result).toEqual({
      status: "error",
      error: {
        code: "already_running",
        message: "CapybaraProxy Runtime is already running.",
        retryable: false,
      },
    });
  });

  it("rejects malformed command success payloads", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: { ...stoppedSnapshot, state: "invented_state" },
    });

    const result = await getRuntimeSnapshot();

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("internal");
      expect(result.error.message).toBe(
        "CapybaraProxy received an invalid Runtime response.",
      );
    }
  });

  it("validates log payloads and preserves bounded metadata", async () => {
    enableTauriRuntime();
    const logs = [
      {
        sequence: 4,
        timestamp_ms: 1_760_000_000_000,
        level: "warn",
        message: "Demo Runtime stopped.",
        error_code: "not_running",
      },
    ];
    invokeMock.mockResolvedValueOnce({ ok: true, data: logs });

    await expect(getRuntimeLogs()).resolves.toEqual({
      status: "ok",
      data: logs,
    });
  });

  it("ignores invalid Runtime state events", async () => {
    enableTauriRuntime();
    const listener = vi.fn();
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementationOnce(
      async (_eventName: string, handler: typeof eventHandler) => {
        eventHandler = handler;
        return () => undefined;
      },
    );

    await subscribeRuntimeState(listener);
    eventHandler?.({ payload: stoppedSnapshot });
    eventHandler?.({
      payload: { ...stoppedSnapshot, state: "invented_state" },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(stoppedSnapshot);
  });

  it("ignores invalid Runtime log events", async () => {
    enableTauriRuntime();
    const listener = vi.fn();
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementationOnce(
      async (_eventName: string, handler: typeof eventHandler) => {
        eventHandler = handler;
        return () => undefined;
      },
    );

    await subscribeRuntimeLog(listener);
    eventHandler?.({
      payload: {
        sequence: 1,
        timestamp_ms: 1,
        level: "verbose",
        message: "invalid",
        error_code: null,
      },
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("cleans up an event listener only once", async () => {
    enableTauriRuntime();
    const unlisten = vi.fn();
    listenMock.mockResolvedValueOnce(unlisten);

    const cleanup = await subscribeRuntimeState(() => undefined);

    cleanup();
    cleanup();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("validates typed telemetry and proxy group payloads", async () => {
    enableTauriRuntime();
    invokeMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          backend: "mihomo",
          version: "v1.19.33",
          pid: 42,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          state: "connected",
          timestamp_ms: 1_760_000_000_000,
          upload_bps: 120,
          download_bps: 420,
          total_upload_bytes: 10_000,
          total_download_bytes: 20_000,
          memory_bytes: 8_000_000,
          active_connections: 3,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            name: "Auto Select",
            group_type: "Selector",
            selected: "Direct",
            nodes: [
              {
                name: "Direct",
                proxy_type: "Direct",
                udp: true,
                delay_ms: null,
                alive: true,
              },
            ],
          },
        ],
      });

    await expect(getCoreInfo()).resolves.toMatchObject({
      status: "ok",
      data: { version: "v1.19.33", pid: 42 },
    });
    await expect(getTelemetry()).resolves.toMatchObject({
      status: "ok",
      data: { upload_bps: 120, active_connections: 3 },
    });
    await expect(getProxyGroups()).resolves.toMatchObject({
      status: "ok",
      data: [{ selected: "Direct" }],
    });
  });

  it("rejects a proxy group node without required fields", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          name: "Auto Select",
          group_type: "Selector",
          selected: "Direct",
          nodes: [{ name: "Direct" }],
        },
      ],
    });

    const result = await getProxyGroups();

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("internal");
    }
  });

  it("passes typed arguments to fixed data commands", async () => {
    enableTauriRuntime();
    invokeMock
      .mockResolvedValueOnce({ ok: true, data: null })
      .mockResolvedValueOnce({ ok: true, data: 36 })
      .mockResolvedValueOnce({ ok: true, data: null });

    await selectProxy("Auto Select", "Direct");
    await testProxyDelay("Direct", 5_000);
    await closeConnection("connection-1");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "select_proxy", {
      group: "Auto Select",
      proxy: "Direct",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "test_proxy_delay", {
      proxy: "Direct",
      timeoutMs: 5_000,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "close_connection", {
      connectionId: "connection-1",
    });
  });

  it("loads and validates connections, rules, and profiles", async () => {
    enableTauriRuntime();
    invokeMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          upload_total_bytes: 2,
          download_total_bytes: 4,
          memory_bytes: 8,
          connections: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            index: 0,
            rule_type: "MATCH",
            payload: "",
            proxy: "CapybaraProxy Direct",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: "capybara-direct",
            name: "CapybaraProxy Direct",
            active: true,
            updated_at_ms: null,
          },
        ],
      });

    await expect(getConnections()).resolves.toMatchObject({
      status: "ok",
      data: { connections: [] },
    });
    await expect(getRules()).resolves.toMatchObject({
      status: "ok",
      data: [{ rule_type: "MATCH" }],
    });
    await expect(getProfiles()).resolves.toMatchObject({
      status: "ok",
      data: [{ active: true }],
    });
  });
});
