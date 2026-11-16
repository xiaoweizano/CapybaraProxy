import { describe, expect, it } from "vitest";
import {
  CLOSE_BEHAVIOR_STORAGE_KEY,
  parseCloseBehavior,
  readStoredCloseBehavior,
  writeStoredCloseBehavior,
} from "../../shared/closeBehavior";

describe("close behavior preference", () => {
  it("defaults to hiding the window", () => {
    expect(parseCloseBehavior(null)).toBe("hide_to_tray");
    expect(parseCloseBehavior("invalid")).toBe("hide_to_tray");
  });

  it("restores and persists exit behavior", () => {
    const storage = {
      getItem: (key: string) =>
        key === CLOSE_BEHAVIOR_STORAGE_KEY ? "exit_application" : null,
      setItem: () => undefined,
    };

    expect(readStoredCloseBehavior(storage)).toBe("exit_application");

    const writes: Array<[string, string]> = [];
    writeStoredCloseBehavior(
      {
        setItem: (key, value) => writes.push([key, value]),
      },
      "exit_application",
    );

    expect(writes).toEqual([
      [CLOSE_BEHAVIOR_STORAGE_KEY, "exit_application"],
    ]);
  });
});
