import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeContext,
  type RuntimeContextValue,
} from "../../app/runtime/runtimeContext";
import { ThemeContext } from "../../app/theme/themeContext";
import type {
  ProxyGroup,
  RuntimeSnapshot,
  TelemetrySnapshot,
} from "../../platform/runtime";
import { OverviewPage } from "./OverviewPage";
import { TrafficChart } from "./TrafficChart";

vi.mock("../../app/runtime/telemetryStore", () => ({
  useTelemetry: vi.fn(),
}));

const { useTelemetry } = await import("../../app/runtime/telemetryStore");
const useTelemetryMock = vi.mocked(useTelemetry);

const connectedSnapshot: RuntimeSnapshot = {
  backend: "mihomo",
  state: "connected",
  sequence: 4,
  started_at_ms: Date.now() - 65_000,
  last_error: null,
  log_count: 2,
};

const proxyGroups: ProxyGroup[] = [
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
      {
        name: "Osaka 01",
        proxy_type: "VLESS",
        udp: true,
        delay_ms: null,
        alive: true,
      },
    ],
  },
  {
    name: "Media",
    group_type: "Selector",
    selected: "Singapore 01",
    nodes: [
      {
        name: "Singapore 01",
        proxy_type: "Trojan",
        udp: true,
        delay_ms: 118,
        alive: true,
      },
    ],
  },
];

const telemetry: TelemetrySnapshot = {
  state: "connected",
  timestamp_ms: 1_760_000_000_000,
  upload_bps: 1_572_864,
  download_bps: 3_145_728,
  total_upload_bytes: 52_428_800,
  total_download_bytes: 104_857_600,
  memory_bytes: 24_000_000,
  active_connections: 3,
};

function runtimeValue(
  overrides: Partial<RuntimeContextValue> = {},
): RuntimeContextValue {
  return {
    snapshot: connectedSnapshot,
    coreInfo: { backend: "mihomo", version: "v1.19.33", pid: 42 },
    proxyGroups,
    logs: [],
    isLoading: false,
    pendingAction: null,
    notice: null,
    lastError: null,
    refresh: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    selectProxy: vi.fn(async () => undefined),
    measureDelay: vi.fn(async () => 88),
    ...overrides,
  };
}

function renderOverview(
  theme: "cyber_flow" | "warm_flow",
  runtime: RuntimeContextValue,
) {
  return render(
    <ThemeContext.Provider
      value={{ theme, setTheme: vi.fn(), toggleTheme: vi.fn() }}
    >
      <RuntimeContext.Provider value={runtime}>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </RuntimeContext.Provider>
    </ThemeContext.Provider>,
  );
}

describe("OverviewPage real runtime contract", () => {
  beforeEach(() => {
    useTelemetryMock.mockReturnValue({
      latest: telemetry,
      history: [
        {
          timestampMs: telemetry.timestamp_ms - 1_000,
          uploadBps: 1_048_576,
          downloadBps: 2_097_152,
          activeConnections: 2,
        },
        {
          timestampMs: telemetry.timestamp_ms,
          uploadBps: telemetry.upload_bps,
          downloadBps: telemetry.download_bps,
          activeConnections: telemetry.active_connections,
        },
      ],
      lastError: null,
      isSampling: false,
    });
  });

  it("renders Mihomo state, telemetry, groups, connections, and authoritative availability", async () => {
    renderOverview("cyber_flow", runtimeValue());

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Live traffic")).toBeInTheDocument();
    expect(screen.getByText("1.50 MB/s")).toBeInTheDocument();
    expect(screen.getByText("3.00 MB/s")).toBeInTheDocument();
    expect(screen.getByText("150.0 MB")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Group" })).toHaveValue(
      "Proxy",
    );
    expect(
      screen.getByRole("combobox", { name: "Current node" }),
    ).toHaveValue("Tokyo 01");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Location data unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Active connection history" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/mock/i)).not.toBeInTheDocument();
  });

  it("selects a node and measures its real delay through the Runtime", async () => {
    const user = userEvent.setup();
    const runtime = runtimeValue();
    renderOverview("cyber_flow", runtime);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Group" }),
      "Media",
    );
    expect(
      screen.getByRole("combobox", { name: "Current node" }),
    ).toHaveValue("Singapore 01");

    await user.click(
      screen.getByRole("button", { name: "Measure current node delay" }),
    );

    await waitFor(() => {
      expect(runtime.measureDelay).toHaveBeenCalledWith("Singapore 01");
      expect(
        screen.getByRole("img", { name: "Latency 88 milliseconds" }),
      ).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Current node" }),
      "Singapore 01",
    );
    expect(runtime.selectProxy).toHaveBeenCalledWith("Media", "Singapore 01");
  });

  it("re-enables delay measurement after StrictMode replays its effects", async () => {
    const user = userEvent.setup();
    let resolveDelay: (delay: number) => void = () => undefined;
    const pendingDelay = new Promise<number>((resolve) => {
      resolveDelay = resolve;
    });
    const runtime = runtimeValue({
      measureDelay: vi.fn(() => pendingDelay),
    });

    render(
      <StrictMode>
        <ThemeContext.Provider
          value={{
            theme: "cyber_flow",
            setTheme: vi.fn(),
            toggleTheme: vi.fn(),
          }}
        >
          <RuntimeContext.Provider value={runtime}>
            <MemoryRouter>
              <OverviewPage />
            </MemoryRouter>
          </RuntimeContext.Provider>
        </ThemeContext.Provider>
      </StrictMode>,
    );

    const measureButton = screen.getByRole("button", {
      name: "Measure current node delay",
    });
    await user.click(measureButton);
    expect(measureButton).toBeDisabled();

    await act(async () => {
      resolveDelay(88);
      await pendingDelay;
    });

    await waitFor(() => {
      expect(measureButton).toBeEnabled();
    });
    expect(
      screen.getByRole("img", { name: "Latency 88 milliseconds" }),
    ).toBeInTheDocument();
  });

  it("keeps the Network Orb in Cyber Flow and the mascot in Warm Flow", () => {
    const cyber = renderOverview("cyber_flow", runtimeValue());
    expect(
      screen.getByRole("img", { name: "Network Orb" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "FlowProxy mascot" }),
    ).not.toBeInTheDocument();
    cyber.unmount();

    renderOverview("warm_flow", runtimeValue());
    expect(
      screen.getByRole("img", { name: "FlowProxy mascot" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Network Orb" }),
    ).not.toBeInTheDocument();
  });

  it("does not request or invent telemetry while Mihomo is disconnected", () => {
    renderOverview(
      "cyber_flow",
      runtimeValue({
        snapshot: { ...connectedSnapshot, state: "stopped" },
        coreInfo: null,
        proxyGroups: [],
      }),
    );

    expect(useTelemetryMock).toHaveBeenCalledWith(false);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting for live telemetry")).toHaveLength(2);
    expect(screen.getByText("Location data unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/mock/i)).not.toBeInTheDocument();
  });
});

describe("TrafficChart pure rendering", () => {
  it("redraws only from supplied real series", () => {
    const view = render(
      <TrafficChart
        downloadSeries={[100, 240, 180]}
        uploadSeries={[40, 60, 30]}
        label="Live transfer history"
      />,
    );

    const chart = screen.getByRole("img", { name: "Live transfer history" });
    expect(chart).toHaveAttribute("data-latest-download-sample", "180");
    expect(chart).toHaveAttribute("data-latest-upload-sample", "30");
    expect(chart.querySelectorAll("path")).toHaveLength(3);

    view.rerender(
      <TrafficChart
        downloadSeries={[]}
        uploadSeries={[]}
        label="Live transfer history"
      />,
    );

    expect(chart).toHaveAttribute("data-latest-download-sample", "");
    expect(chart).toHaveAttribute("data-latest-upload-sample", "");
    expect(chart.querySelectorAll("path")).toHaveLength(0);
  });
});
