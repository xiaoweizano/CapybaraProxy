import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimeBridgeResult,
  TelemetrySnapshot,
} from "../../platform/runtime";
import {
  createTelemetryStore,
  type TelemetryState,
} from "./telemetryStore";
import { setAppVisibility } from "../../shared/appVisibility";

function telemetry(timestampMs: number, uploadBps: number): TelemetrySnapshot {
  return {
    state: "connected",
    timestamp_ms: timestampMs,
    upload_bps: uploadBps,
    download_bps: uploadBps * 2,
    total_upload_bytes: timestampMs,
    total_download_bytes: timestampMs * 2,
    memory_bytes: 8_000_000,
    active_connections: 1,
  };
}

async function flushSampling(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

describe("telemetryStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    delete document.documentElement.dataset.appVisibility;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset.appVisibility;
  });

  it("samples once initially and then once per interval", async () => {
    let sequence = 0;
    const fetchTelemetry = vi.fn(
      async (): Promise<RuntimeBridgeResult<TelemetrySnapshot>> => ({
        status: "ok",
        data: telemetry(++sequence, sequence),
      }),
    );
    const store = createTelemetryStore(fetchTelemetry, 1_000, 28);
    const unsubscribe = store.subscribe(() => undefined);

    await flushSampling();
    expect(fetchTelemetry).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(fetchTelemetry).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().history).toHaveLength(3);

    unsubscribe();
  });

  it("does not overlap requests when a sample is still pending", async () => {
    let resolveSample:
      | ((result: RuntimeBridgeResult<TelemetrySnapshot>) => void)
      | undefined;
    const fetchTelemetry = vi.fn(
      () =>
        new Promise<RuntimeBridgeResult<TelemetrySnapshot>>((resolve) => {
          resolveSample = resolve;
        }),
    );
    const store = createTelemetryStore(fetchTelemetry, 1_000, 28);
    const unsubscribe = store.subscribe(() => undefined);

    await flushSampling();
    expect(fetchTelemetry).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchTelemetry).toHaveBeenCalledTimes(1);

    resolveSample?.({ status: "ok", data: telemetry(1, 12) });
    await flushSampling();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchTelemetry).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("stops sampling while hidden and resumes when visible", async () => {
    const fetchTelemetry = vi.fn(
      async (): Promise<RuntimeBridgeResult<TelemetrySnapshot>> => ({
        status: "ok",
        data: telemetry(Date.now(), 100),
      }),
    );
    const store = createTelemetryStore(fetchTelemetry, 1_000, 28);
    const unsubscribe = store.subscribe(() => undefined);

    await flushSampling();
    expect(fetchTelemetry).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchTelemetry).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await flushSampling();

    expect(fetchTelemetry).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("stops immediately when the native shell hides the window", async () => {
    const fetchTelemetry = vi.fn(
      async (): Promise<RuntimeBridgeResult<TelemetrySnapshot>> => ({
        status: "ok",
        data: telemetry(Date.now(), 100),
      }),
    );
    const store = createTelemetryStore(fetchTelemetry, 1_000, 28);
    const unsubscribe = store.subscribe(() => undefined);

    await flushSampling();
    expect(fetchTelemetry).toHaveBeenCalledTimes(1);

    setAppVisibility(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchTelemetry).toHaveBeenCalledTimes(1);

    setAppVisibility(false);
    await flushSampling();
    expect(fetchTelemetry).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("keeps a fixed-size history and never synthesizes samples", async () => {
    const fetchTelemetry = vi
      .fn<() => Promise<RuntimeBridgeResult<TelemetrySnapshot>>>()
      .mockResolvedValueOnce({ status: "unavailable" });
    const store = createTelemetryStore(fetchTelemetry, 1_000, 3);
    const states: TelemetryState[] = [];
    const unsubscribe = store.subscribe((state) => states.push(state));

    await flushSampling();
    expect(store.getSnapshot().history).toEqual([]);

    for (let index = 0; index < 5; index += 1) {
      fetchTelemetry.mockResolvedValueOnce({
        status: "ok",
        data: telemetry(index + 1, index + 1),
      });
      await store.sampleNow();
    }

    expect(store.getSnapshot().history).toEqual([
      {
        timestampMs: 3,
        uploadBps: 3,
        downloadBps: 6,
        activeConnections: 1,
      },
      {
        timestampMs: 4,
        uploadBps: 4,
        downloadBps: 8,
        activeConnections: 1,
      },
      {
        timestampMs: 5,
        uploadBps: 5,
        downloadBps: 10,
        activeConnections: 1,
      },
    ]);
    expect(states.length).toBeGreaterThan(1);
    unsubscribe();
  });

  it("removes visibility listeners after the final subscriber leaves", async () => {
    const fetchTelemetry = vi.fn(
      async (): Promise<RuntimeBridgeResult<TelemetrySnapshot>> => ({
        status: "ok",
        data: telemetry(1, 1),
      }),
    );
    const removeListener = vi.spyOn(document, "removeEventListener");
    const store = createTelemetryStore(fetchTelemetry, 1_000, 28);
    const unsubscribe = store.subscribe(() => undefined);

    await flushSampling();
    unsubscribe();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchTelemetry).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    removeListener.mockRestore();
  });
});
