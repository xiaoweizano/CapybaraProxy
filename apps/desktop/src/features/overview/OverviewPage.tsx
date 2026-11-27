import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  CircleGauge,
  Globe2,
  LoaderCircle,
  Network,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  OVERVIEW_CARDS,
  readHiddenCards,
  toggleCard,
  writeHiddenCards,
  type OverviewCardId,
} from "../../shared/overviewView";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  useRuntime,
  type RuntimeAction,
} from "../../app/runtime/runtimeContext";
import { useTelemetry } from "../../app/runtime/telemetryStore";
import { useTheme } from "../../app/theme/themeContext";
import {
  getProfiles,
  getTrafficSummary,
  type ProxyGroup,
  type ProxyNode,
  type RuntimeSnapshot,
  type RuntimeState,
  type TrafficTotals,
} from "../../platform/runtime";
import { LatencyGauge } from "./LatencyGauge";
import { Mascot } from "./Mascot";
import { NetworkOrb } from "./NetworkOrb";
import { NodeMap } from "./NodeMap";
import { TrafficChart } from "./TrafficChart";


const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

/** States in which the core is up and the tray offers Disconnect. */
function isActiveState(state: RuntimeState | undefined): boolean {
  return state === "connected" || state === "running_disconnected";
}

function formatSpeed(bytesPerSecond: number | null): string {
  return bytesPerSecond === null
    ? "--"
    : `${(bytesPerSecond / MEBIBYTE).toFixed(2)} MB/s`;
}

function formatSessionTraffic(bytes: number | null): string {
  if (bytes === null) {
    return "--";
  }

  if (bytes >= GIBIBYTE) {
    return `${(bytes / GIBIBYTE).toFixed(2)} GB`;
  }

  return `${(bytes / MEBIBYTE).toFixed(1)} MB`;
}

function formatDuration(
  startedAtMs: number | null,
  emptyLabel: string,
): string {
  if (startedAtMs === null) {
    return emptyLabel;
  }

  const totalSeconds = Math.max(
    0,
    Math.floor((Date.now() - startedAtMs) / 1_000),
  );
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}

function ConnectionHero({
  snapshot,
  pendingAction,
  onStart,
  onStop,
}: {
  snapshot: RuntimeSnapshot | null;
  pendingAction: RuntimeAction | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const connected = snapshot?.state === "connected";
  const telemetry = useTelemetry(connected);
  const latest = connected ? telemetry.latest : null;
  const downloadSeries =
    connected && telemetry.history.length > 0
      ? telemetry.history.map((point) => point.downloadBps)
      : [];
  const uploadSeries =
    connected && telemetry.history.length > 0
      ? telemetry.history.map((point) => point.uploadBps)
      : [];
  const sessionTraffic =
    latest === null
      ? null
      : latest.total_upload_bytes + latest.total_download_bytes;
  const state = snapshot?.state;

  return (
    <article className={`connection-hero connection-hero-${theme}`}>
      <div className="hero-visual">
        <div className="hero-visual-halo" aria-hidden="true" />
        {theme === "cyber_flow" ? <NetworkOrb /> : <Mascot />}
      </div>

      <div className="hero-information">
        <div className="hero-status-row">
          <span className="connection-status"
            data-status={state ?? "stopped"}
          >
            <span className="connection-status-dot" />
            <span>{state ? t(`runtime.state.${state}`) : t("runtime.state.loading")}</span>
          </span>
          <span className="hero-duration">
            {formatDuration(snapshot?.started_at_ms ?? null, t("overview.noActiveSession"))}
          </span>
        </div>

        <div className="hero-runtime-controls">
          {isActiveState(state) ? (
            <button
              type="button"
              className="hero-runtime-button is-stop"
              disabled={pendingAction !== null}
              onClick={onStop}
            >
              {pendingAction === "stop" ? t("runtime.disconnecting") : t("runtime.disconnect")}
            </button>
          ) : (
            <button
              type="button"
              className="hero-runtime-button"
              disabled={pendingAction !== null}
              onClick={onStart}
            >
              {pendingAction === "start" ? t("runtime.connecting") : t("runtime.connect")}
            </button>
          )}
        </div>

        <div className="hero-speed-grid">
          <div className="hero-speed">
            <span className="hero-speed-icon upload">
              <ArrowUp aria-hidden="true" size={17} strokeWidth={2.2} />
            </span>
            <span>
              <small>{t("overview.upload")}</small>
              <strong>{formatSpeed(latest?.upload_bps ?? null)}</strong>
            </span>
          </div>
          <div className="hero-speed">
            <span className="hero-speed-icon download">
              <ArrowDown aria-hidden="true" size={17} strokeWidth={2.2} />
            </span>
            <span>
              <small>{t("overview.download")}</small>
              <strong>{formatSpeed(latest?.download_bps ?? null)}</strong>
            </span>
          </div>
        </div>

        <div className="hero-traffic">
          <div className="hero-traffic-heading">
            <span>{t("overview.liveTraffic")}</span>
            <span className="traffic-legend">
              <span data-series="upload">{t("overview.up")}</span>
              <span data-series="download">{t("overview.down")}</span>
              <span>
                {telemetry.history.length > 0
                  ? t("overview.samples", { count: telemetry.history.length })
                  : t("overview.noSamples")}
              </span>
            </span>
          </div>
          {connected && !telemetry.latest ? (
            <p className="hero-telemetry-empty">
              {t("overview.waitingTelemetry")}
            </p>
          ) : !connected ? (
            <p className="hero-telemetry-empty">
              {t("overview.waitingTelemetry")}
            </p>
          ) : null}
          <TrafficChart
            downloadSeries={downloadSeries}
            uploadSeries={uploadSeries}
            label={t("overview.trafficLabel")}
          />
        </div>

        <div className="hero-today">
          <span>{t("overview.sessionTraffic")}</span>
          <strong>{formatSessionTraffic(sessionTraffic)}</strong>
        </div>
        <DailyTrafficRow />
      </div>
    </article>
  );
}

function ProxySelectionCard({
  group,
  groups,
  nodes,
  selectedNodeName,
  onGroupChange,
  onNodeChange,
}: {
  group: ProxyGroup | null;
  groups: ProxyGroup[];
  nodes: ProxyNode[];
  selectedNodeName: string;
  onGroupChange: (group: string) => void;
  onNodeChange: (node: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="overview-card proxy-card" aria-labelledby="proxy-title">
      <div className="overview-card-heading">
        <div>
          <span className="overview-card-kicker">{t("overview.routing")}</span>
          <h2 id="proxy-title">{t("overview.proxyGroup")}</h2>
        </div>
        <Network aria-hidden="true" size={17} />
      </div>

      <div className="proxy-select-row">
        <label htmlFor="proxy-group-select">{t("overview.group")}</label>
        <div className="select-wrap">
          <select
            id="proxy-group-select"
            value={group?.name ?? ""}
            disabled={groups.length === 0}
            onChange={(event) => onGroupChange(event.target.value)}
          >
            {groups.length === 0 ? (
              <option value="">{t("overview.noProxyGroups")}</option>
            ) : (
              groups.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name}
                </option>
              ))
            )}
          </select>
          <ChevronRight aria-hidden="true" size={13} />
        </div>
      </div>

      <div className="proxy-node-row">
        <div className="proxy-node-copy">
          <span className="overview-card-kicker">{t("overview.currentNode")}</span>
          <div className="proxy-node-name">
            <Globe2 aria-hidden="true" size={15} />
            <strong aria-live="polite">
              {selectedNodeName || t("overview.noNodeSelected")}
            </strong>
          </div>
        </div>
        <div className="select-wrap node-select-wrap">
          <label className="sr-only" htmlFor="proxy-node-select">
            {t("overview.currentNode")}
          </label>
          <select
            id="proxy-node-select"
            value={selectedNodeName}
            disabled={nodes.length === 0}
            onChange={(event) => {
              if (event.target.value) {
                onNodeChange(event.target.value);
              }
            }}
          >
            {nodes.length === 0 ? (
              <option value="">{t("overview.noNodes")}</option>
            ) : (
              nodes.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name}
                </option>
              ))
            )}
          </select>
          <ChevronRight aria-hidden="true" size={13} />
        </div>
      </div>
    </section>
  );
}

function LatencyCard({
  node,
  latencyMs,
  canMeasure,
  isMeasuring,
  onMeasure,
}: {
  node: ProxyNode | null;
  latencyMs: number | null;
  canMeasure: boolean;
  isMeasuring: boolean;
  onMeasure: () => void;
}) {
  const { t } = useTranslation();
  const quality =
    latencyMs === null
      ? { label: t("overview.latencyUnmeasured"), level: "unavailable" }
      : latencyMs < 80
        ? { label: t("overview.latencyExcellent"), level: "success" }
        : latencyMs < 150
          ? { label: t("overview.latencyGood"), level: "notice" }
          : { label: t("overview.latencyHigh"), level: "danger" };

  return (
    <section
      className="overview-card latency-card"
      aria-labelledby="latency-title"
    >
      <div className="overview-card-heading">
        <div>
          <span className="overview-card-kicker">
            {node?.name ?? t("overview.noActiveNode")}
          </span>
          <h2 id="latency-title">{t("overview.latency")}</h2>
        </div>
        <CircleGauge aria-hidden="true" size={17} />
      </div>
      <LatencyGauge value={latencyMs} />
      <span className="latency-quality" data-quality={quality.level}>
        {quality.label}
      </span>
      <button
        className="latency-measure-button"
        type="button"
        aria-label={t("overview.measureAria")}
        disabled={!canMeasure || isMeasuring}
        onClick={onMeasure}
      >
        {isMeasuring ? (
          <LoaderCircle aria-hidden="true" size={12} />
        ) : (
          <CircleGauge aria-hidden="true" size={12} />
        )}
        {isMeasuring ? t("overview.measuring") : t("overview.measureDelay")}
      </button>
    </section>
  );
}

function buildSparklinePath(values: readonly number[]): string {
  if (values.length === 0) {
    return "";
  }

  const maxValue = Math.max(1, ...values);
  const denominator = Math.max(values.length - 1, 1);

  return values
    .map((value, index) => {
      const x = 2 + (index / denominator) * 126;
      const y = 58 - (value / maxValue) * 48;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function ActiveConnectionsCard({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const telemetry = useTelemetry(connected);
  const latest = connected ? telemetry.latest : null;
  const history = connected
    ? telemetry.history.map((point) => point.activeConnections)
    : [];
  const linePath = buildSparklinePath(history);
  const areaPath = linePath ? `${linePath} L128 62 L2 62 Z` : "";

  return (
    <Link className="overview-card active-connections-card" to="/connections">
      <div className="overview-card-heading">
        <div>
          <span className="overview-card-kicker">{t("overview.liveSessions")}</span>
          <h2>{t("overview.activeConnections")}</h2>
        </div>
        <ArrowUpRight aria-hidden="true" size={17} />
      </div>

      <div className="connections-card-body">
        <strong>{latest?.active_connections ?? "--"}</strong>
        <svg
          className="connections-sparkline"
          viewBox="0 0 130 62"
          role="img"
          aria-label={t("overview.connectionHistory")}
        >
          <defs>
            <linearGradient id="connections-fill" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="var(--success)" stopOpacity=".45" />
              <stop offset="1" stopColor="var(--success)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath ? (
            <path d={areaPath} fill="url(#connections-fill)" />
          ) : null}
          {linePath ? (
            <path
              d={linePath}
              fill="none"
              stroke="var(--success)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.3"
            />
          ) : null}
        </svg>
      </div>
      <div className="connections-card-foot">
        <span className="connections-active-dot" />
        <span>
          {history.length > 0
            ? t("overview.samples", { count: history.length })
            : t("overview.waitingTelemetry")}
        </span>
      </div>
    </Link>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [selectedNodeName, setSelectedNodeName] = useState("");
  const [measuredDelays, setMeasuredDelays] = useState<
    Record<string, number>
  >({});
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [hiddenCards, setHiddenCards] = useState<Set<OverviewCardId>>(() =>
    readHiddenCards(window.localStorage),
  );
  const mountedRef = useRef(true);
  const groups = runtime.proxyGroups;
  const selectedGroup =
    groups.find((group) => group.name === selectedGroupName) ??
    groups[0] ??
    null;
  const groupNodes = selectedGroup?.nodes ?? [];
  const selectedNode =
    groupNodes.find((node) => node.name === selectedNodeName) ??
    groupNodes.find((node) => node.name === selectedGroup?.selected) ??
    groupNodes[0] ??
    null;
  const latencyMs = selectedNode
    ? (measuredDelays[selectedNode.name] ?? selectedNode.delay_ms)
    : null;
  const isConnected = runtime.snapshot?.state === "connected";

  const toggleCardVisibility = (card: OverviewCardId) => {
    setHiddenCards((current) => {
      const next = toggleCard(current, card);
      writeHiddenCards(window.localStorage, next);
      return next;
    });
  };
  const shows = (card: OverviewCardId) => !hiddenCards.has(card);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectGroup = (groupName: string) => {
    const nextGroup = groups.find((group) => group.name === groupName);
    const nextNode =
      nextGroup?.nodes.find((node) => node.name === nextGroup.selected) ??
      nextGroup?.nodes[0];

    if (!nextGroup || !nextNode) {
      return;
    }

    setSelectedGroupName(nextGroup.name);
    setSelectedNodeName(nextNode.name);
  };

  const selectNode = (nodeName: string) => {
    if (!selectedGroup) {
      return;
    }

    setSelectedNodeName(nodeName);
    void runtime.selectProxy(selectedGroup.name, nodeName);
  };

  const measureSelectedNodeDelay = async () => {
    if (!selectedNode || isMeasuring) {
      return;
    }

    const proxyName = selectedNode.name;
    setIsMeasuring(true);

    try {
      const delay = await runtime.measureDelay(proxyName);

      if (delay !== null && mountedRef.current) {
        setMeasuredDelays((current) => ({
          ...current,
          [proxyName]: delay,
        }));
      }
    } finally {
      if (mountedRef.current) {
        setIsMeasuring(false);
      }
    }
  };

  return (
    <section className="overview-page" aria-labelledby="overview-title">
      <h1 id="overview-title" className="sr-only">
        {t("nav.overview")}
      </h1>

      {runtime.lastError ? (
        <p className="overview-feedback overview-feedback-error" role="alert">
          <TriangleAlert aria-hidden="true" size={14} />
          {runtime.lastError.message}
        </p>
      ) : runtime.notice ? (
        <p className="overview-feedback" role="status">
          {runtime.notice}
        </p>
      ) : null}

      <FirstRunGuide />

      <div className="overview-dashboard">
        <ConnectionHero
          snapshot={runtime.snapshot}
          pendingAction={runtime.pendingAction}
          onStart={() => void runtime.start()}
          onStop={() => void runtime.stop()}
        />
        <div className="overview-middle-grid">
          {shows("selection") ? (
            <ProxySelectionCard
              group={selectedGroup}
              groups={groups}
              nodes={groupNodes}
              selectedNodeName={selectedNode?.name ?? ""}
              onGroupChange={selectGroup}
              onNodeChange={selectNode}
            />
          ) : null}
          {shows("latency") ? (
            <LatencyCard
              node={selectedNode}
              latencyMs={latencyMs}
              canMeasure={isConnected}
              isMeasuring={isMeasuring}
              onMeasure={() => void measureSelectedNodeDelay()}
            />
          ) : null}
        </div>
        {shows("nodeMap") || shows("connections") ? (
          <div className="overview-bottom-grid">
            {shows("nodeMap") ? <NodeMap /> : null}
            {shows("connections") ? (
              <ActiveConnectionsCard connected={isConnected} />
            ) : null}
          </div>
        ) : null}
        <OverviewCardToggles
          hidden={hiddenCards}
          onToggle={toggleCardVisibility}
        />
      </div>
    </section>
  );
}

/**
 * Today's and this week's transfer, from the app's own ledger.
 *
 * The session figure above resets when the core restarts; these do not, which
 * is what makes "how much have I used today" answerable after a relaunch.
 */
function DailyTrafficRow() {
  const { t } = useTranslation();
  const summary = useBridgeResource(getTrafficSummary, true);
  const today = summary.data?.today ?? null;
  const week = summary.data?.week ?? null;
  const total = (totals: TrafficTotals | null): number | null =>
    totals === null
      ? null
      : totals.upload_bytes + totals.download_bytes;

  return (
    <div className="hero-daily">
      <span>
        {t("overview.dailyTraffic")}
        <strong>{formatSessionTraffic(total(today))}</strong>
      </span>
      <span>
        {t("overview.weeklyTraffic")}
        <strong>{formatSessionTraffic(total(week))}</strong>
      </span>
    </div>
  );
}


/** Lets the operator hide cards they do not use, remembered across launches. */
function OverviewCardToggles({
  hidden,
  onToggle,
}: {
  hidden: ReadonlySet<OverviewCardId>;
  onToggle: (card: OverviewCardId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="overview-card-toggles">
      <span className="overview-card-toggles-label">
        {t("overview.cardsLabel")}
      </span>
      {OVERVIEW_CARDS.map((card) => (
        <button
          key={card}
          type="button"
          className="choice-chip"
          aria-pressed={!hidden.has(card)}
          aria-label={
            hidden.has(card)
              ? t("overview.showCard", { card: t(`overview.card.${card}`) })
              : t("overview.hideCard", { card: t(`overview.card.${card}`) })
          }
          onClick={() => onToggle(card)}
        >
          {t(`overview.card.${card}`)}
        </button>
      ))}
    </div>
  );
}


/**
 * Three-step guide for a fresh install.
 *
 * Shown only while no subscription is stored: once one exists the steps are
 * already done, and the hint would just be noise above the dashboard. Fetched
 * separately from the runtime data so it also works while the core is stopped.
 */
function FirstRunGuide() {
  const { t } = useTranslation();
  const profiles = useBridgeResource(getProfiles, true);
  const hasSubscription = (profiles.data ?? []).some(
    (profile) => profile.source === "subscription",
  );

  if (profiles.isLoading || hasSubscription) {
    return null;
  }

  const steps = [
    {
      title: t("overview.guideImportTitle"),
      body: t("overview.guideImportBody"),
      to: "/profiles",
      action: t("overview.guideImportAction"),
    },
    {
      title: t("overview.guideConnectTitle"),
      body: t("overview.guideConnectBody"),
    },
    {
      title: t("overview.guideProxyTitle"),
      body: t("overview.guideProxyBody"),
      to: "/settings",
      action: t("overview.guideProxyAction"),
    },
  ];

  return (
    <section className="overview-guide" aria-label={t("overview.guideLabel")}>
      <span className="workspace-kicker">{t("overview.guideKicker")}</span>
      <ol className="overview-guide-steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="overview-guide-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="overview-guide-copy">
              <strong>{step.title}</strong>
              <small>{step.body}</small>
            </span>
            {step.to ? (
              <Link className="workspace-action-button" to={step.to}>
                {step.action}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
