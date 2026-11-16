import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTelemetry } from "../../platform/runtime";
import { useTelemetry } from "./telemetryStore";

vi.mock("../../platform/runtime", () => ({
  getTelemetry: vi.fn(),
}));

const getTelemetryMock = vi.mocked(getTelemetry);

function TelemetryProbe({ enabled }: { enabled: boolean }) {
  const telemetry = useTelemetry(enabled);
  return <span data-testid="samples">{telemetry.history.length}</span>;
}

describe("useTelemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    delete document.documentElement.dataset.appVisibility;
    getTelemetryMock.mockReset();
  });

  it("does not start sampling until the caller explicitly enables it", async () => {
    getTelemetryMock.mockResolvedValue({
      status: "ok",
      data: {
        state: "connected",
        timestamp_ms: 1,
        upload_bps: 10,
        download_bps: 20,
        total_upload_bytes: 10,
        total_download_bytes: 20,
        memory_bytes: 100,
        active_connections: 1,
      },
    });
    const view = render(<TelemetryProbe enabled={false} />);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getTelemetryMock).not.toHaveBeenCalled();

    await act(async () => {
      view.rerender(<TelemetryProbe enabled />);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getTelemetryMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("samples")).toHaveTextContent("1");
  });
});
