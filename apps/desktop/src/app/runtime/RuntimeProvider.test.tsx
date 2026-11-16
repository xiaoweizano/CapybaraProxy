import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCoreInfo,
  getProxyGroups,
  getRuntimeLogs,
  getRuntimeSnapshot,
  restartRuntime,
  selectProxy,
  startRuntime,
  stopRuntime,
  subscribeRuntimeLog,
  subscribeRuntimeState,
  testProxyDelay,
  type RuntimeLogEntry,
  type RuntimeSnapshot,
} from "../../platform/runtime";
import { RuntimeProvider } from "./RuntimeProvider";
import { useRuntime } from "./runtimeContext";

vi.mock("../../platform/runtime", () => ({
  getCoreInfo: vi.fn(),
  getProxyGroups: vi.fn(),
  getRuntimeLogs: vi.fn(),
  getRuntimeSnapshot: vi.fn(),
  restartRuntime: vi.fn(),
  selectProxy: vi.fn(),
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
  subscribeRuntimeLog: vi.fn(),
  subscribeRuntimeState: vi.fn(),
  testProxyDelay: vi.fn(),
}));

const getCoreInfoMock = vi.mocked(getCoreInfo);
const getProxyGroupsMock = vi.mocked(getProxyGroups);
const getRuntimeLogsMock = vi.mocked(getRuntimeLogs);
const getRuntimeSnapshotMock = vi.mocked(getRuntimeSnapshot);
const restartRuntimeMock = vi.mocked(restartRuntime);
const selectProxyMock = vi.mocked(selectProxy);
const startRuntimeMock = vi.mocked(startRuntime);
const stopRuntimeMock = vi.mocked(stopRuntime);
const subscribeRuntimeLogMock = vi.mocked(subscribeRuntimeLog);
const subscribeRuntimeStateMock = vi.mocked(subscribeRuntimeState);
const testProxyDelayMock = vi.mocked(testProxyDelay);

const stoppedSnapshot: RuntimeSnapshot = {
  backend: "mihomo",
  state: "stopped",
  sequence: 0,
  started_at_ms: null,
  last_error: null,
  log_count: 0,
};

const connectedSnapshot: RuntimeSnapshot = {
  backend: "mihomo",
  state: "connected",
  sequence: 2,
  started_at_ms: 1_760_000_000_000,
  last_error: null,
  log_count: 1,
};

const logEntry: RuntimeLogEntry = {
  sequence: 1,
  timestamp_ms: 1_760_000_000_000,
  level: "info",
  message: "Mihomo core is ready.",
  error_code: null,
};

function RuntimeProbe() {
  const runtime = useRuntime();
  const [delayProbe, setDelayProbe] = useState<number | null>(null);

  return (
    <div>
      <span data-testid="state">{runtime.snapshot?.state ?? "none"}</span>
      <span data-testid="version">{runtime.coreInfo?.version ?? "none"}</span>
      <span data-testid="groups">{runtime.proxyGroups.length}</span>
      <span data-testid="logs">{runtime.logs.length}</span>
      <span data-testid="notice">{runtime.notice ?? "none"}</span>
      <span data-testid="error">{runtime.lastError?.message ?? "none"}</span>
      <span data-testid="delay">{delayProbe ?? "none"}</span>
      <button type="button" onClick={() => void runtime.start()}>
        Start probe
      </button>
      <button type="button" onClick={() => void runtime.stop()}>
        Stop probe
      </button>
      <button type="button" onClick={() => void runtime.restart()}>
        Restart probe
      </button>
      <button
        type="button"
        onClick={() => void runtime.selectProxy("Auto", "DIRECT")}
      >
        Select probe
      </button>
      <button
        type="button"
        onClick={async () => {
          setDelayProbe(await runtime.measureDelay("DIRECT", 4_000));
        }}
      >
        Delay probe
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <RuntimeProvider>
      <RuntimeProbe />
    </RuntimeProvider>,
  );
}

describe("RuntimeProvider", () => {
  beforeEach(() => {
    getCoreInfoMock.mockReset().mockResolvedValue({
      status: "ok",
      data: { backend: "mihomo", version: "v1.19.33", pid: 42 },
    });
    getProxyGroupsMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [
        {
          name: "FlowProxy Direct",
          group_type: "Selector",
          selected: "DIRECT",
          nodes: [
            {
              name: "DIRECT",
              proxy_type: "Direct",
              udp: true,
              delay_ms: null,
              alive: true,
            },
          ],
        },
      ],
    });
    getRuntimeLogsMock.mockReset().mockResolvedValue({
      status: "ok",
      data: [logEntry],
    });
    getRuntimeSnapshotMock.mockReset().mockResolvedValue({
      status: "ok",
      data: stoppedSnapshot,
    });
    restartRuntimeMock.mockReset();
    selectProxyMock.mockReset();
    startRuntimeMock.mockReset();
    stopRuntimeMock.mockReset();
    subscribeRuntimeLogMock.mockReset().mockResolvedValue(() => undefined);
    subscribeRuntimeStateMock.mockReset().mockResolvedValue(() => undefined);
    testProxyDelayMock.mockReset();
  });

  it("loads the initial snapshot and bounded Runtime logs", async () => {
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("stopped");
    });
    expect(screen.getByTestId("logs")).toHaveTextContent("1");
    expect(getRuntimeSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getRuntimeLogsMock).toHaveBeenCalledTimes(1);
    expect(subscribeRuntimeStateMock).toHaveBeenCalledTimes(1);
    expect(subscribeRuntimeLogMock).toHaveBeenCalledTimes(1);
    expect(getProxyGroupsMock).not.toHaveBeenCalled();
  });

  it("loads core and proxy data when the Runtime becomes connected", async () => {
    let stateListener: ((snapshot: RuntimeSnapshot) => void) | undefined;
    subscribeRuntimeStateMock.mockImplementationOnce(async (listener) => {
      stateListener = listener;
      return () => undefined;
    });
    renderProvider();
    await screen.findByText("stopped");

    act(() => {
      stateListener?.(connectedSnapshot);
    });

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("connected");
      expect(screen.getByTestId("version")).toHaveTextContent("v1.19.33");
      expect(screen.getByTestId("groups")).toHaveTextContent("1");
    });
  });

  it("updates the snapshot after a successful lifecycle command", async () => {
    const user = userEvent.setup();
    startRuntimeMock.mockResolvedValueOnce({
      status: "ok",
      data: connectedSnapshot,
    });
    renderProvider();
    await screen.findByText("stopped");

    await user.click(screen.getByRole("button", { name: "Start probe" }));

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("connected");
    });
    expect(startRuntimeMock).toHaveBeenCalledTimes(1);
    expect(getProxyGroupsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the last valid state and exposes a structured command error", async () => {
    const user = userEvent.setup();
    stopRuntimeMock.mockResolvedValueOnce({
      status: "error",
      error: {
        code: "not_running",
        message: "The Mihomo core is not running.",
        retryable: false,
      },
    });
    renderProvider();
    await screen.findByText("stopped");

    await user.click(screen.getByRole("button", { name: "Stop probe" }));

    expect(await screen.findByText("The Mihomo core is not running.")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("stopped");
  });

  it("refreshes proxy groups after a successful proxy selection", async () => {
    const user = userEvent.setup();
    selectProxyMock.mockResolvedValueOnce({ status: "ok", data: null });
    getProxyGroupsMock
      .mockResolvedValueOnce({
        status: "ok",
        data: [
          {
            name: "Auto",
            group_type: "Selector",
            selected: "DIRECT",
            nodes: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "ok",
        data: [
          {
            name: "Auto",
            group_type: "Selector",
            selected: "Proxy A",
            nodes: [],
          },
        ],
      });
    renderProvider();
    await screen.findByText("stopped");

    await user.click(screen.getByRole("button", { name: "Select probe" }));

    await waitFor(() => {
      expect(screen.getByTestId("groups")).toHaveTextContent("1");
    });
    expect(selectProxyMock).toHaveBeenCalledWith("Auto", "DIRECT");
    expect(getProxyGroupsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the last valid proxy groups when selection fails", async () => {
    const user = userEvent.setup();
    selectProxyMock.mockResolvedValueOnce({
      status: "error",
      error: {
        code: "selection_failed",
        message: "The selected proxy was rejected.",
        retryable: true,
      },
    });
    renderProvider();
    await screen.findByText("stopped");

    await user.click(screen.getByRole("button", { name: "Select probe" }));

    expect(await screen.findByText("The selected proxy was rejected.")).toBeInTheDocument();
    expect(screen.getByTestId("groups")).toHaveTextContent("0");
    expect(getProxyGroupsMock).not.toHaveBeenCalled();
  });

  it("returns a real proxy delay and exposes delay failures", async () => {
    const user = userEvent.setup();
    testProxyDelayMock
      .mockResolvedValueOnce({ status: "ok", data: 87 })
      .mockResolvedValueOnce({
        status: "error",
        error: {
          code: "api_unavailable",
          message: "The delay test timed out.",
          retryable: true,
        },
      });
    renderProvider();
    await screen.findByText("stopped");

    await user.click(screen.getByRole("button", { name: "Delay probe" }));
    await waitFor(() => {
      expect(screen.getByTestId("delay")).toHaveTextContent("87");
    });
    expect(testProxyDelayMock).toHaveBeenNthCalledWith(1, "DIRECT", 4_000);

    await user.click(screen.getByRole("button", { name: "Delay probe" }));
    expect(await screen.findByText("The delay test timed out.")).toBeInTheDocument();
    expect(screen.getByTestId("delay")).toHaveTextContent("none");
  });

  it("removes state and log listeners when unmounted", async () => {
    const stopStateListener = vi.fn();
    const stopLogListener = vi.fn();
    subscribeRuntimeStateMock.mockResolvedValueOnce(stopStateListener);
    subscribeRuntimeLogMock.mockResolvedValueOnce(stopLogListener);
    const view = renderProvider();

    await waitFor(() => {
      expect(subscribeRuntimeStateMock).toHaveBeenCalledTimes(1);
      expect(subscribeRuntimeLogMock).toHaveBeenCalledTimes(1);
    });
    view.unmount();

    await waitFor(() => {
      expect(stopStateListener).toHaveBeenCalledTimes(1);
      expect(stopLogListener).toHaveBeenCalledTimes(1);
    });
  });

  it("does not leak listeners replayed by StrictMode effects", async () => {
    const stopStateListeners = [vi.fn(), vi.fn()];
    const stopLogListeners = [vi.fn(), vi.fn()];
    const resolveStateSubscriptions: Array<
      (cleanup: () => void) => void
    > = [];
    const resolveLogSubscriptions: Array<(cleanup: () => void) => void> = [];

    subscribeRuntimeStateMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveStateSubscriptions.push(resolve);
        }),
    );
    subscribeRuntimeLogMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveLogSubscriptions.push(resolve);
        }),
    );

    const view = render(
      <StrictMode>
        <RuntimeProvider>
          <RuntimeProbe />
        </RuntimeProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(resolveStateSubscriptions).toHaveLength(2);
      expect(resolveLogSubscriptions).toHaveLength(2);
    });

    await act(async () => {
      resolveStateSubscriptions.forEach((resolve, index) => {
        const cleanup = stopStateListeners[index];
        if (cleanup) {
          resolve(cleanup);
        }
      });
      resolveLogSubscriptions.forEach((resolve, index) => {
        const cleanup = stopLogListeners[index];
        if (cleanup) {
          resolve(cleanup);
        }
      });
      await Promise.resolve();
    });
    view.unmount();

    stopStateListeners.forEach((cleanup) => {
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
    stopLogListeners.forEach((cleanup) => {
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  it("reports browser preview as unavailable without fabricating state", async () => {
    getRuntimeSnapshotMock.mockResolvedValueOnce({ status: "unavailable" });
    getRuntimeLogsMock.mockResolvedValueOnce({ status: "unavailable" });
    getProxyGroupsMock.mockResolvedValueOnce({ status: "unavailable" });
    getCoreInfoMock.mockResolvedValueOnce({ status: "unavailable" });
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("notice")).toHaveTextContent(
        "Desktop Runtime is unavailable",
      );
    });
    expect(screen.getByTestId("state")).toHaveTextContent("none");
    expect(screen.getByTestId("groups")).toHaveTextContent("0");
  });
});
