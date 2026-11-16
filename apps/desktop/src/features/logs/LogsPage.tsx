import { ScrollText } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useRuntime } from "../../app/runtime/runtimeContext";
import type { RuntimeLogLevel } from "../../platform/runtime";
import { WorkspacePage } from "../workspace/WorkspaceUi";

type LogFilter = "all" | RuntimeLogLevel;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function LogsPage() {
  const { logs } = useRuntime();
  const [filter, setFilter] = useState<LogFilter>("all");
  const deferredFilter = useDeferredValue(filter);
  const visibleLogs =
    deferredFilter === "all"
      ? logs
      : logs.filter((entry) => entry.level === deferredFilter);

  return (
    <WorkspacePage
      eyebrow="Runtime events"
      title="Logs"
      badge={`${logs.length} retained`}
    >
      <section className="workspace-panel logs-panel">
        <div className="workspace-panel-heading">
          <div>
            <span className="workspace-kicker">Bounded event buffer</span>
            <h2>Runtime logs</h2>
          </div>
          <div className="workspace-segmented" aria-label="Log level filter">
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

        {visibleLogs.length === 0 ? (
          <div className="workspace-empty">
            <ScrollText aria-hidden="true" size={22} />
            <div>
              <h2>No Runtime events</h2>
              <p>Runtime activity will appear here as it is reported.</p>
            </div>
          </div>
        ) : (
          <>
            <p className="workspace-result-count">
              {visibleLogs.length} {visibleLogs.length === 1 ? "event" : "events"}
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
