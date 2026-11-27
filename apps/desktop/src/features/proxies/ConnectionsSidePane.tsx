import { ArrowDown, ArrowUp, Cable } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { getConnections } from "../../platform/runtime";

/**
 * A compact live-connection pane for the split layout.
 *
 * The full Connections page is built around search, pagination and per-row
 * actions; beside the proxy groups the question is narrower — "did selecting
 * this node change what is flowing right now" — so this shows the newest few
 * sessions and the totals only.
 */

const SPLIT_ROWS = 12;

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function ConnectionsSidePane() {
  const { t } = useTranslation();
  const { snapshot } = useRuntime();
  const connected = snapshot?.state === "connected";
  const connections = useBridgeResource(getConnections, connected);
  const rows = [...(connections.data?.connections ?? [])]
    .sort((left, right) => right.started_at_ms - left.started_at_ms)
    .slice(0, SPLIT_ROWS);

  return (
    <aside className="workspace-panel connections-side-pane">
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t("connections.kicker")}</span>
          <h2>{t("proxies.splitHeading")}</h2>
        </div>
        <span className="workspace-count">
          {connections.data?.connections.length ?? 0}
        </span>
      </div>

      {!connected ? (
        <p className="workspace-hint">{t("proxies.splitNeedsCore")}</p>
      ) : connections.data ? (
        <>
          <div className="connections-side-pane-totals">
            <span>
              <ArrowUp aria-hidden="true" size={12} />
              {formatBytes(connections.data.upload_total_bytes)}
            </span>
            <span>
              <ArrowDown aria-hidden="true" size={12} />
              {formatBytes(connections.data.download_total_bytes)}
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="workspace-hint">{t("connections.emptyTitle")}</p>
          ) : (
            <ul className="connections-side-pane-list">
              {rows.map((connection) => (
                <li key={connection.id}>
                  <Cable aria-hidden="true" size={13} />
                  <span title={connection.host || connection.destination_ip}>
                    {connection.host || connection.destination_ip}
                  </span>
                  <small>{formatBytes(connection.download_bytes)}</small>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="workspace-hint">{t("common.loading")}</p>
      )}
    </aside>
  );
}
