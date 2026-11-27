/**
 * Interface scale.
 *
 * Every font size in the stylesheets is expressed in `rem`, so one root font
 * size scales the whole interface. The value is an integer percent stored in
 * `settings.json`; the cache keys below mirror the theme and language stores so
 * the preview build (no native bridge) behaves the same way.
 */
export const DEFAULT_UI_SCALE = 100;
export const MIN_UI_SCALE = 85;
export const MAX_UI_SCALE = 140;
/** Selectable values, in percent. */
export const UI_SCALE_STEPS = [85, 92, 100, 110, 120, 130, 140] as const;

export const UI_SCALE_STORAGE_KEY = "capybara.uiScale";

/**
 * 16px at 100%, which keeps the familiar browser default as the baseline for
 * the rem sizes in the stylesheets.
 */
const ROOT_FONT_SIZE_PX = 16;

type UiScaleReader = {
  getItem(key: string): string | null;
};

type UiScaleWriter = {
  setItem(key: string, value: string): void;
};

/** Clamps any input to the supported range, ignoring junk values. */
export function normalizeUiScale(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_UI_SCALE;
  }
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Math.round(parsed)));
}

export function readStoredUiScale(storage: UiScaleReader): number {
  return normalizeUiScale(storage.getItem(UI_SCALE_STORAGE_KEY));
}

export function writeStoredUiScale(
  storage: UiScaleWriter,
  value: number,
): void {
  storage.setItem(UI_SCALE_STORAGE_KEY, String(normalizeUiScale(value)));
}

/** Applies the scale to the document root. */
export function applyUiScale(value: number): void {
  const scale = normalizeUiScale(value);
  document.documentElement.style.setProperty(
    "--ui-root-font-size",
    `${(ROOT_FONT_SIZE_PX * scale) / 100}px`,
  );
  document.documentElement.dataset.uiScale = String(scale);
}
