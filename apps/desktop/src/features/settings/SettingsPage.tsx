import {
  Check,
  RadioTower,
  ShieldCheck,
  SunMedium,
  Waves,
} from "lucide-react";
import { useAppSettings } from "../../app/settings/settingsContext";
import { useSystemIntegration } from "../../app/systemIntegration/systemIntegrationContext";
import type { CloseBehavior } from "../../shared/closeBehavior";
import { MihomoCorePanel } from "../runtime/MihomoCorePanel";

const themeOptions = [
  {
    id: "cyber_flow" as const,
    name: "Cyber Flow",
    caption: "Midnight network",
    icon: Waves,
  },
  {
    id: "warm_flow" as const,
    name: "Warm Flow",
    caption: "Soft daylight",
    icon: SunMedium,
  },
];

const closeOptions: Array<{
  id: CloseBehavior;
  label: string;
  caption: string;
}> = [
  {
    id: "hide_to_tray",
    label: "Hide to tray",
    caption: "Keep FlowProxy running",
  },
  {
    id: "exit_application",
    label: "Exit application",
    caption: "Stop the desktop process",
  },
];

export function SettingsPage() {
  const {
    settings,
    mode,
    isSaving,
    error,
    updateTheme,
    updateCloseBehavior,
  } = useAppSettings();
  const integration = useSystemIntegration();
  const { theme, closeBehavior } = settings;
  const controlsDisabled = mode === "loading" || isSaving;
  const systemProxyCapability =
    integration.status?.capabilities.system_proxy;
  const launchAtLoginCapability =
    integration.status?.capabilities.launch_at_login;
  const tunCapability = integration.status?.capabilities.tun;
  const systemProxyEnabled =
    integration.status?.system_proxy.state === "enabled";
  const launchAtLoginEnabled =
    integration.status?.launch_at_login.enabled === true;
  const integrationPending = integration.pendingAction !== null;
  const systemProxyDisabled =
    systemProxyCapability?.state !== "available" || integrationPending;
  const launchAtLoginDisabled =
    launchAtLoginCapability?.state !== "available" || integrationPending;
  const integrationError =
    integration.error?.message ?? integration.status?.last_error?.message;
  const storageLabel =
    mode === "native"
      ? "Desktop settings"
      : mode === "preview"
        ? "Local preview"
        : "Loading settings";

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Client preferences</span>
          <h1 id="settings-title">Settings</h1>
        </div>
        <span className="mock-badge">{storageLabel}</span>
      </div>

      {error ? (
        <p className="settings-feedback settings-error-wide" role="alert">
          {error}
        </p>
      ) : null}

      {integrationError ? (
        <p className="settings-feedback settings-error-wide" role="alert">
          {integrationError}
        </p>
      ) : integration.notice ? (
        <p className="settings-feedback settings-error-wide">
          {integration.notice}
        </p>
      ) : null}

      <div className="settings-grid">
        <section className="settings-panel settings-panel-wide">
          <div className="settings-panel-heading">
            <div>
              <span className="settings-label">Appearance</span>
              <h2>Theme</h2>
            </div>
            <span className="settings-index">01</span>
          </div>

          <div className="theme-options">
            {themeOptions.map(({ id, name, caption, icon: Icon }) => (
              <button
                key={id}
                className={`theme-option theme-option-${id}`}
                type="button"
                aria-pressed={theme === id}
                disabled={controlsDisabled}
                onClick={() => void updateTheme(id)}
              >
                <span className="theme-option-preview" aria-hidden="true">
                  <span className="theme-preview-sidebar" />
                  <span className="theme-preview-content">
                    <span className="theme-preview-hero" />
                    <span className="theme-preview-row" />
                  </span>
                </span>
                <span className="theme-option-copy">
                  <span className="theme-option-icon">
                    <Icon aria-hidden="true" size={16} />
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>{caption}</small>
                  </span>
                </span>
                <span className="theme-option-check" aria-hidden="true">
                  {theme === id ? <Check size={13} strokeWidth={2.4} /> : null}
                </span>
              </button>
            ))}
          </div>
        </section>

        <MihomoCorePanel />

        <section className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="settings-label">Window</span>
              <h2>Close button</h2>
            </div>
            <span className="settings-index">03</span>
          </div>

          <div className="behavior-options">
            {closeOptions.map(({ id, label, caption }) => (
              <button
                key={id}
                className="behavior-option"
                type="button"
                aria-pressed={closeBehavior === id}
                disabled={controlsDisabled}
                onClick={() => void updateCloseBehavior(id)}
              >
                <span className="behavior-radio" aria-hidden="true">
                  {closeBehavior === id ? <span /> : null}
                </span>
                <span>
                  <strong>{label}</strong>
                  <small>{caption}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="settings-label">Network</span>
              <h2>Integration</h2>
            </div>
            <span className="settings-index">04</span>
          </div>

          <div className="integration-list">
            <div className="integration-row">
              <span className="integration-icon">
                <RadioTower aria-hidden="true" size={16} />
              </span>
              <span className="integration-copy">
                <strong>System proxy</strong>
                <small>
                  {systemProxyCapability?.message ??
                    (integration.isLoading
                      ? "Checking desktop capability"
                      : "Desktop integration unavailable")}
                </small>
              </span>
              <button
                className="integration-switch"
                type="button"
                role="switch"
                aria-label="System proxy"
                aria-checked={systemProxyEnabled}
                disabled={systemProxyDisabled}
                onClick={() =>
                  void integration.setSystemProxyEnabled(!systemProxyEnabled)
                }
              >
                <span aria-hidden="true" />
              </button>
            </div>
            <div className="integration-row">
              <span className="integration-icon">
                <RadioTower aria-hidden="true" size={16} />
              </span>
              <span className="integration-copy">
                <strong>Launch at login</strong>
                <small>
                  {launchAtLoginCapability?.message ??
                    (integration.isLoading
                      ? "Checking desktop capability"
                      : "Desktop integration unavailable")}
                </small>
              </span>
              <button
                className="integration-switch"
                type="button"
                role="switch"
                aria-label="Launch at login"
                aria-checked={launchAtLoginEnabled}
                disabled={launchAtLoginDisabled}
                onClick={() =>
                  void integration.setLaunchAtLoginEnabled(
                    !launchAtLoginEnabled,
                  )
                }
              >
                <span aria-hidden="true" />
              </button>
            </div>
            <div className="integration-row">
              <span className="integration-icon">
                <ShieldCheck aria-hidden="true" size={16} />
              </span>
              <span className="integration-copy">
                <strong>TUN interface</strong>
                <small>Detection only</small>
                <span className="integration-detail">
                  {tunCapability?.message ??
                    (integration.isLoading
                      ? "Checking elevation and driver availability"
                      : "TUN activation is not enabled in this phase")}
                </span>
              </span>
              <span
                className="integration-status"
                data-state={tunCapability?.state ?? "unverified"}
              >
                {tunCapability?.state === "available"
                  ? "Ready"
                  : tunCapability?.state === "blocked"
                    ? "Blocked"
                    : tunCapability?.state === "unsupported"
                      ? "Unsupported"
                      : "Unverified"}
              </span>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
