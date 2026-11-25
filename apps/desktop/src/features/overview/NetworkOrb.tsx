import { useTranslation } from "react-i18next";

export function NetworkOrb() {
  const { t } = useTranslation();

  return (
    <svg
      className="network-orb"
      viewBox="0 0 430 340"
      role="img"
      aria-label={t("diagram.networkOrb")}
    >
      <defs>
        <radialGradient id="orb-sphere" cx=".42" cy=".34" r=".68">
          <stop offset="0" stopColor="#68e4ff" />
          <stop offset=".2" stopColor="#168cff" />
          <stop offset=".58" stopColor="#4852ff" />
          <stop offset=".82" stopColor="#672bea" />
          <stop offset="1" stopColor="#19165e" />
        </radialGradient>
        <linearGradient id="orb-stream" x1="74" y1="185" x2="356" y2="146">
          <stop stopColor="#36dfff" stopOpacity="0" />
          <stop offset=".22" stopColor="#36dfff" />
          <stop offset=".62" stopColor="#8665ff" />
          <stop offset="1" stopColor="#d16cff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="orb-rim" x1="95" y1="42" x2="342" y2="292">
          <stop stopColor="#76efff" />
          <stop offset=".5" stopColor="#348bff" />
          <stop offset="1" stopColor="#8d48ff" />
        </linearGradient>
        <radialGradient id="orb-glow">
          <stop stopColor="#398aff" stopOpacity=".7" />
          <stop offset=".48" stopColor="#6244ff" stopOpacity=".24" />
          <stop offset="1" stopColor="#150c5e" stopOpacity="0" />
        </radialGradient>
        <filter id="orb-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="11" />
        </filter>
        <filter id="orb-rim-glow" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="orb-sphere-clip">
          <circle cx="215" cy="160" r="105" />
        </clipPath>
      </defs>

      <ellipse
        className="orb-aura"
        cx="215"
        cy="165"
        rx="196"
        ry="148"
        fill="url(#orb-glow)"
      />
      <ellipse
        className="orb-orbit orb-orbit-back"
        cx="215"
        cy="164"
        rx="174"
        ry="64"
        fill="none"
        stroke="#5b56ff"
        strokeOpacity=".3"
        strokeWidth="1.2"
        transform="rotate(-12 215 164)"
      />
      <ellipse
        className="orb-orbit orb-orbit-front"
        cx="215"
        cy="178"
        rx="178"
        ry="55"
        fill="none"
        stroke="url(#orb-stream)"
        strokeWidth="2.1"
        transform="rotate(9 215 178)"
        filter="url(#orb-rim-glow)"
      />

      <circle
        cx="215"
        cy="160"
        r="118"
        fill="#275dff"
        fillOpacity=".12"
        filter="url(#orb-soft-glow)"
      />
      <circle
        cx="215"
        cy="160"
        r="105"
        fill="url(#orb-sphere)"
        stroke="url(#orb-rim)"
        strokeWidth="2.2"
        filter="url(#orb-rim-glow)"
      />

      <g clipPath="url(#orb-sphere-clip)" opacity=".72">
        <path
          d="M97 132c30-44 76-65 118-66 50-1 96 19 122 58"
          fill="none"
          stroke="#56e3ff"
          strokeOpacity=".32"
          strokeWidth="1.1"
        />
        <path
          d="M94 172c44-39 89-56 132-53 62 4 98 40 116 85"
          fill="none"
          stroke="#72e5ff"
          strokeOpacity=".28"
          strokeWidth="1.2"
        />
        <path
          d="M123 226c35-28 66-39 98-39 45 0 78 19 101 47"
          fill="none"
          stroke="#b76dff"
          strokeOpacity=".38"
          strokeWidth="1.1"
        />
        <path
          d="M85 203c45-15 73-9 101 9 32 20 62 23 99 6 25-11 48-12 77-3"
          fill="none"
          stroke="url(#orb-stream)"
          strokeLinecap="round"
          strokeWidth="8"
          filter="url(#orb-rim-glow)"
        />
        <path
          d="M107 117c32 5 52 20 66 42 16 25 31 35 49 35 19 0 39-15 60-45 11-16 25-28 46-36"
          fill="none"
          stroke="#c167ff"
          strokeOpacity=".56"
          strokeLinecap="round"
          strokeWidth="2.3"
        />
        <path
          d="M66 248c54-21 93-17 133 10 31 21 57 25 86 14 31-12 61-10 89 7"
          fill="none"
          stroke="#715dff"
          strokeOpacity=".68"
          strokeLinecap="round"
          strokeWidth="15"
          filter="url(#orb-soft-glow)"
        />
        <ellipse
          cx="136"
          cy="105"
          rx="43"
          ry="22"
          fill="#d9fbff"
          fillOpacity=".11"
          transform="rotate(-31 136 105)"
        />
      </g>

      <g className="orb-particles" fill="#70e8ff">
        <circle cx="87" cy="97" r="2.4" />
        <circle cx="344" cy="103" r="1.8" fillOpacity=".7" />
        <circle cx="332" cy="241" r="2.1" />
        <circle cx="67" cy="207" r="1.5" fillOpacity=".6" />
        <circle cx="119" cy="291" r="1.4" fillOpacity=".5" />
        <circle cx="357" cy="178" r="1.2" fillOpacity=".55" />
      </g>
      <circle cx="92" cy="95" r="5" fill="#55dfff" fillOpacity=".17" />
      <circle cx="335" cy="104" r="8" fill="#8b65ff" fillOpacity=".12" />
    </svg>
  );
}
