import {
  ArrowDown,
  ArrowUp,
  Cable,
  ChevronLeft,
  ChevronRight,
  CircleX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import {
  closeConnection,
  getConnections,
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

export function ConnectionsPage() {
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

  const visibleConnections =
    connections.data?.connections.filter(
      (connection) => !closedConnectionIds.has(connection.id),
    ) ?? [];
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

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  return (
    <WorkspacePage
      eyebrow="Live traffic"
      title="Connections"
      badge={isConnected ? "Live Mihomo" : "Offline"}
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
              <span className="workspace-kicker">Mihomo API</span>
              <h2>Active Connections</h2>
            </div>
            <div className="workspace-panel-actions">
              <span className="workspace-count">
                {visibleConnections.length} sessions
              </span>
              <RefreshButton
                isLoading={connections.isLoading}
                onClick={() => void connections.reload()}
                label="Refresh connections"
              />
            </div>
          </div>

          {connections.data ? (
            <div className="connections-summary">
              <span>
                <ArrowUp aria-hidden="true" size={13} />
                {formatBytes(connections.data.upload_total_bytes)} uploaded
              </span>
              <span>
                <ArrowDown aria-hidden="true" size={13} />
                {formatBytes(connections.data.download_total_bytes)} downloaded
              </span>
              <span>{formatBytes(connections.data.memory_bytes)} memory</span>
            </div>
          ) : null}

          {connections.isLoading && connections.data === null ? (
            <LoadingState label="Loading active connections..." />
          ) : visibleConnections.length === 0 ? (
            <div className="workspace-empty">
              <Cable aria-hidden="true" size={22} />
              <div>
                <h2>No active connections</h2>
                <p>Mihomo is running, but no proxy sessions are open.</p>
              </div>
            </div>
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
                      aria-label={`Close connection ${connection.host || connection.destination_ip}`}
                      title="Close connection"
                      disabled={pendingConnection !== null}
                      onClick={() => void close(connection.id)}
                    >
                      <CircleX aria-hidden="true" size={16} />
                    </button>
                  </article>
                ))}
              </div>
              {pageCount > 1 ? (
                <nav className="connection-pagination" aria-label="Connections pages">
                  <span>
                    Page {currentPage} of {pageCount}
                  </span>
                  <div>
                    <button
                      className="workspace-icon-button"
                      type="button"
                      aria-label="Previous connections page"
                      disabled={currentPage === 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                    >
                      <ChevronLeft aria-hidden="true" size={15} />
                    </button>
                    <button
                      className="workspace-icon-button"
                      type="button"
                      aria-label="Next connections page"
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
