import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, saveSettings } from "./settings";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const settings = {
  version: 1,
  theme: "cyber_flow",
  close_behavior: "hide_to_tray",
} as const;

function enableTauriRuntime() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

describe("settings bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("reports unavailable in browser preview", async () => {
    const result = await getSettings();

    expect(result).toEqual({ status: "unavailable" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads validated Rust settings through the fixed command", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({ ok: true, data: settings });

    await expect(getSettings()).resolves.toEqual({
      status: "ok",
      data: settings,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_settings", undefined);
  });

  it("saves the complete settings object through the fixed command", async () => {
    enableTauriRuntime();
    const updated = {
      ...settings,
      theme: "warm_flow",
      close_behavior: "exit_application",
    } as const;
    invokeMock.mockResolvedValueOnce({ ok: true, data: updated });

    await expect(saveSettings(updated)).resolves.toEqual({
      status: "ok",
      data: updated,
    });
    expect(invokeMock).toHaveBeenCalledWith("save_settings", {
      settings: updated,
    });
  });

  it("turns malformed settings into a structured bridge error", async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: { ...settings, theme: "neon_unknown" },
    });

    const result = await getSettings();

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("internal");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("hides transport details when Tauri invocation fails", async () => {
    enableTauriRuntime();
    invokeMock.mockRejectedValueOnce(
      new Error("C:\\secret\\path could not be read"),
    );

    const result = await getSettings();

    expect(result).toEqual({
      status: "error",
      error: {
        code: "internal",
        message: "CapybaraProxy could not contact the desktop Runtime.",
        retryable: true,
      },
    });
  });
});
