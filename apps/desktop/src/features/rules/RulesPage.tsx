import { Route } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import { getRules, getSubscriptionSnapshot } from "../../platform/runtime";
import {
  LoadingState,
  RefreshButton,
  ResourceFeedback,
  RuntimeDisconnected,
  WorkspacePage,
} from "../workspace/WorkspaceUi";

const MAX_VISIBLE_RULES = 500;

export function RulesPage() {
  const { t } = useTranslation();
  const { snapshot } = useRuntime();
  const isConnected = snapshot?.state === "connected";
  const rules = useBridgeResource(getRules, isConnected);
  // Offline fallback: the stored subscription's rule table.
  const offline = useBridgeResource(getSubscriptionSnapshot, !isConnected);
  const offlineRules = offline.data?.has_subscription
    ? offline.data.rules
    : [];
  const visibleRules = rules.data?.slice(0, MAX_VISIBLE_RULES) ?? [];

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
                  {offlineRules.slice(0, MAX_VISIBLE_RULES).map((rule) => (
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
          ) : visibleRules.length === 0 ? (
            <div className="workspace-empty">
              <Route aria-hidden="true" size={22} />
              <div>
                <h2>{t("rules.emptyTitle")}</h2>
                <p>{t("rules.emptyBody")}</p>
              </div>
            </div>
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
                    </tr>
                  ))}
                </tbody>
              </table>
              {rules.data && rules.data.length > MAX_VISIBLE_RULES ? (
                <p className="workspace-table-note">
                  Showing the first {MAX_VISIBLE_RULES} rules.
                </p>
              ) : null}
            </div>
          )}
        </section>
      )}
    </WorkspacePage>
  );
}
