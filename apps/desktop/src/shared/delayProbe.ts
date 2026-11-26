/**
 * Latency probe settings.
 *
 * The core requests this URL through each node to measure its round-trip time.
 * The default (`gstatic`'s 204 endpoint) is blocked on some networks, so the
 * target is configurable and persisted with the rest of `settings.json`.
 */
export const DEFAULT_DELAY_PROBE_URL = "http://www.gstatic.com/generate_204";
export const DEFAULT_DELAY_TIMEOUT_MS = 5_000;
export const MIN_DELAY_TIMEOUT_MS = 1_000;
export const MAX_DELAY_TIMEOUT_MS = 10_000;

/** Clamps a timeout to the range the core accepts. */
export function normalizeDelayTimeout(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DELAY_TIMEOUT_MS;
  }
  return Math.min(
    MAX_DELAY_TIMEOUT_MS,
    Math.max(MIN_DELAY_TIMEOUT_MS, Math.round(value)),
  );
}

/** True when the value can be sent to the core as a probe target. */
export function isValidProbeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (
    !(trimmed.startsWith("http://") || trimmed.startsWith("https://")) ||
    trimmed.length > 2048
  ) {
    return false;
  }
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
}
