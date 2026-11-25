import { useTranslation } from "react-i18next";

export function NodeMap() {
  const { t } = useTranslation();

  return (
    <section className="overview-card node-map-card" aria-labelledby="map-title">
      <div className="overview-card-heading">
        <div>
          <span className="overview-card-kicker">{t("overview.globalRoutes")}</span>
          <h2 id="map-title">{t("overview.nodeMap")}</h2>
        </div>
        <span className="overview-card-note">{t("overview.locationUnavailable")}</span>
      </div>

      <div className="node-map-canvas">
        <svg
          className="world-map"
          viewBox="0 0 760 300"
          role="img"
          aria-label={t("overview.locationUnavailable")}
          preserveAspectRatio="xMidYMid meet"
        >
          <g className="map-latitude-lines" aria-hidden="true">
            <path d="M28 82h704M15 151h730M32 223h696" />
            <path d="M175 27c-22 74-22 169 0 246M380 18v264M585 28c22 74 22 166 0 244" />
          </g>
          <g className="map-land-masses" aria-hidden="true">
            <path d="M62 78c27-29 75-37 108-21 21 11 37 8 54 22 18 14 12 32-4 41-11 6-16 18-30 19-30 2-48 25-77 14-30-12-56-44-51-75Z" />
            <path d="M180 169c24-17 53-9 64 13 12 22 2 37-7 55-8 17-13 42-31 46-17 4-31-14-34-35-5-28 4-50 8-79Z" />
            <path d="M338 61c18-18 49-20 65-7 15 12 27 4 44 11 17 8 15 23 1 31-13 8-30 3-42 13-13 11-35 17-52 8-24-13-34-38-16-56Z" />
            <path d="M382 119c31-6 64 6 68 31 4 20-8 29-9 48-1 23-11 55-32 60-22 5-36-24-44-47-9-27-20-47-10-67 4-10 14-22 27-25Z" />
            <path d="M468 78c24-23 66-18 94-1 20 12 44 7 65 16 29 13 60 2 81 25 18 20 4 44-16 56-24 14-47 12-72 3-26-9-49-1-73-12-18-8-22-24-42-31-30-10-55-36-37-56Z" />
            <path d="M602 215c24-14 57-7 70 13 13 22-2 45-24 50-29 7-63-13-62-35 0-11 5-21 16-28Z" />
          </g>
        </svg>
        <span className="node-map-region node-map-region-americas">{t("overview.americas")}</span>
        <span className="node-map-region node-map-region-europe">{t("overview.europe")}</span>
        <span className="node-map-region node-map-region-asia">{t("overview.asiaPacific")}</span>
      </div>
    </section>
  );
}
