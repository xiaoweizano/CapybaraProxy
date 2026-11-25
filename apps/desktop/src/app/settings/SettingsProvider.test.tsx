import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, saveSettings } from "../../platform/settings";
import {
  CLOSE_BEHAVIOR_STORAGE_KEY,
  readStoredCloseBehavior,
} from "../../shared/closeBehavior";
import { THEME_STORAGE_KEY, readStoredTheme } from "../theme/theme";
import { SettingsProvider } from "./SettingsProvider";
import {
  SETTINGS_MIGRATION_KEY,
  useAppSettings,
} from "./settingsContext";

vi.mock("../../platform/settings", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

const getSettingsMock = vi.mocked(getSettings);
const saveSettingsMock = vi.mocked(saveSettings);

function SettingsProbe() {
  const {
    mode,
    isSaving,
    error,
    settings,
    updateTheme,
    updateCloseBehavior,
  } = useAppSettings();

  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="theme">{settings.theme}</span>
      <span data-testid="close-behavior">{settings.closeBehavior}</span>
      <span data-testid="saving">{String(isSaving)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <button type="button" onClick={() => void updateTheme("warm_flow")}>
        Use Warm Flow
      </button>
      <button
        type="button"
        onClick={() => void updateCloseBehavior("exit_application")}
      >
        Exit on close
      </button>
    </div>
  );
}

function renderSettingsProvider() {
  return render(
    <SettingsProvider>
      <SettingsProbe />
    </SettingsProvider>,
  );
}

describe("SettingsProvider", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    saveSettingsMock.mockReset();
    window.localStorage.clear();
  });

  it("keeps browser preview preferences in localStorage", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValue({ status: "unavailable" });
    renderSettingsProvider();

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("preview");
    });
    await user.click(screen.getByRole("button", { name: "Use Warm Flow" }));
    await user.click(screen.getByRole("button", { name: "Exit on close" }));

    expect(screen.getByTestId("theme")).toHaveTextContent("warm_flow");
    expect(screen.getByTestId("close-behavior")).toHaveTextContent(
      "exit_application",
    );
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("warm_flow");
    expect(localStorage.getItem(CLOSE_BEHAVIOR_STORAGE_KEY)).toBe(
      "exit_application",
    );
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it("uses Rust settings as the native source of truth", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "warm_flow");
    localStorage.setItem(
      CLOSE_BEHAVIOR_STORAGE_KEY,
      "exit_application",
    );
    localStorage.setItem(SETTINGS_MIGRATION_KEY, "1");
    getSettingsMock.mockResolvedValue({
      status: "ok",
      data: {
        version: 1,
        theme: "cyber_flow",
        close_behavior: "hide_to_tray",
      },
    });
    renderSettingsProvider();

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("native");
      expect(screen.getByTestId("theme")).toHaveTextContent("cyber_flow");
    });
    expect(screen.getByTestId("close-behavior")).toHaveTextContent(
      "hide_to_tray",
    );
    expect(readStoredTheme(localStorage)).toBe("cyber_flow");
    expect(readStoredCloseBehavior(localStorage)).toBe("hide_to_tray");
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it("migrates legacy local preferences once before native settings win", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "warm_flow");
    localStorage.setItem(
      CLOSE_BEHAVIOR_STORAGE_KEY,
      "exit_application",
    );
    getSettingsMock.mockResolvedValue({
      status: "ok",
      data: {
        version: 1,
        theme: "cyber_flow",
        close_behavior: "hide_to_tray",
      },
    });
    saveSettingsMock.mockImplementation(async (settings) => ({
      status: "ok",
      data: settings,
    }));
    renderSettingsProvider();

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("warm_flow");
    });
    expect(saveSettingsMock).toHaveBeenCalledWith({
      version: 1,
      theme: "warm_flow",
      close_behavior: "exit_application",
      language: "english",
    });
    expect(localStorage.getItem(SETTINGS_MIGRATION_KEY)).toBe("1");
  });

  it("does not update native UI state or cache when saving fails", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValue({
      status: "ok",
      data: {
        version: 1,
        theme: "cyber_flow",
        close_behavior: "hide_to_tray",
      },
    });
    saveSettingsMock.mockResolvedValue({
      status: "error",
      error: {
        code: "settings_io",
        message: "Settings could not be written.",
        retryable: true,
      },
    });
    renderSettingsProvider();
    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("native");
    });

    await user.click(screen.getByRole("button", { name: "Use Warm Flow" }));

    expect(await screen.findByTestId("error")).toHaveTextContent(
      "Settings could not be written.",
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("cyber_flow");
    expect(readStoredTheme(localStorage)).toBe("cyber_flow");
  });

  it("does not update native UI state when saving rejects unexpectedly", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValue({
      status: "ok",
      data: {
        version: 1,
        theme: "cyber_flow",
        close_behavior: "hide_to_tray",
      },
    });
    saveSettingsMock.mockRejectedValueOnce(
      new Error("unexpected native bridge failure"),
    );
    renderSettingsProvider();
    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("native");
    });

    await user.click(screen.getByRole("button", { name: "Use Warm Flow" }));

    expect(await screen.findByTestId("error")).toHaveTextContent(
      "FlowProxy could not save desktop settings.",
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("cyber_flow");
    expect(readStoredTheme(localStorage)).toBe("cyber_flow");
  });
});
