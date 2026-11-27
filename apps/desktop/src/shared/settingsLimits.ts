/**
 * Numeric limits shared with the native settings store.
 *
 * These live outside `platform/settings` because the settings provider and the
 * settings page read them on every render, while test suites replace the
 * bridge module with a mock that only knows the two bridge calls.
 */

/** Mirrors `settings::DEFAULT_LOG_RETENTION_DAYS` in Rust. */
export const DEFAULT_LOG_RETENTION_DAYS = 7;
/** Mirrors `settings::MIN_LOG_RETENTION_DAYS`. */
export const MIN_LOG_RETENTION_DAYS = 1;
/** Mirrors `settings::MAX_LOG_RETENTION_DAYS`. */
export const MAX_LOG_RETENTION_DAYS = 90;
/** Mirrors `settings::MIN_PROXY_PORT`. */
export const MIN_PROXY_PORT = 1024;
export const MAX_PROXY_PORT = 65_535;

/** Selectable retention windows, in days. */
export const LOG_RETENTION_OPTIONS = [1, 3, 7, 14, 30] as const;

/** Clamps a retention window to the range the native side accepts. */
export function normalizeLogRetention(days: number): number {
  if (!Number.isFinite(days)) {
    return DEFAULT_LOG_RETENTION_DAYS;
  }
  return Math.min(
    MAX_LOG_RETENTION_DAYS,
    Math.max(MIN_LOG_RETENTION_DAYS, Math.round(days)),
  );
}

/**
 * Returns a fixed mixed-port the core can bind, or `null` for automatic.
 *
 * Privileged ports are rejected here as well as in the native layer so the UI
 * never claims to have saved a port the core would refuse.
 */
export function normalizeProxyPort(port: number | null): number | null {
  if (port === null || !Number.isFinite(port)) {
    return null;
  }
  const rounded = Math.round(port);
  return rounded >= MIN_PROXY_PORT && rounded <= MAX_PROXY_PORT
    ? rounded
    : null;
}
