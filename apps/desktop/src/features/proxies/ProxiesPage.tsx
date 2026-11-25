import {
  CircleCheck,
  CircleDashed,
  Gauge,
  Radio,
  Server,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import type { ProxyNode } from "../../platform/runtime";
import {
  ResourceFeedback,
  RuntimeDisconnected,
  WorkspacePage,
} from "../workspace/WorkspaceUi";

export function ProxiesPage() {
  const { t } = useTranslation();
  const {
    snapshot,
    proxyGroups,
    selectProxy,
    measureDelay,
    lastError,
    isLoading,
  } = useRuntime();
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [pendingDelay, setPendingDelay] = useState<string | null>(null);
  const [testedDelays, setTestedDelays] = useState<Record<string, number | null>>(
    {},
  );
  const isConnected = snapshot?.state === "connected";

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

  return (
    <WorkspacePage
      eyebrow={t("proxies.eyebrow")}
      title={t("proxies.title")}
      badge={isConnected ? t("common.liveMihomo") : t("common.offline")}
    >
      <ResourceFeedback error={lastError} unavailable={false} />

      {!isConnected ? (
        <RuntimeDisconnected />
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
                <span className="workspace-count">
                  {t("proxies.nodes", { count: group.nodes.length })}
                </span>
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
                        disabled={pendingDelay !== null}
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
