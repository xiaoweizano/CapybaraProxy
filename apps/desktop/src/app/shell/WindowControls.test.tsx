import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../../platform/tauri";
import { WindowControls } from "./WindowControls";

vi.mock("../../platform/tauri", () => ({
  closeWindow: vi.fn(),
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
}));

const closeWindowMock = vi.mocked(closeWindow);
const minimizeWindowMock = vi.mocked(minimizeWindow);
const toggleMaximizeWindowMock = vi.mocked(toggleMaximizeWindow);

describe("WindowControls", () => {
  beforeEach(() => {
    closeWindowMock.mockReset();
    minimizeWindowMock.mockReset();
    toggleMaximizeWindowMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles rejected native window actions without unhandled errors", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    closeWindowMock.mockRejectedValue(new Error("close failed"));
    minimizeWindowMock.mockRejectedValue(new Error("minimize failed"));
    toggleMaximizeWindowMock.mockRejectedValue(new Error("maximize failed"));
    render(<WindowControls />);

    await user.click(screen.getByRole("button", { name: "Minimize window" }));
    await user.click(screen.getByRole("button", { name: "Maximize window" }));
    await user.click(screen.getByRole("button", { name: "Close window" }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledTimes(3);
    });
    expect(consoleError).toHaveBeenCalledWith(
      "FlowProxy window action failed",
      expect.any(Error),
    );
  });
});
