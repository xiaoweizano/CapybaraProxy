/**
 * Interface animation preference.
 *
 * The stylesheets already honour `prefers-reduced-motion`; this adds an
 * in-app switch for operators who want the lighter experience without changing
 * an OS-wide setting. The value is persisted with the rest of `settings.json`.
 */
export type MotionPreference = "full" | "reduced";

export const DEFAULT_MOTION: MotionPreference = "full";

export function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "full" || value === "reduced";
}

/** Applies the preference to the document root, where the CSS reads it. */
export function applyMotion(preference: MotionPreference): void {
  document.documentElement.dataset.motion = preference;
}
