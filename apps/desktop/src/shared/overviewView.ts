/**
 * Which Overview cards are visible.
 *
 * The Overview is a dashboard: some operators only use the hero and the proxy
 * picker, and the node map or the latency card get in the way. This keeps that
 * choice local to the page, next to the other view preferences, rather than in
 * `settings.json` where the native side has no use for it.
 */
export type OverviewCardId = "selection" | "latency" | "nodeMap" | "connections";

export const OVERVIEW_CARDS: readonly OverviewCardId[] = [
  "selection",
  "latency",
  "nodeMap",
  "connections",
];

const STORAGE_KEY = "capybara.overview.hidden";

type Reader = { getItem(key: string): string | null };
type Writer = { setItem(key: string, value: string): void };

export function isOverviewCard(value: unknown): value is OverviewCardId {
  return typeof value === "string" && OVERVIEW_CARDS.includes(value as OverviewCardId);
}

export function readHiddenCards(storage: Reader): Set<OverviewCardId> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter(isOverviewCard) : [],
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenCards(
  storage: Writer,
  hidden: ReadonlySet<OverviewCardId>,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...hidden].sort()));
  } catch {
    // A full quota only loses the preference, never the page.
  }
}

export function toggleCard(
  hidden: ReadonlySet<OverviewCardId>,
  card: OverviewCardId,
): Set<OverviewCardId> {
  const next = new Set(hidden);
  if (next.has(card)) {
    next.delete(card);
  } else {
    next.add(card);
  }
  // The hero and the layout must survive at least one card per row group.
  return next;
}
