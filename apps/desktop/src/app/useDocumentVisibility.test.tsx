import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToNativeVisibility } from "../platform/tauri";
import { useDocumentVisibility } from "./useDocumentVisibility";

vi.mock("../platform/tauri", () => ({
  subscribeToNativeVisibility: vi.fn(),
}));

const subscribeToNativeVisibilityMock = vi.mocked(
  subscribeToNativeVisibility,
);

function VisibilityProbe() {
  useDocumentVisibility();
  return null;
}

describe("useDocumentVisibility", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    delete document.documentElement.dataset.appVisibility;
    vi.restoreAllMocks();
  });

  it("combines document and native shell visibility and disposes the listener", async () => {
    let nativeListener: ((hidden: boolean) => void) | undefined;
    const dispose = vi.fn();

    subscribeToNativeVisibilityMock.mockImplementation((listener) => {
      nativeListener = listener;
      return Promise.resolve(dispose);
    });

    const view = render(<VisibilityProbe />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.dataset.appVisibility).toBe("visible");

    act(() => {
      nativeListener?.(true);
    });
    expect(document.documentElement.dataset.appVisibility).toBe("hidden");

    act(() => {
      nativeListener?.(false);
    });
    expect(document.documentElement.dataset.appVisibility).toBe("visible");

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      nativeListener?.(false);
    });
    expect(document.documentElement.dataset.appVisibility).toBe("hidden");

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.documentElement.dataset.appVisibility).toBe("visible");

    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.appVisibility).toBeUndefined();
  });
});
