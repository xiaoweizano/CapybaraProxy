import { Route } from "lucide-react";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import { getRules } from "../../platform/runtime";
import {
  LoadingState,
  RefreshButton,
  ResourceFeedback,
  RuntimeDisconnected,
  WorkspacePage,
} from "../workspace/WorkspaceUi";

const MAX_VISIBLE_RULES = 500;

export function RulesPage() {
  const { snapshot } = useRuntime();
  const isConnected = snapshot?.state === "connected";
  const rules = useBridgeResource(getRules, isConnected);
  const visibleRules = rules.data?.slice(0, MAX_VISIBLE_RULES) ?? [];

  return (
    <WorkspacePage
      eyebrow="Routing"
      title="Rules"
      badge={isConnected ? "Live Mihomo" : "Offline"}
    >
      <ResourceFeedback
        error={rules.error}
        unavailable={rules.unavailable}
      />

      {!isConnected ? (
        <RuntimeDisconnected />
      ) : (
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <div>
              <span className="workspace-kicker">Rule provider</span>
              <h2>Active routing rules</h2>
            </div>
            <div className="workspace-panel-actions">
              <span className="workspace-count">
                {rules.data?.length ?? 0} rules
              </span>
              <RefreshButton
                isLoading={rules.isLoading}
                onClick={() => void rules.reload()}
                label="Refresh rules"
              />
            </div>
          </div>

          {rules.isLoading && rules.data === null ? (
            <LoadingState label="Loading routing rules..." />
          ) : visibleRules.length === 0 ? (
            <div className="workspace-empty">
              <Route aria-hidden="true" size={22} />
              <div>
                <h2>No rules reported</h2>
                <p>Mihomo returned an empty active rule table.</p>
              </div>
            </div>
          ) : (
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Type</th>
                    <th scope="col">Payload</th>
                    <th scope="col">Target</th>
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
