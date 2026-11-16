export function LatencyGauge({ value }: { value: number | null }) {
  const radius = 55;
  const circumference = Math.PI * 2 * radius;
  const normalizedValue =
    value !== null && Number.isFinite(value) && value >= 0 ? value : null;
  const progress =
    normalizedValue === null ? 0 : Math.min(normalizedValue / 120, 1);

  return (
    <div
      className="latency-gauge"
      role="img"
      aria-label={
        normalizedValue === null
          ? "Latency not measured"
          : `Latency ${normalizedValue} milliseconds`
      }
    >
      <svg viewBox="0 0 150 150" aria-hidden="true">
        <defs>
          <linearGradient id="latency-gradient" x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="var(--accent-cyan)" />
            <stop offset=".54" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-violet)" />
          </linearGradient>
        </defs>
        <circle
          className="latency-gauge-track"
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          strokeWidth="9"
        />
        <circle
          className="latency-gauge-progress"
          cx="75"
          cy="75"
          r={radius}
          fill="none"
          stroke="url(#latency-gradient)"
          strokeDasharray={`${circumference * progress} ${circumference}`}
          strokeLinecap="round"
          strokeWidth="9"
          transform="rotate(-90 75 75)"
        />
        {normalizedValue === null ? null : (
          <circle
            className="latency-gauge-cap"
            cx={75 + radius * Math.cos(progress * Math.PI * 2 - Math.PI / 2)}
            cy={75 + radius * Math.sin(progress * Math.PI * 2 - Math.PI / 2)}
            r="5"
          />
        )}
      </svg>
      <div className="latency-gauge-value">
        <strong>{normalizedValue ?? "--"}</strong>
        {normalizedValue === null ? null : <span>ms</span>}
      </div>
    </div>
  );
}
