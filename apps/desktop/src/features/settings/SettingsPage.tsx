import {
  Check,
  Languages,
  RadioTower,
  ShieldCheck,
  SunMedium,
  Waves,
  ZoomIn,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../../app/settings/settingsContext";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useSystemIntegration } from "../../app/systemIntegration/systemIntegrationContext";
import type { CloseBehavior } from "../../shared/closeBehavior";
import { UI_SCALE_STEPS } from "../../shared/uiScale";
import type { LanguageId } from "../../i18n/language";
import type { CoreLogLevel } from "../../platform/runtime";
import { MihomoCorePanel } from "../runtime/MihomoCorePanel";

const themeOptions = [
  {
    id: "cyber_flow" as const,
    nameKey: "settings.cyberFlow",
    captionKey: "settings.cyberFlowCaption",
    icon: Waves,
  },
  {
    id: "warm_flow" as const,
    nameKey: "settings.warmFlow",
    captionKey: "settings.warmFlowCaption",
    icon: SunMedium,
  },
];

const languageOptions: Array<{
  id: LanguageId;
  nameKey: string;
  captionKey: string;
}> = [
  {
    id: "english",
    nameKey: "settings.languageEnglish",
    captionKey: "settings.languageEnglishCaption",
  },
  {
    id: "simplified_chinese",
    nameKey: "settings.languageChinese",
    captionKey: "settings.languageChineseCaption",
  },
];

const closeOptions: Array<{
  id: CloseBehavior;
  labelKey: string;
  captionKey: string;
}> = [
  {
    id: "hide_to_tray",
    labelKey: "settings.hideToTray",
    captionKey: "settings.hideToTrayCaption",
  },
  {
    id: "exit_application",
    labelKey: "settings.exitApplication",
    captionKey: "settings.exitApplicationCaption",
  },
];

const logLevelOptions: Array<{ id: CoreLogLevel; labelKey: string }> = [
  { id: "error", labelKey: "settings.logError" },
  { id: "warning", labelKey: "settings.logWarning" },
  { id: "info", labelKey: "settings.logInfo" },
  { id: "debug", labelKey: "settings.logDebug" },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const {
    settings,
    mode,
    isSaving,
    error,
    updateTheme,
    updateCloseBehavior,
    updateLanguage,
    updateUiScale,
    updateCoreLogLevel,
    updateIpv6,
  } = useAppSettings();
  const runtime = useRuntime();
  const integration = useSystemIntegration();
  const { theme, closeBehavior, language, uiScale, coreLogLevel, ipv6 } =
    settings;
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
      ? t("settings.storageNative")
      : mode === "preview"
        ? t("settings.storagePreview")
        : t("settings.storageLoading");
  const capabilityFallback = integration.isLoading
    ? t("settings.checkingCapability")
    : t("settings.integrationUnavailable");
  const tunState = tunCapability?.state;

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">{t("settings.eyebrow")}</span>
          <h1 id="settings-title">{t("settings.title")}</h1>
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
              <span className="settings-label">{t("settings.appearance")}</span>
              <h2>{t("settings.theme")}</h2>
            </div>
            <span className="settings-index">01</span>
          </div>

          <div className="theme-options">
            {themeOptions.map(({ id, nameKey, captionKey, icon: Icon }) => (
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
                    <strong>{t(nameKey)}</strong>
                    <small>{t(captionKey)}</small>
                  </span>
                </span>
                <span className="theme-option-check" aria-hidden="true">
                  {theme === id ? <Check size={13} strokeWidth={2.4} /> : null}
                </span>
              </button>
            ))}
          </div>

          <div className="settings-panel-heading settings-panel-heading-inset">
            <div>
              <span className="settings-label">
                {t("settings.languageCaption")}
              </span>
              <h2>{t("settings.language")}</h2>
            </div>
            <Languages aria-hidden="true" size={16} />
          </div>

          <div className="behavior-options">
            {languageOptions.map(({ id, nameKey, captionKey }) => (
              <button
                key={id}
                className="behavior-option"
                type="button"
                aria-pressed={language === id}
                disabled={controlsDisabled}
                onClick={() => void updateLanguage(id)}
              >
                <span className="behavior-radio" aria-hidden="true">
                  {language === id ? <span /> : null}
                </span>
                <span>
                  <strong>{t(nameKey)}</strong>
                  <small>{t(captionKey)}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="settings-panel-heading settings-panel-heading-inset">
            <div>
              <span className="settings-label">{t("settings.uiScaleLabel")}</span>
              <h2>{t("settings.uiScale")}</h2>
            </div>
            <ZoomIn aria-hidden="true" size={16} />
          </div>

          <div className="ui-scale-options" role="group" aria-label={t("settings.uiScale")}>
            {UI_SCALE_STEPS.map((step) => (
              <button
                key={step}
                className="ui-scale-option"
                type="button"
                aria-pressed={uiScale === step}
                disabled={controlsDisabled}
                onClick={() => void updateUiScale(step)}
              >
                {step}%
              </button>
            ))}
          </div>
          <p className="settings-inline-hint">{t("settings.uiScaleHint")}</p>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="settings-label">{t("settings.core")}</span>
              <h2>{t("settings.coreLogLevel")}</h2>
            </div>
            <span className="settings-index">02</span>
          </div>

          <div className="behavior-options">
            {logLevelOptions.map(({ id, labelKey }) => (
              <button
                key={id}
                className="behavior-option"
                type="button"
                aria-pressed={coreLogLevel === id}
                disabled={controlsDisabled}
                onClick={() => void updateCoreLogLevel(id)}
              >
                <span className="behavior-radio" aria-hidden="true">
                  {coreLogLevel === id ? <span /> : null}
                </span>
                <span>
                  <strong>{t(labelKey)}</strong>
                </span>
              </button>
            ))}
          </div>
          <p className="settings-inline-hint">
            {runtime.snapshot?.state === "connected"
              ? t("settings.restartToApply")
              : t("settings.appliesOnNextStart")}
          </p>

          <div className="integration-list">
            <div className="integration-row">
              <span className="integration-icon">
                <ShieldCheck aria-hidden="true" size={16} />
              </span>
              <span className="integration-copy">
                <strong>{t("settings.ipv6")}</strong>
                <small>{t("settings.ipv6Hint")}</small>
              </span>
              <button
                className="integration-switch"
                type="button"
                role="switch"
                aria-label={t("settings.ipv6")}
                aria-checked={ipv6}
                disabled={controlsDisabled}
                onClick={() => void updateIpv6(!ipv6)}
              >
                <span aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        <MihomoCorePanel />

        <section className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="settings-label">{t("settings.window")}</span>
              <h2>{t("settings.closeButton")}</h2>
            </div>
            <span className="settings-index">03</span>
          </div>

          <div className="behavior-options">
            {closeOptions.map(({ id, labelKey, captionKey }) => (
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
                  <strong>{t(labelKey)}</strong>
                  <small>{t(captionKey)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="settings-label">{t("settings.network")}</span>
              <h2>{t("settings.integration")}</h2>
            </div>
            <span className="settings-index">04</span>
          </div>

          <div className="integration-list">
            <div className="integration-row">
              <span className="integration-icon">
                <RadioTower aria-hidden="true" size={16} />
              </span>
              <span className="integration-copy">
                <strong>{t("settings.systemProxy")}</strong>
                <small>
                  {systemProxyCapability?.message ?? capabilityFallback}
                </small>
              </span>
              <button
                className="integration-switch"
                type="button"
                role="switch"
                aria-label={t("settings.systemProxy")}
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
                <strong>{t("settings.launchAtLogin")}</strong>
                <small>
                  {launchAtLoginCapability?.message ?? capabilityFallback}
                </small>
              </span>
              <button
                className="integration-switch"
                type="button"
                role="switch"
                aria-label={t("settings.launchAtLogin")}
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
                <strong>{t("settings.tunInterface")}</strong>
                <small>{t("settings.detectionOnly")}</small>
                <span className="integration-detail">
                  {tunCapability?.message ??
                    (integration.isLoading
                      ? t("settings.checkingElevation")
                      : t("settings.tunDisabled"))}
                </span>
              </span>
              <span
                className="integration-status"
                data-state={tunState ?? "unverified"}
              >
                {tunState === "available"
                  ? t("common.ready")
                  : tunState === "blocked"
                    ? t("common.blocked")
                    : tunState === "unsupported"
                      ? t("common.unsupported")
                      : t("common.unverified")}
              </span>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
