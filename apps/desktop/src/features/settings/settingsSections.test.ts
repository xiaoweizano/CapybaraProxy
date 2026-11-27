import { describe, expect, it } from "vitest";
import {
  isSectionVisible,
  settingsSection,
  visibleSections,
} from "./settingsSections";

describe("settings sections", () => {
  it("shows the essentials in every mode", () => {
    for (const mode of ["simple", "standard", "relaxed"] as const) {
      const ids = visibleSections(mode).map((section) => section.id);
      expect(ids).toContain("appearance");
      expect(ids).toContain("window");
      expect(ids).toContain("network");
    }
  });

  it("adds subscription, logs and core in standard mode", () => {
    const ids = visibleSections("standard").map((section) => section.id);
    expect(ids).toEqual(
      expect.arrayContaining(["subscription", "logs", "core"]),
    );
    expect(ids).not.toContain("tray");
    expect(ids).not.toContain("advanced");
    expect(ids).not.toContain("substore");
  });

  it("shows every group in relaxed mode", () => {
    const ids = visibleSections("relaxed").map((section) => section.id);
    expect(ids).toEqual([
      "appearance",
      "window",
      "network",
      "subscription",
      "logs",
      "core",
      "tray",
      "advanced",
      "substore",
    ]);
  });

  it("keeps the navigation order stable across modes", () => {
    const simple = visibleSections("simple").map((section) => section.id);
    const relaxed = visibleSections("relaxed").map((section) => section.id);
    expect(relaxed.filter((id) => simple.includes(id))).toEqual(simple);
  });

  it("compares modes by density", () => {
    expect(isSectionVisible("simple", "simple")).toBe(true);
    expect(isSectionVisible("standard", "simple")).toBe(false);
    expect(isSectionVisible("standard", "relaxed")).toBe(true);
    expect(isSectionVisible("relaxed", "standard")).toBe(false);
  });

  it("can look up a group that the current mode hides", () => {
    expect(settingsSection("substore").index).toBe("09");
    expect(settingsSection("appearance").index).toBe("01");
  });
});
