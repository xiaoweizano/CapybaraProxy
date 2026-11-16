import { useId, useMemo } from "react";

type TrafficChartProps = {
  downloadSeries: readonly number[];
  uploadSeries: readonly number[];
  label?: string;
};

const CHART_WIDTH = 520;
const CHART_HEIGHT = 130;
const CHART_PADDING = 8;

function buildChartPath(series: readonly number[], maxValue: number): string {
  const drawableWidth = CHART_WIDTH - CHART_PADDING * 2;
  const drawableHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const denominator = Math.max(series.length - 1, 1);

  return series
    .map((value, index) => {
      const x = CHART_PADDING + (index / denominator) * drawableWidth;
      const y =
        CHART_HEIGHT -
        CHART_PADDING -
        (value / maxValue) * drawableHeight;

      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function TrafficChart({
  downloadSeries,
  uploadSeries,
  label = "Upload and download traffic",
}: TrafficChartProps) {
  const gradientId = useId().replaceAll(":", "");

  const { downloadAreaPath, downloadLinePath, uploadLinePath } = useMemo(() => {
    const maxValue =
      Math.max(1, ...downloadSeries, ...uploadSeries) * 1.1;
    const downloadLine = buildChartPath(downloadSeries, maxValue);
    const uploadLine = buildChartPath(uploadSeries, maxValue);

    return {
      downloadAreaPath:
        downloadSeries.length === 0
          ? ""
          : `${downloadLine} L${CHART_WIDTH - CHART_PADDING} ${CHART_HEIGHT} L${CHART_PADDING} ${CHART_HEIGHT} Z`,
      downloadLinePath: downloadLine,
      uploadLinePath: uploadLine,
    };
  }, [downloadSeries, uploadSeries]);

  const latestDownloadSample = downloadSeries.at(-1);
  const latestUploadSample = uploadSeries.at(-1);
  const hasTrafficData =
    downloadSeries.length > 0 || uploadSeries.length > 0;

  return (
    <svg
      className="traffic-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label={label}
      data-latest-download-sample={latestDownloadSample?.toString() ?? ""}
      data-latest-upload-sample={latestUploadSample?.toString() ?? ""}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--chart-download)" stopOpacity=".4" />
          <stop offset=".7" stopColor="var(--chart-download)" stopOpacity=".08" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="traffic-chart-grid" aria-hidden="true">
        <line x1="8" y1="32" x2="512" y2="32" />
        <line x1="8" y1="71" x2="512" y2="71" />
        <line x1="8" y1="110" x2="512" y2="110" />
      </g>
      {hasTrafficData ? (
        <>
          <path
            className="traffic-chart-area"
            d={downloadAreaPath}
            fill={`url(#${gradientId})`}
          />
          <path
            className="traffic-chart-line traffic-chart-upload"
            d={uploadLinePath}
            fill="none"
            stroke="var(--chart-upload)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity=".78"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="traffic-chart-line traffic-chart-download"
            d={downloadLinePath}
            fill="none"
            stroke="var(--chart-download)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : null}
    </svg>
  );
}
