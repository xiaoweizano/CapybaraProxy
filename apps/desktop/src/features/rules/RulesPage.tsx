import { FlaskConical, Route, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import {
  getConnections,
  getProviders,
  getRules,
  getSubscriptionSnapshot,
  type RuleItem,
} from "../../platform/runtime";
import {
  LoadingState,
  RefreshButton,
  ResourceFeedback,
  RuntimeDisconnected,
  WorkspacePage,
} from "../workspace/WorkspaceUi";
import { matchRules, type RuleVerdict } from "./ruleMatcher";

const MAX_VISIBLE_RULES = 500;

/**
 * Counts live connections per rule target.
 *
 * Mihomo reports a connection's matched rule type and payload, while the rule
 * table lists type + payload + target. Keying on type plus payload joins the
 * two without assuming the target strings are unique.
 */
function countConnectionsByRule(
  connections: { rule: string; rule_payload: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const connection of connections) {
    const key = ruleKey({
      rule_type: connection.rule,
      payload: connection.rule_payload,
    });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function ruleKey(rule: Pick<RuleItem, "rule_type" | "payload">): string {
  // A NUL cannot appear in a rule type or payload, so it is a safe separator.
  return `${rule.rule_type}\u0000${rule.payload}`;
}

/** Keeps rules whose type, payload or target contains `query`. */
function filterRules(rules: RuleItem[], query: string): RuleItem[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return rules;
  }

  return rules.filter(
    (rule) =>
      rule.rule_type.toLowerCase().includes(normalized) ||
      rule.payload.toLowerCase().includes(normalized) ||
      rule.proxy.toLowerCase().includes(normalized),
  );
}

export function RulesPage() {
  const { t } = useTranslation();
  const { snapshot } = useRuntime();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isConnected = snapshot?.state === "connected";
  const rules = useBridgeResource(getRules, isConnected);
  // Hits per rule come from the live connection table; a stopped core has none.
  const connections = useBridgeResource(getConnections, isConnected);
  const hits = countConnectionsByRule(connections.data?.connections ?? []);
  // Offline fallback: the stored subscription's rule table.
  const offline = useBridgeResource(getSubscriptionSnapshot, !isConnected);
  const offlineRules = offline.data?.has_subscription
    ? offline.data.rules
    : [];
  const visibleRules = filterRules(rules.data ?? [], deferredQuery).slice(
    0,
    MAX_VISIBLE_RULES,
  );
  const visibleOfflineRules = filterRules(
    offlineRules,
    deferredQuery,
  ).slice(0, MAX_VISIBLE_RULES);
  const filtering = deferredQuery.trim() !== "";
  const totalRules = isConnected
    ? (rules.data?.length ?? 0)
    : offlineRules.length;

  const searchField = totalRules > 0 ? (
    <label className="filter-search rules-search">
      <Search aria-hidden="true" size={15} />
      <input
        type="search"
        value={query}
        placeholder={t("rules.searchPlaceholder")}
        aria-label={t("rules.searchLabel")}
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  ) : null;

  return (
    <WorkspacePage
      eyebrow={t("rules.eyebrow")}
      title={t("rules.title")}
      badge={isConnected ? t("common.liveMihomo") : t("common.offline")}
    >
      <ResourceFeedback
        error={rules.error}
        unavailable={rules.unavailable}
      />

      {searchField}

      <RuleTester connected={isConnected} />

      {!isConnected ? (
        offlineRules.length > 0 ? (
          <section className="workspace-panel">
            <div className="workspace-feedback" role="status">
              <Route aria-hidden="true" size={16} />
              <span>{t("rules.offlineNotice")}</span>
            </div>
            <div className="workspace-panel-heading">
              <div>
                <span className="workspace-kicker">{t("rules.kicker")}</span>
                <h2>{t("rules.heading")}</h2>
              </div>
              <span className="workspace-count">
                {t("rules.count", { count: offlineRules.length })}
              </span>
            </div>
            {visibleOfflineRules.length === 0 ? (
              <p className="workspace-hint" role="status">
                {t("rules.searchEmpty", { query: deferredQuery.trim() })}
              </p>
            ) : (
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t("rules.type")}</th>
                    <th scope="col">{t("rules.payload")}</th>
                    <th scope="col">{t("rules.target")}</th>
                    <th scope="col">{t("rules.hits")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOfflineRules.map((rule) => (
                    <tr key={`offline-${rule.index}-${rule.rule_type}`}>
                      <td>{rule.index + 1}</td>
                      <td>
                        <span className="workspace-code">{rule.rule_type}</span>
                      </td>
                      <td>{rule.payload}</td>
                      <td>
                        <span className="workspace-code">{rule.proxy}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </section>
        ) : (
          <RuntimeDisconnected />
        )
      ) : (
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <div>
              <span className="workspace-kicker">{t("rules.kicker")}</span>
              <h2>{t("rules.heading")}</h2>
            </div>
            <div className="workspace-panel-actions">
              <span className="workspace-count">
                {t("rules.count", { count: rules.data?.length ?? 0 })}
              </span>
              <RefreshButton
                isLoading={rules.isLoading}
                onClick={() => void rules.reload()}
                label={t("rules.refresh")}
              />
            </div>
          </div>

          {rules.isLoading && rules.data === null ? (
            <LoadingState label={t("rules.loading")} />
          ) : (rules.data?.length ?? 0) === 0 ? (
            <div className="workspace-empty">
              <Route aria-hidden="true" size={22} />
              <div>
                <h2>{t("rules.emptyTitle")}</h2>
                <p>{t("rules.emptyBody")}</p>
              </div>
            </div>
          ) : visibleRules.length === 0 ? (
            <p className="workspace-hint" role="status">
              {t("rules.searchEmpty", { query: deferredQuery.trim() })}
            </p>
          ) : (
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t("rules.type")}</th>
                    <th scope="col">{t("rules.payload")}</th>
                    <th scope="col">{t("rules.target")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRules.map((rule) => (
                    <tr key={`${rule.index}-${rule.rule_type}-${rule.payload}`}>
                      <td>{rule.index + 1}</td>
                      <td>
                        <span className="workspace-code">{rule.rule_type}</span>
                      </td>
                      <td>{rule.payload}</td>
                      <td>{rule.proxy}</td>
                      <td className="rules-hits">
                        {hits.get(ruleKey(rule)) ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtering ? null : rules.data &&
                rules.data.length > MAX_VISIBLE_RULES ? (
                <p className="workspace-table-note">
                  Showing the first {MAX_VISIBLE_RULES} rules.
                </p>
              ) : null}
            </div>
          )}
        </section>
      )}

      <ProvidersPanel connected={isConnected} />
    </WorkspacePage>
  );
}

/**
 * Rule and proxy providers the active profile pulls in.
 *
 * Read-only by design: the provider's URL and refresh timer belong to the
 * profile author, and Mihomo fetches them on its own network stack. Showing
 * them here answers "where did these nodes and rules come from" without
 * pretending FlowProxy manages the fetch.
 */
function ProvidersPanel({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const providers = useBridgeResource(getProviders, connected);
  const list = providers.data ?? [];

  if (!connected || list.length === 0) {
    return null;
  }

  return (
    <section className="workspace-panel providers-panel">
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t("rules.providersKicker")}</span>
          <h2>{t("rules.providersHeading")}</h2>
        </div>
        <div className="workspace-panel-actions">
          <span className="workspace-count">
            {t("rules.providersCount", { count: list.length })}
          </span>
          <RefreshButton
            isLoading={providers.isLoading}
            onClick={() => void providers.reload()}
            label={t("rules.refresh")}
          />
        </div>
      </div>
      <p className="workspace-hint">{t("rules.providersHint")}</p>
      <div className="workspace-table-wrap">
        <table className="workspace-table">
          <thead>
            <tr>
              <th scope="col">{t("rules.providerName")}</th>
              <th scope="col">{t("rules.providerKind")}</th>
              <th scope="col">{t("rules.providerVehicle")}</th>
              <th scope="col">{t("rules.providerEntries")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((provider) => (
              <tr key={`${provider.kind}-${provider.name}`}>
                <td>{provider.name}</td>
                <td>
                  <span className="workspace-code">
                    {provider.kind === "proxy"
                      ? t("rules.providerKindProxy")
                      : t("rules.providerKindRule")}
                  </span>
                </td>
                <td>{provider.vehicle_type ?? "—"}</td>
                <td>
                  {provider.proxy_count ?? provider.entry_count ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Answers "which rule decides this domain" without touching the core.
 *
 * The verdict is a lower bound: rules that need the resolved address, a
 * rule-set body or the OS process cannot be evaluated here, and the panel
 * says how many of those were skipped before the match.
 */
function RuleTester({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const rules = useBridgeResource(getRules, connected);
  const [target, setTarget] = useState("");
  const [verdict, setVerdict] = useState<RuleVerdict | null>(null);

  if (!connected || (rules.data?.length ?? 0) === 0) {
    return null;
  }

  const evaluate = () => {
    setVerdict(matchRules(rules.data ?? [], target));
  };

  return (
    <section className="workspace-panel rule-tester-panel">
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t("rules.testerKicker")}</span>
          <h2>{t("rules.testerHeading")}</h2>
        </div>
        <span className="workspace-icon-button" aria-hidden="true">
          <FlaskConical size={15} />
        </span>
      </div>
      <form
        className="rule-tester-form"
        onSubmit={(event) => {
          event.preventDefault();
          evaluate();
        }}
      >
        <label className="proxy-search">
          <Search aria-hidden="true" size={15} />
          <input
            type="text"
            value={target}
            placeholder={t("rules.testerPlaceholder")}
            aria-label={t("rules.testerPlaceholder")}
            spellCheck={false}
            onChange={(event) => {
              setTarget(event.target.value);
              setVerdict(null);
            }}
          />
        </label>
        <button
          className="workspace-primary-button"
          type="submit"
          disabled={target.trim() === ""}
        >
          {t("rules.testerRun")}
        </button>
      </form>
      {verdict ? (
        verdict.matched ? (
          <div className="rule-tester-result" role="status">
            <p>
              {t("rules.testerMatched", {
                type: verdict.matched.rule_type,
                target: verdict.matched.proxy,
              })}
            </p>
            <p className="workspace-code">
              {verdict.matched.rule_type}
              {verdict.matched.payload ? `,${verdict.matched.payload}` : ""}
              {`,${verdict.matched.proxy}`}
            </p>
            {verdict.skipped.length > 0 ? (
              <p className="settings-inline-hint">
                {t("rules.testerSkipped", { count: verdict.skipped.length })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="settings-inline-hint" role="status">
            {t("rules.testerNoMatch")}
          </p>
        )
      ) : (
        <p className="settings-inline-hint">{t("rules.testerHint")}</p>
      )}
    </section>
  );
}