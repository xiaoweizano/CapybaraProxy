import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  parseTheme,
  readStoredTheme,
  writeStoredTheme,
} from "./theme";

describe("theme persistence", () => {
  it("uses Cyber Flow when no valid preference exists", () => {
    expect(DEFAULT_THEME).toBe("cyber_flow");
    expect(parseTheme(null)).toBe("cyber_flow");
    expect(parseTheme("unknown")).toBe("cyber_flow");
  });

  it("restores a stored Warm Flow preference", () => {
    const storage = {
      getItem: (key: string) => (key === THEME_STORAGE_KEY ? "warm_flow" : null),
    };

    expect(readStoredTheme(storage)).toBe("warm_flow");
  });

  it("writes only supported theme identifiers", () => {
    const writes: Array<[string, string]> = [];
    const storage = {
      setItem: (key: string, value: string) => writes.push([key, value]),
    };

    writeStoredTheme(storage, "warm_flow");

    expect(writes).toEqual([[THEME_STORAGE_KEY, "warm_flow"]]);
  });
});

