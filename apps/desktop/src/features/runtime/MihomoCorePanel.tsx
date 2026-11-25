import {
  CircleStop,
  Play,
  RadioTower,
  RotateCw,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useSystemIntegration } from "../../app/systemIntegration/systemIntegrationContext";
import type {
  RuntimeLogEntry,
  RuntimeState,
} from "../../platform/runtime";

const MAX_VISIBLE_LOGS = 100;

function useTimeFormatter() {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

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
  const timeFormatter = useTimeFormatter();

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
  const { t } = useTranslation();
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
    ? t(`runtime.state.${state}`)
    : isLoading
      ? t("runtime.state.loading")
      : t("runtime.state.unavailable");
  const systemProxyLabel = integration.status
    ? t(
        `common.${
          integration.status.system_proxy.state === "managed_inactive"
            ? "inactive"
            : integration.status.system_proxy.state
        }`,
      )
    : integration.isLoading
      ? t("common.checking")
      : t("common.unavailable");
  const tunLabel = integration.status
    ? t(`common.${integration.status.capabilities.tun.state}`)
    : integration.isLoading
      ? t("common.checking")
      : t("common.unavailable");

  return (
    <section
      className="settings-panel settings-panel-wide mihomo-core-panel"
      aria-labelledby="mihomo-core-title"
    >
      <div className="settings-panel-heading mihomo-core-heading">
        <div>
          <span className="settings-label">{t("core.kicker")}</span>
          <h2 id="mihomo-core-title">{t("core.title")}</h2>
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
              <small>{t("core.localProcess")}</small>
            </span>
            <span className="runtime-demo-tag">{t("core.loopbackApi")}</span>
          </div>

          <dl className="mihomo-core-facts">
            <div>
              <dt>{t("core.backend")}</dt>
              <dd>{coreInfo?.backend ?? snapshot?.backend ?? t("common.notAvailable")}</dd>
            </div>
            <div>
              <dt>{t("core.version")}</dt>
              <dd>{coreInfo?.version ?? t("common.notAvailable")}</dd>
            </div>
            <div>
              <dt>{t("core.pid")}</dt>
              <dd>{coreInfo?.pid ?? t("common.notAvailable")}</dd>
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
              {pendingAction === "start" ? t("core.starting") : t("core.start")}
            </button>
            <button
              className="runtime-action"
              type="button"
              disabled={isPending || !canStopOrRestart(state)}
              onClick={() => void stop()}
            >
              <CircleStop aria-hidden="true" size={13} />
              {pendingAction === "stop" ? t("core.stopping") : t("core.stop")}
            </button>
            <button
              className="runtime-action"
              type="button"
              disabled={isPending || !canStopOrRestart(state)}
              onClick={() => void restart()}
            >
              <RotateCw aria-hidden="true" size={13} />
              {pendingAction === "restart"
                ? t("core.restarting")
                : t("core.restart")}
            </button>
          </div>

          {lastError ? (
            <div className="runtime-error" role="alert">
              <TriangleAlert aria-hidden="true" size={14} />
              <span>
                <strong>{lastError.message}</strong>
                <small>
                  {lastError.code}
                  {lastError.retryable ? ` / ${t("core.retryable")}` : ""}
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
                <strong>{t("core.systemProxy")}</strong>
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
                <strong>{t("core.tun")}</strong>
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
              {t("core.logs")}
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
            <div className="runtime-log-empty">{t("core.noLogs")}</div>
          )}
        </div>
      </div>
    </section>
  );
}
