import {
  CHART_GEOMETRY,
  buildSeries,
  gridLines,
  type NodeHistoryPoint,
} from "./latencySeries";

/** A node's measured latency over time, as an inline SVG. */
export function LatencySparkline({
  points,
  label,
  emptyLabel,
}: {
  points: readonly NodeHistoryPoint[];
  label: string;
  emptyLabel: string;
}) {
  const { path, area, min, max } = buildSeries(points);
  const { VIEW_WIDTH, VIEW_HEIGHT, PADDING } = CHART_GEOMETRY;
  const lines = gridLines(min, max);

  return (
    <div className="latency-sparkline">
      {points.length === 0 ? (
        <p className="workspace-hint">{emptyLabel}</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            role="img"
            aria-label={label}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="latency-area" x1="0" y1="0" x2="0" y2="1">
                <stop stopColor="var(--accent-cyan)" stopOpacity=".28" />
                <stop offset="1" stopColor="var(--accent-cyan)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {lines.map((line) => (
              <g key={line.label}>
                <line
                  x1={PADDING.left}
                  x2={VIEW_WIDTH - PADDING.right}
                  y1={line.y}
                  y2={line.y}
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                />
                <text
                  x={PADDING.left - 6}
                  y={line.y + 3}
                  textAnchor="end"
                  className="latency-sparkline-label"
                >
                  {line.label}
                </text>
              </g>
            ))}
            <path d={area} fill="url(#latency-area)" />
            <path
              d={path}
              fill="none"
              stroke="var(--accent-cyan)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <p className="latency-sparkline-range">
            {min} – {max} ms · {points.length}
          </p>
        </>
      )}
    </div>
  );
}
