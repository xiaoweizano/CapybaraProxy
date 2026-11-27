import { FolderOpen, Pause, Play, ScrollText, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { openLogDirectory } from "../../platform/runtime";
import type { RuntimeLogEntry, RuntimeLogLevel } from "../../platform/runtime";
import { WorkspacePage } from "../workspace/WorkspaceUi";

type LogFilter = "all" | RuntimeLogLevel;

function matchesQuery(entry: RuntimeLogEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return (
    normalized === "" || entry.message.toLowerCase().includes(normalized)
  );
}

export function LogsPage() {
  const { t, i18n } = useTranslation();
  const { logs } = useRuntime();
  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  // Entries below this sequence were cleared from the view. The Runtime keeps
  // buffering, so clearing here never destroys evidence an operator may still
  // need from the on-disk log file.
  const [clearedThrough, setClearedThrough] = useState(0);
  // Pausing freezes the list so an operator can read a burst of events; new
  // entries keep accumulating and appear on resume.
  const [paused, setPaused] = useState(false);
  const [frozenAt, setFrozenAt] = useState<RuntimeLogEntry[] | null>(null);
  const [openPending, setOpenPending] = useState(false);
  const deferredFilter = useDeferredValue(filter);
  const deferredQuery = useDeferredValue(query);

  const source = paused && frozenAt ? frozenAt : logs;
  const afterClear = source.filter((entry) => entry.sequence > clearedThrough);
  const byLevel =
    deferredFilter === "all"
      ? afterClear
      : afterClear.filter((entry) => entry.level === deferredFilter);
  const visibleLogs = byLevel.filter((entry) =>
    matchesQuery(entry, deferredQuery),
  );
  const timeFormatter = new Intl.DateTimeFormat(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const togglePause = () => {
    if (paused) {
      setPaused(false);
      setFrozenAt(null);
    } else {
      setFrozenAt(logs);
      setPaused(true);
    }
  };

  const clearView = () => {
    const newest = logs[logs.length - 1]?.sequence ?? clearedThrough;
    setClearedThrough(newest);
    if (paused) {
      setFrozenAt([]);
    }
  };

  const openDirectory = async () => {
    setOpenPending(true);
    try {
      await openLogDirectory();
    } finally {
      setOpenPending(false);
    }
  };

  return (
    <WorkspacePage
      eyebrow={t("logs.eyebrow")}
      title={t("logs.title")}
      badge={
        paused
          ? t("logs.paused")
          : t("logs.badge", { count: visibleLogs.length })
      }
    >
      <section className="workspace-panel logs-panel">
        <div className="workspace-panel-heading">
          <div>
            <span className="workspace-kicker">{t("logs.kicker")}</span>
            <h2>{t("logs.heading")}</h2>
          </div>
          <div className="workspace-panel-actions">
            <button
              className="workspace-action-button"
              type="button"
              disabled={openPending}
              onClick={() => void openDirectory()}
            >
              <FolderOpen aria-hidden="true" size={14} />
              {t("logs.openDirectory")}
            </button>
            <button
              className="workspace-action-button"
              type="button"
              aria-pressed={paused}
              onClick={togglePause}
            >
              {paused ? (
                <Play aria-hidden="true" size={14} />
              ) : (
                <Pause aria-hidden="true" size={14} />
              )}
              {paused ? t("logs.resume") : t("logs.pause")}
            </button>
            <button
              className="workspace-action-button"
              type="button"
              disabled={visibleLogs.length === 0}
              onClick={clearView}
            >
              <Trash2 aria-hidden="true" size={14} />
              {t("logs.clearView")}
            </button>
            <div className="workspace-segmented" aria-label={t("logs.filter")}>
              {(["all", "info", "warn", "error"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={filter === level}
                  onClick={() => setFilter(level)}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>

        {logs.length > 0 ? (
          <label className="filter-search logs-search">
            <Search aria-hidden="true" size={15} />
            <input
              type="search"
              value={query}
              placeholder={t("logs.searchPlaceholder")}
              aria-label={t("logs.searchLabel")}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : null}

        {visibleLogs.length === 0 ? (
          <div className="workspace-empty">
            <ScrollText aria-hidden="true" size={22} />
            <div>
              <h2>{t("logs.emptyTitle")}</h2>
              <p>
                {byLevel.length === 0 && afterClear.length > 0
                  ? t("logs.cleared")
                  : deferredQuery.trim() !== "" && afterClear.length > 0
                    ? t("logs.searchEmpty", { query: deferredQuery.trim() })
                    : t("logs.emptyBody")}
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="workspace-result-count">
              {t("logs.count", { count: visibleLogs.length })}
            </p>
            <ol className="log-list">
              {visibleLogs.map((entry) => (
                <li key={entry.sequence} data-level={entry.level}>
                  <time dateTime={new Date(entry.timestamp_ms).toISOString()}>
                    {timeFormatter.format(entry.timestamp_ms)}
                  </time>
                  <span className="log-level">{entry.level}</span>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </WorkspacePage>
  );
}
