import type { DelayHistoryEntry } from "../../platform/runtime";


/**
 * A node's own latency over time, drawn from the recorded measurements.
 *
 * The table below the chart answers "what did I just measure"; the chart
 * answers "is this node stable", which a list of samples cannot show. Only the
 * selected node is charted: overlaying every node would turn a 40-node profile
 * into an unreadable tangle.
 */

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 120;
const PADDING = { top: 10, right: 10, bottom: 18, left: 34 };

export type NodeHistoryPoint = {
  timestamp: number;
  delay: number;
};

/** The last `limit` samples for one node, oldest first. */
export function nodeHistory(
  entries: readonly DelayHistoryEntry[],
  proxy: string,
  limit = 60,
): NodeHistoryPoint[] {
  return entries
    .filter((entry) => entry.proxy === proxy)
    .slice(-limit)
    .map((entry) => ({ timestamp: entry.timestamp_ms, delay: entry.delay_ms }));
}

/**
 * Builds the polyline for a series.
 *
 * Missing measurements are not interpolated: the chart is a record of what was
 * actually measured, so every point is a real sample and the spacing is the
 * sample index rather than wall-clock time.
 */
export function buildSeries(
  points: readonly NodeHistoryPoint[],
): { path: string; area: string; min: number; max: number } {
  if (points.length === 0) {
    return { path: "", area: "", min: 0, max: 0 };
  }

  const values = points.map((point) => point.delay);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat line still needs a non-zero span so it lands mid-height.
  const span = max - min || 1;

  const innerWidth = VIEW_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = VIEW_HEIGHT - PADDING.top - PADDING.bottom;

  const coords = points.map((point, index) => {
    const x =
      PADDING.left +
      (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const y =
      PADDING.top + innerHeight - ((point.delay - min) / span) * innerHeight;
    return { x: x.toFixed(2), y: y.toFixed(2) };
  });

  const path = coords
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x} ${y}`)
    .join(" ");
  const baseline = (PADDING.top + innerHeight).toFixed(2);
  const area = `${path} L${coords[coords.length - 1]?.x ?? PADDING.left} ${baseline} L${coords[0]?.x ?? PADDING.left} ${baseline} Z`;

  return { path, area, min, max };
}

/** Grid lines and their labels, at quarters of the value range. */
export function gridLines(min: number, max: number): Array<{ y: number; label: string }> {
  const span = max - min || 1;
  const innerHeight = VIEW_HEIGHT - PADDING.top - PADDING.bottom;
  return [0, 0.5, 1].map((fraction) => ({
    y: PADDING.top + innerHeight * fraction,
    label: `${Math.round(max - span * fraction)}`,
  }));
}

export const CHART_GEOMETRY = { VIEW_WIDTH, VIEW_HEIGHT, PADDING };
