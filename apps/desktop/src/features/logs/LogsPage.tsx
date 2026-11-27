import { FolderOpen, ScrollText } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { openLogDirectory } from "../../platform/runtime";
import type { RuntimeLogLevel } from "../../platform/runtime";
import { WorkspacePage } from "../workspace/WorkspaceUi";

type LogFilter = "all" | RuntimeLogLevel;

export function LogsPage() {
  const { t, i18n } = useTranslation();
  const { logs } = useRuntime();
  const [filter, setFilter] = useState<LogFilter>("all");
  const [openPending, setOpenPending] = useState(false);
  const deferredFilter = useDeferredValue(filter);
  const visibleLogs =
    deferredFilter === "all"
      ? logs
      : logs.filter((entry) => entry.level === deferredFilter);
  const timeFormatter = new Intl.DateTimeFormat(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

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
      badge={t("logs.badge", { count: logs.length })}
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

        {visibleLogs.length === 0 ? (
          <div className="workspace-empty">
            <ScrollText aria-hidden="true" size={22} />
            <div>
              <h2>{t("logs.emptyTitle")}</h2>
              <p>{t("logs.emptyBody")}</p>
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
