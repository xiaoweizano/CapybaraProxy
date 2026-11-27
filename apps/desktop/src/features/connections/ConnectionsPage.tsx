import {
  ArrowDown,
  ArrowUp,
  Cable,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Search,
  XCircle,
} from "lucide-react";
import { useDeferredValue, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import {
  closeAllConnections,
  closeConnection,
  getConnections,
  type ConnectionSummary,
  type RuntimeError,
} from "../../platform/runtime";
import {
  LoadingState,
  RefreshButton,
  ResourceFeedback,
  RuntimeDisconnected,
  WorkspacePage,
} from "../workspace/WorkspaceUi";

const CONNECTIONS_PAGE_SIZE = 50;

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }

  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }

  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Keeps connections whose host, rule, chain or address contains `query`. */
function filterConnections(
  connections: ConnectionSummary[],
  query: string,
): ConnectionSummary[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return connections;
  }

  return connections.filter(
    (connection) =>
      connection.host.toLowerCase().includes(normalized) ||
      connection.destination_ip.toLowerCase().includes(normalized) ||
      connection.rule.toLowerCase().includes(normalized) ||
      connection.rule_payload.toLowerCase().includes(normalized) ||
      connection.chains.some((chain) =>
        chain.toLowerCase().includes(normalized),
      ),
  );
}

export function ConnectionsPage() {
  const { t } = useTranslation();
  const { snapshot } = useRuntime();
  const isConnected = snapshot?.state === "connected";
  const connections = useBridgeResource(getConnections, isConnected);
  const [pendingConnection, setPendingConnection] = useState<string | null>(
    null,
  );
  const closePendingRef = useRef(false);
  const [closedConnectionIds, setClosedConnectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [actionError, setActionError] = useState<RuntimeError | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [pendingCloseAll, setPendingCloseAll] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const close = async (connectionId: string) => {
    if (
      closePendingRef.current ||
      closedConnectionIds.has(connectionId)
    ) {
      return;
    }

    closePendingRef.current = true;
    setClosedConnectionIds((current) => {
      const next = new Set(current);
      next.add(connectionId);
      return next;
    });
    setPendingConnection(connectionId);
    setActionError(null);
    try {
      const result = await closeConnection(connectionId);
      if (result.status === "ok") {
        connections.setData((current) =>
          current
            ? {
                ...current,
                connections: current.connections.filter(
                  (connection) => connection.id !== connectionId,
                ),
              }
            : current,
        );
        await connections.reload();
      } else if (result.status === "error") {
        setClosedConnectionIds((current) => {
          const next = new Set(current);
          next.delete(connectionId);
          return next;
        });
        setActionError(result.error);
      }
    } catch {
      setClosedConnectionIds((current) => {
        const next = new Set(current);
        next.delete(connectionId);
        return next;
      });
      setActionError({
        code: "internal",
        message: "FlowProxy could not close the selected connection.",
        retryable: true,
      });
    } finally {
      closePendingRef.current = false;
      setPendingConnection(null);
    }
  };

  /** Closes every cached connection after the operator confirms. */
  const closeAll = async () => {
    if (pendingCloseAll || visibleConnections.length === 0) {
      return;
    }
    if (
      !window.confirm(
        t("connections.closeAllConfirm", { count: visibleConnections.length }),
      )
    ) {
      return;
    }

    setPendingCloseAll(true);
    setActionError(null);
    try {
      const result = await closeAllConnections();
      if (result.status === "ok") {
        await connections.reload();
        setPage(1);
      } else if (result.status === "error") {
        setActionError(result.error);
      }
    } catch {
      setActionError({
        code: "internal",
        message: "FlowProxy could not close the connections.",
        retryable: true,
      });
    } finally {
      setPendingCloseAll(false);
    }
  };

  const isFiltering = deferredQuery.trim() !== "";
  const filteredConnections = filterConnections(
    connections.data?.connections.filter(
      (connection) => !closedConnectionIds.has(connection.id),
    ) ?? [],
    deferredQuery,
  );
  const visibleConnections = filteredConnections;
  const totalOpenConnections = (connections.data?.connections ?? []).filter(
    (connection) => !closedConnectionIds.has(connection.id),
  ).length;
  const pageCount = Math.max(
    1,
    Math.ceil(visibleConnections.length / CONNECTIONS_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * CONNECTIONS_PAGE_SIZE;
  const pagedConnections = visibleConnections.slice(
    pageStart,
    pageStart + CONNECTIONS_PAGE_SIZE,
  );

  if (page > pageCount) {
    setPage(pageCount);
  }

  return (
    <WorkspacePage
      eyebrow={t("connections.eyebrow")}
      title={t("connections.title")}
      badge={isConnected ? t("common.liveMihomo") : t("common.offline")}
    >
      <ResourceFeedback
        error={connections.error ?? actionError}
        unavailable={connections.unavailable}
      />

      {!isConnected ? (
        <RuntimeDisconnected />
      ) : (
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <div>
              <span className="workspace-kicker">{t("connections.kicker")}</span>
              <h2>{t("connections.heading")}</h2>
            </div>
            <div className="workspace-panel-actions">
              <span className="workspace-count">
                {t("connections.count", { count: totalOpenConnections })}
              </span>
              <button
                className="workspace-action-button connections-close-all"
                type="button"
                disabled={pendingCloseAll || totalOpenConnections === 0}
                onClick={() => void closeAll()}
              >
                <XCircle aria-hidden="true" size={14} />
                {pendingCloseAll
                  ? t("connections.closingAll")
                  : t("connections.closeAll")}
              </button>
              <RefreshButton
                isLoading={connections.isLoading}
                onClick={() => void connections.reload()}
                label={t("connections.refresh")}
              />
            </div>
          </div>

          {totalOpenConnections > 0 ? (
            <label className="filter-search connections-search">
              <Search aria-hidden="true" size={15} />
              <input
                type="search"
                value={query}
                placeholder={t("connections.searchPlaceholder")}
                aria-label={t("connections.searchLabel")}
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}

          {connections.data ? (
            <div className="connections-summary">
              <span>
                <ArrowUp aria-hidden="true" size={13} />
                {t("connections.uploaded", { value: formatBytes(connections.data.upload_total_bytes) })}
              </span>
              <span>
                <ArrowDown aria-hidden="true" size={13} />
                {t("connections.downloaded", { value: formatBytes(connections.data.download_total_bytes) })}
              </span>
              <span>{t("connections.memory", { value: formatBytes(connections.data.memory_bytes) })}</span>
            </div>
          ) : null}

          {connections.isLoading && connections.data === null ? (
            <LoadingState label={t("connections.loading")} />
          ) : visibleConnections.length === 0 ? (
            totalOpenConnections > 0 && isFiltering ? (
              <p className="workspace-hint" role="status">
                {t("connections.searchEmpty", { query: deferredQuery.trim() })}
              </p>
            ) : (
              <div className="workspace-empty">
                <Cable aria-hidden="true" size={22} />
                <div>
                  <h2>{t("connections.emptyTitle")}</h2>
                  <p>{t("connections.emptyBody")}</p>
                </div>
              </div>
            )
          ) : (
            <>
              <div className="connection-list">
                {pagedConnections.map((connection) => (
                  <article className="connection-row" key={connection.id}>
                    <span className="connection-icon" aria-hidden="true">
                      <Cable size={16} />
                    </span>
                    <span className="connection-main">
                      <strong>
                        {connection.host || connection.destination_ip}
                      </strong>
                      <small>
                        {connection.destination_ip}:{connection.destination_port}
                      </small>
                    </span>
                    <span className="connection-route">
                      <strong>{connection.rule}</strong>
                      <small>{connection.chains.join(" / ")}</small>
                    </span>
                    <span className="connection-volume">
                      <strong>{formatBytes(connection.download_bytes)}</strong>
                      <small>{connection.network.toUpperCase()}</small>
                    </span>
                    <button
                      className="workspace-icon-button workspace-danger-button"
                      type="button"
                      aria-label={t("connections.close", { name: connection.host || connection.destination_ip })}
                      title={t("connections.close", { name: connection.host || connection.destination_ip })}
                      disabled={pendingConnection !== null}
                      onClick={() => void close(connection.id)}
                    >
                      <CircleX aria-hidden="true" size={16} />
                    </button>
                  </article>
                ))}
              </div>
              {pageCount > 1 ? (
                <nav className="connection-pagination" aria-label={t("connections.pagination")}>
                  <span>
                    {t("connections.page", { current: currentPage, total: pageCount })}
                  </span>
                  <div>
                    <button
                      className="workspace-icon-button"
                      type="button"
                      aria-label={t("connections.previousPage")}
                      disabled={currentPage === 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                    >
                      <ChevronLeft aria-hidden="true" size={15} />
                    </button>
                    <button
                      className="workspace-icon-button"
                      type="button"
                      aria-label={t("connections.nextPage")}
                      disabled={currentPage === pageCount}
                      onClick={() =>
                        setPage((current) => Math.min(pageCount, current + 1))
                      }
                    >
                      <ChevronRight aria-hidden="true" size={15} />
                    </button>
                  </div>
                </nav>
              ) : null}
            </>
          )}
        </section>
      )}
    </WorkspacePage>
  );
}
