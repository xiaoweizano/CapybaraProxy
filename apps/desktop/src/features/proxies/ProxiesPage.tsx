import {
  CircleCheck,
  CircleDashed,
  Gauge,
  Radio,
  Server,
  Timer,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import {
  getSubscriptionSnapshot,
  type ProxyNode,
  type RoutingMode,
} from "../../platform/runtime";
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

      {!isConnected ? (
        offlineGroups.length > 0 ? (
          <div className="proxy-groups">
            <div className="workspace-feedback" role="status">
              <Radio aria-hidden="true" size={16} />
              <span>{t("proxies.offlineNotice")}</span>
            </div>
            {offlineGroups.map((group) => (
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
                  {group.nodes.map((node) => (
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
      ) : (
        <div className="proxy-groups">
          {proxyGroups.map((group) => (
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
                </div>
              </div>

              <div className="proxy-node-list">
                {group.nodes.map((node) => {
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
                        <strong>{node.name}</strong>
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
