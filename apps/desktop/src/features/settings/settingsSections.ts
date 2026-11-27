import type { SettingsMode } from "../../platform/settings";

/**
 * The Settings page groups and the minimum mode that shows each one.
 *
 * Kept in one place so the sticky navigation and the rendered sections cannot
 * disagree: a group that is hidden is also dropped from the anchor list.
 */
export type SettingsSectionId =
  | "appearance"
  | "window"
  | "network"
  | "subscription"
  | "logs"
  | "core"
  | "tray"
  | "advanced"
  | "substore";

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  /** Two-digit index shown next to the heading and in the navigation. */
  index: string;
  /** Translation key of the group title. */
  titleKey: string;
  /** Translation key of the group eyebrow. */
  kickerKey: string;
  /** Smallest mode that still shows this group. */
  minimumMode: SettingsMode;
};

export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  {
    id: "appearance",
    index: "01",
    titleKey: "settings.appearance",
    kickerKey: "settings.appearanceKicker",
    minimumMode: "simple",
  },
  {
    id: "window",
    index: "02",
    titleKey: "settings.window",
    kickerKey: "settings.windowKicker",
    minimumMode: "simple",
  },
  {
    id: "network",
    index: "03",
    titleKey: "settings.integration",
    kickerKey: "settings.network",
    minimumMode: "simple",
  },
  {
    id: "subscription",
    index: "04",
    titleKey: "settings.subscription",
    kickerKey: "settings.subscriptionKicker",
    minimumMode: "standard",
  },
  {
    id: "logs",
    index: "05",
    titleKey: "settings.logs",
    kickerKey: "settings.logsKicker",
    minimumMode: "standard",
  },
  {
    id: "core",
    index: "06",
    titleKey: "settings.core",
    kickerKey: "settings.coreKicker",
    minimumMode: "standard",
  },
  {
    id: "tray",
    index: "07",
    titleKey: "settings.tray",
    kickerKey: "settings.trayKicker",
    minimumMode: "relaxed",
  },
  {
    id: "advanced",
    index: "08",
    titleKey: "settings.advancedCore",
    kickerKey: "settings.advancedCoreKicker",
    minimumMode: "relaxed",
  },
  {
    id: "substore",
    index: "09",
    titleKey: "settings.substore",
    kickerKey: "settings.substoreKicker",
    minimumMode: "relaxed",
  },
];

const MODE_RANK: Record<SettingsMode, number> = {
  simple: 0,
  standard: 1,
  relaxed: 2,
};

/** True when `mode` shows the group that requires `minimumMode`. */
export function isSectionVisible(
  minimumMode: SettingsMode,
  mode: SettingsMode,
): boolean {
  return MODE_RANK[mode] >= MODE_RANK[minimumMode];
}

/** The groups to render, in order, for `mode`. */
export function visibleSections(
  mode: SettingsMode,
): SettingsSectionDefinition[] {
  return SETTINGS_SECTIONS.filter((section) =>
    isSectionVisible(section.minimumMode, mode),
  );
}

/** Looks up one group by id, regardless of the current mode. */
export function settingsSection(
  id: SettingsSectionId,
): SettingsSectionDefinition {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) {
    throw new Error(`Unknown settings section: ${id}`);
  }
  return section;
}

/** The mode list, in increasing density. */
export const SETTINGS_MODES: SettingsMode[] = [
  "simple",
  "standard",
  "relaxed",
];

/** Translation keys for the mode picker. */
export function settingsModeLabelKey(mode: SettingsMode): string {
  const capitalized = mode.charAt(0).toUpperCase() + mode.slice(1);
  return `settings.settingsMode${capitalized}`;
}

export function settingsModeCaptionKey(mode: SettingsMode): string {
  return `${settingsModeLabelKey(mode)}Caption`;
}
