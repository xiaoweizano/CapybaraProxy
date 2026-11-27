import {
  ChevronDown,
  CircleCheck,
  Star,
  CircleDashed,
  Gauge,
  History,
  Radio,
  Search,
  Server,
  Timer,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import {
  getDelayHistory,
  getSubscriptionSnapshot,
  type ProxyNode,
  type RoutingMode,
} from "../../platform/runtime";
import {
  readStoredCollapsed,
  readStoredFavorites,
  readStoredSort,
  writeStoredCollapsed,
  writeStoredFavorites,
  writeStoredSort,
  type NodeSort,
} from "../../shared/proxyView";
import {
  ResourceFeedback,
  RuntimeDisconnected,
  WorkspacePage,
} from "../workspace/WorkspaceUi";

const modeOptions: Array<{
  id: RoutingMode;
  labelKey: string;
  hintKey: string;
}> = [
  { id: "rule", labelKey: "proxies.modeRule", hintKey: "proxies.modeRuleHint" },
  {
    id: "global",
    labelKey: "proxies.modeGlobal",
    hintKey: "proxies.modeGlobalHint",
  },
  {
    id: "direct",
    labelKey: "proxies.modeDirect",
    hintKey: "proxies.modeDirectHint",
  },
];

/** Keeps groups and nodes matching the filter; drops groups left empty. */
function filterGroups<T extends { name: string; nodes: ProxyNode[] }>(
  groups: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return groups;
  }

  return groups
    .map((group) => {
      const groupMatches = group.name.toLowerCase().includes(normalized);
      return {
        ...group,
        nodes: groupMatches
          ? group.nodes
          : group.nodes.filter((node) =>
              node.name.toLowerCase().includes(normalized),
            ),
      };
    })
    .filter((group) => group.nodes.length > 0);
}

/**
 * Orders a group's nodes.
 *
 * `delay` puts the fastest first and unmeasured nodes last, which is what an
 * operator scanning for a usable node wants; the previous order is kept for
 * equal or missing values so the list does not reshuffle on every probe.
 */
function sortNodes(
  nodes: ProxyNode[],
  sort: NodeSort,
  delays: Record<string, number | null>,
  favorites: ReadonlySet<string>,
): ProxyNode[] {
  const ordered = (() => {
    if (sort === "name") {
      return [...nodes].sort((left, right) => left.name.localeCompare(right.name));
    }
    if (sort === "delay") {
      const delayOf = (node: ProxyNode): number =>
        delays[node.name] ?? node.delay_ms ?? Number.POSITIVE_INFINITY;
      return [...nodes].sort((left, right) => delayOf(left) - delayOf(right));
    }
    return nodes;
  })();

  if (favorites.size === 0) {
    return ordered;
  }
  // Favourites float to the top while keeping the chosen order inside each
  // half; filtering is stable, so the relative order is preserved.
  return [
    ...ordered.filter((node) => favorites.has(node.name)),
    ...ordered.filter((node) => !favorites.has(node.name)),
  ];
}

export function ProxiesPage() {
  const { t } = useTranslation();
  const {
    snapshot,
    proxyGroups,
    corePreferences,
    selectProxy,
    measureDelay,
    measureGroupDelay,
    setRoutingMode,
    lastError,
    isLoading,
  } = useRuntime();
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [pendingDelay, setPendingDelay] = useState<string | null>(null);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<RoutingMode | null>(null);
  const [pendingAll, setPendingAll] = useState(false);
  const [query, setQuery] = useState("");
  // Page-local view state: it must survive a page switch and a relaunch, but
  // the core has no use for it, so it stays in localStorage.
  const [sort, setSortState] = useState<NodeSort>(() =>
    readStoredSort(window.localStorage),
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() =>
    readStoredCollapsed(window.localStorage),
  );
  const [favorites, setFavorites] = useState<Set<string>>(() =>
    readStoredFavorites(window.localStorage),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const [testedDelays, setTestedDelays] = useState<Record<string, number | null>>(
    {},
  );
  const isConnected = snapshot?.state === "connected";
  // When the core is stopped the control API is unreachable, so fall back to
  // the stored subscription. This list is read-only and clearly labelled.
  const offline = useBridgeResource(getSubscriptionSnapshot, !isConnected);
  const offlineGroups = offline.data?.has_subscription
    ? offline.data.groups
    : [];
  const activeMode = corePreferences?.mode ?? null;
  const visibleGroups = filterGroups(proxyGroups, deferredQuery);
  const visibleOfflineGroups = filterGroups(offlineGroups, deferredQuery);

  const chooseProxy = async (group: string, node: ProxyNode) => {
    if (pendingSelection || node.name === proxyGroups.find((item) => item.name === group)?.selected) {
      return;
    }

    setPendingSelection(node.name);
    try {
      await selectProxy(group, node.name);
    } finally {
      setPendingSelection(null);
    }
  };

  const testDelay = async (node: ProxyNode) => {
    if (pendingDelay) {
      return;
    }

    setPendingDelay(node.name);
    try {
      const delay = await measureDelay(node.name);
      setTestedDelays((current) => ({ ...current, [node.name]: delay }));
    } finally {
      setPendingDelay(null);
    }
  };

  const testGroup = async (group: string) => {
    if (pendingGroup) {
      return;
    }

    setPendingGroup(group);
    try {
      const delays = await measureGroupDelay(group);
      if (delays) {
        setTestedDelays((current) => ({ ...current, ...delays }));
      }
    } finally {
      setPendingGroup(null);
    }
  };

  const setSort = (next: NodeSort) => {
    setSortState(next);
    writeStoredSort(window.localStorage, next);
  };

  const toggleFavorite = (name: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      writeStoredFavorites(window.localStorage, next);
      return next;
    });
  };

  const toggleGroup = (name: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      writeStoredCollapsed(window.localStorage, next);
      return next;
    });
  };

  const changeMode = async (mode: RoutingMode) => {
    if (pendingMode || mode === activeMode) {
      return;
    }

    setPendingMode(mode);
    try {
      await setRoutingMode(mode);
    } finally {
      setPendingMode(null);
    }
  };

  /** Probes every group in sequence so the core is not flooded at once. */
  const testAllGroups = async () => {
    if (pendingAll || pendingGroup) {
      return;
    }

    setPendingAll(true);
    setNotice(null);
    try {
      let measured = 0;
      for (const group of proxyGroups) {
        if (group.nodes.length === 0) {
          continue;
        }
        const delays = await measureGroupDelay(group.name);
        if (delays) {
          measured += Object.keys(delays).length;
          setTestedDelays((current) => ({ ...current, ...delays }));
        }
      }
      setNotice(t("proxies.testedGroups", { count: measured }));
    } finally {
      setPendingAll(false);
    }
  };

  return (
    <WorkspacePage
      eyebrow={t("proxies.eyebrow")}
      title={t("proxies.title")}
      badge={isConnected ? t("common.liveMihomo") : t("common.offline")}
    >
      <ResourceFeedback error={lastError} unavailable={false} />

      <section className="workspace-panel proxy-mode-panel">
        <div className="workspace-panel-heading">
          <div>
            <span className="workspace-kicker">{t("proxies.mode")}</span>
            <h2>{t("proxies.mode")}</h2>
          </div>
        </div>
        {isConnected ? (
          <div
            className="workspace-option-grid"
            role="group"
            aria-label={t("proxies.mode")}
          >
            {modeOptions.map(({ id, labelKey, hintKey }) => (
              <button
                key={id}
                type="button"
                className="workspace-option"
                aria-pressed={activeMode === id}
                disabled={pendingMode !== null}
                onClick={() => void changeMode(id)}
              >
                <span className="workspace-radio" aria-hidden="true">
                  {activeMode === id ? <span /> : null}
                </span>
                <span>
                  <strong>{t(labelKey)}</strong>
                  <small>{t(hintKey)}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="workspace-hint">{t("proxies.prefsUnavailable")}</p>
        )}
        <p className="workspace-hint">{t("proxies.probeSettingsMoved")}</p>
      </section>

      {(isConnected ? proxyGroups.length : offlineGroups.length) > 0 ? (
        <div className="proxy-toolbar">
          <label className="proxy-search">
            <Search aria-hidden="true" size={15} />
            <input
              type="search"
              value={query}
              placeholder={t("proxies.searchPlaceholder")}
              aria-label={t("proxies.searchLabel")}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="workspace-segmented" aria-label={t("proxies.sortLabel")}>
            {(["default", "delay", "name"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={sort === option}
                onClick={() => setSort(option)}
              >
                {option === "default"
                  ? t("proxies.sortDefault")
                  : option === "delay"
                    ? t("proxies.sortDelay")
                    : t("proxies.sortName")}
              </button>
            ))}
          </div>
          {isConnected && proxyGroups.length > 0 ? (
            <button
              className="workspace-action-button proxy-toolbar-action"
              type="button"
              disabled={pendingAll || pendingGroup !== null}
              onClick={() => void testAllGroups()}
            >
              <Timer aria-hidden="true" size={14} />
              {pendingAll
                ? t("proxies.testingAllGroups")
                : t("proxies.testAllGroups")}
            </button>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p className="workspace-feedback" role="status">
          {notice}
        </p>
      ) : null}

      <LatencyHistoryCard />

      {!isConnected ? (
        offlineGroups.length > 0 ? (
          <div className="proxy-groups">
            <div className="workspace-feedback" role="status">
              <Radio aria-hidden="true" size={16} />
              <span>{t("proxies.offlineNotice")}</span>
            </div>
            {visibleOfflineGroups.map((group) => (
              <section
                className="workspace-panel proxy-group-panel"
                key={group.name}
                aria-labelledby={`offline-group-${group.name}`}
              >
                <div className="workspace-panel-heading">
                  <div>
                    <span className="workspace-kicker">
                      {group.group_type}
                    </span>
                    <h2 id={`offline-group-${group.name}`}>{group.name}</h2>
                  </div>
                  <span className="workspace-count">
                    {t("proxies.nodes", { count: group.nodes.length })}
                  </span>
                </div>

                <div className="proxy-node-list">
                  {(sort === "default"
                    ? group.nodes
                    : sortNodes(group.nodes, sort, {}, favorites)
                  ).map((node) => (
                    <div
                      className="proxy-node"
                      key={`${group.name}-${node.name}`}
                    >
                      <span className="proxy-node-state" aria-hidden="true">
                        <CircleDashed size={15} />
                      </span>
                      <span className="proxy-node-details">
                        <strong>{node.name}</strong>
                        <small>{node.proxy_type || "—"}</small>
                      </span>
                      <span className="proxy-delay" data-quality="unknown">
                        {t("proxies.offlineTag")}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <RuntimeDisconnected />
        )
      ) : isLoading && proxyGroups.length === 0 ? (
        <div className="workspace-loading" role="status">
          <CircleDashed aria-hidden="true" size={17} />
          <span>{t("proxies.loading")}</span>
        </div>
      ) : proxyGroups.length === 0 ? (
        <div className="workspace-empty">
          <Server aria-hidden="true" size={22} />
          <div>
            <h2>{t("proxies.emptyTitle")}</h2>
            <p>{t("proxies.emptyBody")}</p>
          </div>
        </div>
      ) : visibleGroups.length === 0 ? (
        <p className="workspace-hint" role="status">
          {t("proxies.searchEmpty", { query: deferredQuery.trim() })}
        </p>
      ) : (
        <div className="proxy-groups">
          {visibleGroups.map((group) => (
            <section
              className="workspace-panel proxy-group-panel"
              key={group.name}
              aria-labelledby={`group-${group.name}`}
            >
              <div className="workspace-panel-heading">
                <div>
                  <span className="workspace-kicker">{group.group_type}</span>
                  <h2 id={`group-${group.name}`}>{group.name}</h2>
                </div>
                <div className="workspace-panel-actions">
                  <span className="workspace-count">
                    {t("proxies.nodes", { count: group.nodes.length })}
                  </span>
                  <button
                    className="workspace-action-button proxy-group-test"
                    type="button"
                    aria-label={t("proxies.testGroupDelay", { name: group.name })}
                    disabled={pendingGroup !== null}
                    onClick={() => void testGroup(group.name)}
                  >
                    <Timer aria-hidden="true" size={14} />
                    {pendingGroup === group.name
                      ? t("proxies.testingGroup")
                      : t("proxies.testGroupDelay", { name: group.name })}
                  </button>
                  <button
                    className="workspace-icon-button proxy-group-toggle"
                    type="button"
                    aria-expanded={!collapsedGroups.has(group.name)}
                    aria-controls={`group-nodes-${group.name}`}
                    aria-label={
                      collapsedGroups.has(group.name)
                        ? t("proxies.expandGroup", { name: group.name })
                        : t("proxies.collapseGroup", { name: group.name })
                    }
                    title={
                      collapsedGroups.has(group.name)
                        ? t("proxies.expandGroup", { name: group.name })
                        : t("proxies.collapseGroup", { name: group.name })
                    }
                    onClick={() => toggleGroup(group.name)}
                  >
                    <ChevronDown
                      className={
                        collapsedGroups.has(group.name)
                          ? "proxy-group-toggle-icon is-collapsed"
                          : "proxy-group-toggle-icon"
                      }
                      aria-hidden="true"
                      size={15}
                    />
                  </button>
                </div>
              </div>

              <div
                className="proxy-node-list"
                id={`group-nodes-${group.name}`}
                hidden={collapsedGroups.has(group.name)}
              >
                {sortNodes(group.nodes, sort, testedDelays, favorites).map((node) => {
                  const selected = node.name === group.selected;
                  const delay = testedDelays[node.name] ?? node.delay_ms;

                  return (
                    <div
                      className={`proxy-node${selected ? " is-selected" : ""}`}
                      key={node.name}
                    >
                      <span className="proxy-node-state" aria-hidden="true">
                        {selected ? (
                          <CircleCheck size={16} />
                        ) : (
                          <Radio size={15} />
                        )}
                      </span>
                      <span className="proxy-node-details">
                        <strong>
                          {favorites.has(node.name) ? (
                            <Star
                              className="proxy-node-favorite-mark"
                              aria-hidden="true"
                              size={12}
                            />
                          ) : null}
                          {node.name}
                        </strong>
                        <small>
                          {node.proxy_type} / UDP {node.udp ? "on" : "off"}
                        </small>
                      </span>
                      <span
                        className="proxy-delay"
                        data-quality={
                          delay === null
                            ? "unknown"
                            : delay < 100
                              ? "good"
                              : delay < 200
                                ? "medium"
                                : "poor"
                        }
                      >
                        {delay === null ? t("proxies.notTested") : `${delay} ms`}
                      </span>
                      <button
                        className={
                          favorites.has(node.name)
                            ? "workspace-icon-button proxy-favorite is-favorite"
                            : "workspace-icon-button proxy-favorite"
                        }
                        type="button"
                        aria-pressed={favorites.has(node.name)}
                        aria-label={
                          favorites.has(node.name)
                            ? t("proxies.unfavorite", { name: node.name })
                            : t("proxies.favorite", { name: node.name })
                        }
                        title={
                          favorites.has(node.name)
                            ? t("proxies.unfavorite", { name: node.name })
                            : t("proxies.favorite", { name: node.name })
                        }
                        onClick={() => toggleFavorite(node.name)}
                      >
                        <Star
                          aria-hidden="true"
                          size={15}
                          fill={favorites.has(node.name) ? "currentColor" : "none"}
                        />
                      </button>
                      <button
                        className="workspace-icon-button"
                        type="button"
                        aria-label={t("proxies.testDelay", { name: node.name })}
                        title={t("proxies.testDelay", { name: node.name })}
                        disabled={pendingDelay !== null || pendingGroup !== null}
                        onClick={() => void testDelay(node)}
                      >
                        <Gauge aria-hidden="true" size={15} />
                      </button>
                      <button
                        className="workspace-action-button"
                        type="button"
                        aria-label={t("proxies.selectNode", { name: node.name })}
                        disabled={pendingSelection !== null || selected}
                        onClick={() => void chooseProxy(group.name, node)}
                      >
                        {selected
                          ? t("proxies.selected")
                          : pendingSelection === node.name
                            ? t("proxies.selecting")
                            : t("proxies.select")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </WorkspacePage>
  );
}

/**
 * The measurements the app recorded while the page was open.
 *
 * Kept in the native side so it survives a re-render and a page switch; the
 * core itself has no latency history. Newest first, bounded at the write site.
 */
function LatencyHistoryCard() {
  const { t } = useTranslation();
  const history = useBridgeResource(getDelayHistory, true);
  const entries = [...(history.data?.entries ?? [])].reverse().slice(0, 40);
  const now = history.data?.now_ms ?? 0;

  const when = (timestamp: number): string => {
    if (now <= 0 || timestamp <= 0) {
      return "—";
    }
    const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
    if (minutes < 1) {
      return t("proxies.historyJustNow");
    }
    if (minutes < 120) {
      return t("proxies.historyMinutesAgo", { count: minutes });
    }
    return t("proxies.historyHoursAgo", { count: Math.floor(minutes / 60) });
  };

  return (
    <section className="workspace-panel latency-history-panel">
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t("proxies.historyKicker")}</span>
          <h2>{t("proxies.historyHeading")}</h2>
        </div>
        <div className="workspace-panel-actions">
          <span className="workspace-count">
            {entries.length}
          </span>
          <button
            className="workspace-icon-button"
            type="button"
            aria-label={t("proxies.historyClearLocal")}
            title={t("proxies.historyClearLocal")}
            disabled={history.isLoading}
            onClick={() => void history.reload()}
          >
            <History aria-hidden="true" size={15} />
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="workspace-hint">{t("proxies.historyEmpty")}</p>
      ) : (
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th scope="col">{t("proxies.historyNode")}</th>
                <th scope="col">{t("proxies.historyDelay")}</th>
                <th scope="col">{t("proxies.historyWhen")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.proxy}-${entry.timestamp_ms}`}>
                  <td>{entry.proxy}</td>
                  <td>
                    <span
                      className="proxy-delay"
                      data-quality={
                        entry.delay_ms < 100
                          ? "good"
                          : entry.delay_ms < 200
                            ? "medium"
                            : "poor"
                      }
                    >
                      {entry.delay_ms} ms
                    </span>
                  </td>
                  <td>{when(entry.timestamp_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
