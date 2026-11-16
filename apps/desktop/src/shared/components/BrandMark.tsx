export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 48"
      role="img"
      aria-label="FlowProxy"
    >
      <defs>
        <linearGradient id="brand-flow" x1="8" y1="12" x2="56" y2="38">
          <stop stopColor="var(--accent-cyan)" />
          <stop offset=".52" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-violet)" />
        </linearGradient>
      </defs>
      <path
        d="M6 19c8-8 16-8 24 0s16 8 24 0"
        fill="none"
        stroke="url(#brand-flow)"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <path
        d="M8 30c8-8 16-8 24 0s16 8 24 0"
        fill="none"
        stroke="url(#brand-flow)"
        strokeLinecap="round"
        strokeWidth="4.2"
        opacity=".72"
      />
      <circle cx="55" cy="10" r="3.5" fill="var(--accent-cyan)" />
    </svg>
  );
}
