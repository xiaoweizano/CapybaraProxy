import { useTranslation } from "react-i18next";

export function Mascot() {
  const { t } = useTranslation();

  return (
    <svg
      className="warm-mascot"
      viewBox="0 0 520 330"
      role="img"
      aria-label={t("diagram.mascot")}
    >
      <defs>
        <linearGradient id="mascot-body" x1="158" y1="98" x2="355" y2="280">
          <stop stopColor="#ffffff" />
          <stop offset=".7" stopColor="#edf7ff" />
          <stop offset="1" stopColor="#bcdcff" />
        </linearGradient>
        <linearGradient id="mascot-blue" x1="171" y1="157" x2="349" y2="223">
          <stop stopColor="#4ab9ff" />
          <stop offset="1" stopColor="#3976ec" />
        </linearGradient>
        <linearGradient id="mascot-ring" x1="93" y1="172" x2="432" y2="207">
          <stop stopColor="#ffb55c" />
          <stop offset=".45" stopColor="#fff0cc" />
          <stop offset="1" stopColor="#69ccff" />
        </linearGradient>
        <radialGradient id="mascot-face" cx=".5" cy=".38" r=".68">
          <stop stopColor="#183c76" />
          <stop offset="1" stopColor="#0c1739" />
        </radialGradient>
        <filter id="mascot-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      <ellipse
        cx="266"
        cy="282"
        rx="145"
        ry="28"
        fill="#83a2c1"
        fillOpacity=".18"
        filter="url(#mascot-shadow)"
      />

      <g className="mascot-clouds" fill="#ffffff" fillOpacity=".8">
        <path d="M67 255c3-20 19-32 38-30 8-21 35-28 49-11 17-2 30 11 31 27l23 14H55c3-7 6-10 12-12Z" />
        <path d="M350 263c2-14 13-23 27-22 6-15 25-20 35-8 12-1 21 8 22 19l16 10H341c2-5 4-7 9-8Z" />
      </g>

      <g className="mascot-orbit mascot-orbit-back">
        <ellipse
          cx="261"
          cy="203"
          rx="176"
          ry="51"
          fill="none"
          stroke="url(#mascot-ring)"
          strokeLinecap="round"
          strokeWidth="13"
          transform="rotate(-9 261 203)"
        />
      </g>

      <g className="mascot-character">
        <path
          d="M184 228c-30 6-52 2-67-15-8-9-3-24 10-26 15-3 28 5 37 17"
          fill="url(#mascot-body)"
          stroke="#b9d7f2"
          strokeWidth="2"
        />
        <path
          d="M342 228c30 6 52 2 67-15 8-9 3-24-10-26-15-3-28 5-37 17"
          fill="url(#mascot-body)"
          stroke="#b9d7f2"
          strokeWidth="2"
        />
        <ellipse cx="263" cy="248" rx="90" ry="58" fill="url(#mascot-body)" />
        <path
          d="M188 240c16-12 39-20 75-20s61 8 77 20"
          fill="none"
          stroke="#a8cdf0"
          strokeOpacity=".7"
          strokeWidth="1.5"
        />
        <path
          d="M196 98 173 57c-5-9 5-18 13-12l46 30"
          fill="#f8fcff"
          stroke="#abd0ed"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <path
          d="m329 99 23-41c5-9-5-18-13-12l-46 30"
          fill="#f8fcff"
          stroke="#abd0ed"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <path
          d="M183 126c0-43 35-72 80-72s80 29 80 72v61c0 45-35 76-80 76s-80-31-80-76v-61Z"
          fill="url(#mascot-body)"
          stroke="#b9d8f1"
          strokeWidth="2.5"
        />
        <rect
          x="195"
          y="113"
          width="136"
          height="92"
          rx="42"
          fill="url(#mascot-face)"
        />
        <ellipse cx="228" cy="158" rx="12" ry="16" fill="#61ddff" />
        <ellipse cx="294" cy="158" rx="12" ry="16" fill="#61ddff" />
        <ellipse cx="232" cy="151" rx="4" ry="5" fill="#e8fdff" />
        <ellipse cx="298" cy="151" rx="4" ry="5" fill="#e8fdff" />
        <path
          d="M247 184c9 8 23 8 32 0"
          fill="none"
          stroke="#61ddff"
          strokeLinecap="round"
          strokeWidth="4"
        />
        <circle cx="268" cy="115" r="4" fill="#ff9c4a" />
        <path
          d="M220 239c12 7 22 10 42 10s31-3 43-10"
          fill="none"
          stroke="#bfdff5"
          strokeWidth="1.5"
        />
        <circle cx="263" cy="233" r="5" fill="#ffac5d" />
        <circle cx="263" cy="233" r="9" fill="none" stroke="#ffc180" strokeOpacity=".5" />
        <ellipse cx="232" cy="268" rx="25" ry="12" fill="#78aef0" />
        <ellipse cx="294" cy="268" rx="25" ry="12" fill="#78aef0" />
        <path
          d="M211 268h42M274 268h42"
          stroke="#eff9ff"
          strokeLinecap="round"
          strokeWidth="4"
        />
      </g>

      <g className="mascot-orbit mascot-orbit-front">
        <path
          d="M88 196c36 26 95 43 172 43 86 0 151-20 177-48"
          fill="none"
          stroke="url(#mascot-ring)"
          strokeLinecap="round"
          strokeWidth="13"
        />
        <circle cx="92" cy="193" r="8" fill="#ffac55" />
        <circle cx="435" cy="197" r="7" fill="#69ccff" />
      </g>

      <g className="mascot-sparks" fill="#ffb35f">
        <path d="m103 110 5 12 13 5-13 5-5 13-5-13-12-5 12-5 5-12Z" />
        <path d="m419 102 4 9 10 4-10 4-4 10-4-10-10-4 10-4 4-9Z" fillOpacity=".78" />
        <circle cx="375" cy="68" r="4" fillOpacity=".55" />
        <circle cx="130" cy="73" r="3" fill="#6bcfff" />
      </g>
    </svg>
  );
}
