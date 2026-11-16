import {
  CircleStop,
  Play,
  RadioTower,
  RotateCw,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useSystemIntegration } from "../../app/systemIntegration/systemIntegrationContext";
import type {
  RuntimeLogEntry,
  RuntimeState,
} from "../../platform/runtime";

const MAX_VISIBLE_LOGS = 100;
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const stateLabels: Record<RuntimeState, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running_disconnected: "Running (not connected)",
  connected: "Connected",
  stopping: "Stopping",
  error: "Error",
  permission_required: "Permission required",
};

const capabilityLabels = {
  available: "Enabled",
  blocked: "Blocked",
  unsupported: "Unsupported",
  unverified: "Unverified",
} as const;

const systemProxyLabels = {
  disabled: "Disabled",
  enabled: "Enabled",
  managed_inactive: "Inactive",
} as const;

function canStart(state: RuntimeState | undefined): boolean {
  return state === "stopped" || state === "error";
}

function canStopOrRestart(state: RuntimeState | undefined): boolean {
  return (
    state === "running_disconnected" ||
    state === "connected" ||
    state === "error"
  );
}

function RuntimeLogRow({ entry }: { entry: RuntimeLogEntry }) {
  return (
    <li data-level={entry.level}>
      <time dateTime={new Date(entry.timestamp_ms).toISOString()}>
        {timeFormatter.format(entry.timestamp_ms)}
      </time>
      <span>{entry.message}</span>
    </li>
  );
}

export function MihomoCorePanel() {
  const integration = useSystemIntegration();
  const {
    snapshot,
    coreInfo,
    logs,
    isLoading,
    pendingAction,
    notice,
    lastError,
    start,
    stop,
    restart,
  } = useRuntime();
  const state = snapshot?.state;
  const isPending = pendingAction !== null;
  const visibleLogs = logs.slice(-MAX_VISIBLE_LOGS);
  const stateLabel = state
    ? stateLabels[state]
    : isLoading
      ? "Loading"
      : "Unavailable";
  const systemProxyLabel = integration.status
    ? systemProxyLabels[integration.status.system_proxy.state]
    : integration.isLoading
      ? "Checking"
      : "Unavailable";
  const tunLabel = integration.status
    ? capabilityLabels[integration.status.capabilities.tun.state]
    : integration.isLoading
      ? "Checking"
      : "Unavailable";

  return (
    <section
      className="settings-panel settings-panel-wide mihomo-core-panel"
      aria-labelledby="mihomo-core-title"
    >
      <div className="settings-panel-heading mihomo-core-heading">
        <div>
          <span className="settings-label">Proxy engine</span>
          <h2 id="mihomo-core-title">Mihomo Core</h2>
        </div>
        <span
          className="mihomo-core-badge"
          data-state={state ?? "unavailable"}
        >
          {stateLabel}
        </span>
      </div>

      <div className="mihomo-core-layout">
        <div className="mihomo-core-controls">
          <div className="runtime-status-line">
            <span
              className="runtime-state-dot"
              data-state={state ?? "unavailable"}
              aria-hidden="true"
            />
            <span className="runtime-state-copy">
              <strong>{stateLabel}</strong>
              <small>Locally managed process</small>
            </span>
            <span className="runtime-demo-tag">Loopback API</span>
          </div>

          <dl className="mihomo-core-facts">
            <div>
              <dt>Backend</dt>
              <dd>{coreInfo?.backend ?? snapshot?.backend ?? "N/A"}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{coreInfo?.version ?? "N/A"}</dd>
            </div>
            <div>
              <dt>PID</dt>
              <dd>{coreInfo?.pid ?? "N/A"}</dd>
            </div>
          </dl>

          <div className="runtime-action-grid">
            <button
              className="runtime-action runtime-action-primary"
              type="button"
              disabled={isPending || !canStart(state)}
              onClick={() => void start()}
            >
              <Play aria-hidden="true" size={13} />
              {pendingAction === "start" ? "Starting core" : "Start core"}
            </button>
            <button
              className="runtime-action"
              type="button"
              disabled={isPending || !canStopOrRestart(state)}
              onClick={() => void stop()}
            >
              <CircleStop aria-hidden="true" size={13} />
              {pendingAction === "stop" ? "Stopping core" : "Stop core"}
            </button>
            <button
              className="runtime-action"
              type="button"
              disabled={isPending || !canStopOrRestart(state)}
              onClick={() => void restart()}
            >
              <RotateCw aria-hidden="true" size={13} />
              {pendingAction === "restart"
                ? "Restarting core"
                : "Restart core"}
            </button>
          </div>

          {lastError ? (
            <div className="runtime-error" role="alert">
              <TriangleAlert aria-hidden="true" size={14} />
              <span>
                <strong>{lastError.message}</strong>
                <small>
                  {lastError.code}
                  {lastError.retryable ? " / retryable" : ""}
                </small>
              </span>
            </div>
          ) : null}

          {notice ? <p className="runtime-bridge-notice">{notice}</p> : null}

          <div className="mihomo-platform-boundary">
            <div>
              <span className="integration-icon">
                <RadioTower aria-hidden="true" size={16} />
              </span>
              <span>
                <strong>System proxy</strong>
                <small data-state={integration.status?.system_proxy.state}>
                  {systemProxyLabel}
                </small>
              </span>
            </div>
            <div>
              <span className="integration-icon">
                <ShieldCheck aria-hidden="true" size={16} />
              </span>
              <span>
                <strong>TUN interface</strong>
                <small data-state={integration.status?.capabilities.tun.state}>
                  {tunLabel}
                </small>
              </span>
            </div>
          </div>
        </div>

        <div className="runtime-log-panel">
          <div className="runtime-log-heading">
            <span>
              <ScrollText aria-hidden="true" size={13} />
              Runtime logs
            </span>
            <small>{visibleLogs.length} / 100</small>
          </div>
          {visibleLogs.length > 0 ? (
            <ol className="runtime-log-list">
              {visibleLogs.map((entry) => (
                <RuntimeLogRow key={entry.sequence} entry={entry} />
              ))}
            </ol>
          ) : (
            <div className="runtime-log-empty">No Runtime logs yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}
