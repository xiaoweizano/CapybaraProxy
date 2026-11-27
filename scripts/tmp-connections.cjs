const fs = require("fs");
const p = "apps/desktop/src/features/connections/ConnectionsPage.tsx";
let s = fs.readFileSync(p, "utf8");

function replace(a, b, label) {
  if (!s.includes(a)) throw new Error("missing " + label);
  s = s.replace(a, b);
}

replace(
`import {
  ArrowDown,
  ArrowUp,
  Cable,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Search,
  XCircle,
} from "lucide-react";`,
`import {
  ArrowDown,
  ArrowUp,
  Cable,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Search,
  XCircle,
} from "lucide-react";`,
  "icons");

replace(
`  const [pendingCloseAll, setPendingCloseAll] = useState(false);
  const deferredQuery = useDeferredValue(query);`,
`  const [pendingCloseAll, setPendingCloseAll] = useState(false);
  // Which row is expanded to show the full details. One at a time keeps the
  // list height predictable.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);`,
  "state");

// Replace the whole row body with an expandable row.
replace(
`                {pagedConnections.map((connection) => (
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
                ))}`,
`                {pagedConnections.map((connection) => {
                  const expanded = expandedId === connection.id;
                  const name =
                    connection.host || connection.destination_ip;
                  return (
                    <article
                      className={\`connection-row\${expanded ? " is-expanded" : ""}\`}
                      key={connection.id}
                    >
                      <button
                        className="connection-row-summary"
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={\`connection-details-\${connection.id}\`}
                        onClick={() =>
                          setExpandedId(expanded ? null : connection.id)
                        }
                      >
                        <span className="connection-icon" aria-hidden="true">
                          <Cable size={16} />
                        </span>
                        <span className="connection-main">
                          <strong>{name}</strong>
                          <small>
                            {connection.destination_ip}:
                            {connection.destination_port}
                          </small>
                        </span>
                        <span className="connection-route">
                          <strong>{connection.rule}</strong>
                          <small>{connection.chains.join(" / ")}</small>
                        </span>
                        <span className="connection-volume">
                          <strong>
                            {formatBytes(connection.download_bytes)}
                          </strong>
                          <small>{connection.network.toUpperCase()}</small>
                        </span>
                        <ChevronDown
                          className="connection-disclosure"
                          aria-hidden="true"
                          size={15}
                        />
                      </button>
                      <button
                        className="workspace-icon-button workspace-danger-button"
                        type="button"
                        aria-label={t("connections.close", { name })}
                        title={t("connections.close", { name })}
                        disabled={pendingConnection !== null}
                        onClick={() => void close(connection.id)}
                      >
                        <CircleX aria-hidden="true" size={16} />
                      </button>
                      {expanded ? (
                        <dl
                          className="connection-details"
                          id={\`connection-details-\${connection.id}\`}
                        >
                          <div>
                            <dt>{t("connections.detailHost")}</dt>
                            <dd>{name}</dd>
                          </div>
                          <div>
                            <dt>{t("connections.detailDestination")}</dt>
                            <dd>
                              {connection.destination_ip}:
                              {connection.destination_port}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("connections.detailRule")}</dt>
                            <dd>
                              {connection.rule}
                              {connection.rule_payload
                                ? \` · \${connection.rule_payload}\`
                                : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("connections.detailChains")}</dt>
                            <dd>{connection.chains.join(" → ")}</dd>
                          </div>
                          <div>
                            <dt>{t("connections.uploaded", { value: "" }).trim()}</dt>
                            <dd>{formatBytes(connection.upload_bytes)}</dd>
                          </div>
                          <div>
                            <dt>{t("connections.detailStarted")}</dt>
                            <dd>{startedFormatter.format(connection.started_at_ms)}</dd>
                          </div>
                        </dl>
                      ) : null}
                    </article>
                  );
                })}`,
  "rows");

replace(
`  const timeFormatter = new Intl.DateTimeFormat(i18n.language, {`,
`  const startedFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "medium",
  });
  const timeFormatter = new Intl.DateTimeFormat(i18n.language, {`,
  "formatter");

fs.writeFileSync(p, s);
console.log("ok");
