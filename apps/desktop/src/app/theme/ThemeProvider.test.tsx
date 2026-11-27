import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "../../platform/settings";
import { SettingsProvider } from "../settings/SettingsProvider";
import { useAppSettings } from "../settings/settingsContext";
import { ThemeProvider } from "./ThemeProvider";
import { useTheme } from "./themeContext";

vi.mock("../../platform/settings", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

const getSettingsMock = vi.mocked(getSettings);

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  const { mode } = useAppSettings();

  return (
    <div>
      <span>{mode}</span>
      <span>{theme}</span>
      <button type="button" onClick={() => setTheme("warm_flow")}>
        Use Warm Flow
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ status: "unavailable" });
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("applies Cyber Flow by default and persists a theme change", async () => {
    const user = userEvent.setup();

    render(
      <SettingsProvider>
        <ThemeProvider>
          <ThemeProbe />
        </ThemeProvider>
      </SettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("preview")).toBeInTheDocument();
    });
    expect(screen.getByText("cyber_flow")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("cyber_flow");

    await user.click(screen.getByRole("button", { name: "Use Warm Flow" }));

    await waitFor(() => {
      expect(screen.getByText("warm_flow")).toBeInTheDocument();
    });
    expect(document.documentElement.dataset.theme).toBe("warm_flow");
    expect(localStorage.getItem("capybara.theme")).toBe("warm_flow");
  });
});

