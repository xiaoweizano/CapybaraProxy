import {
  Activity,
  Check,
  Database,
  Languages,
  RadioTower,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  SunMedium,
  Timer,
  Waves,
  Wifi,
  ZoomIn,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../../app/settings/settingsContext";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useSystemIntegration } from "../../app/systemIntegration/systemIntegrationContext";
import type { CloseBehavior } from "../../shared/closeBehavior";
import { isValidProbeUrl, normalizeDelayTimeout } from "../../shared/delayProbe";
import { UI_SCALE_STEPS } from "../../shared/uiScale";
import type { LanguageId } from "../../i18n/language";
import type { CoreLogLevel } from "../../platform/runtime";
import {
  importSubStoreSubscription,
  listSubStoreSubscriptions,
  openLogDirectory,
  clearLogFiles,
  type SubStoreSubscription,
} from "../../platform/runtime";
import {
  DEFAULT_LOG_RETENTION_DAYS,
  LOG_RETENTION_OPTIONS,
  normalizeProxyPort,
} from "../../shared/settingsLimits";
import type { TraySpeedDisplay } from "../../platform/settings";
import type { MotionPreference } from "../../shared/motion";
import { MihomoCorePanel } from "../runtime/MihomoCorePanel";
import {
  ResourceFeedback,
  WorkspacePage,
} from "../workspace/WorkspaceUi";
import {
  SettingsOption,
  SettingsSection,
  SettingsSubheading,
  SettingsSwitchRow,
} from "./SettingsSection";
import {
  settingsModeCaptionKey,
  settingsModeLabelKey,
  settingsSection,
  SETTINGS_MODES,
  visibleSections,
  type SettingsSectionId,
} from "./settingsSections";

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
  { id: "silent", labelKey: "settings.logSilent" },
  { id: "error", labelKey: "settings.logError" },
  { id: "warning", labelKey: "settings.logWarning" },
  { id: "info", labelKey: "settings.logInfo" },
  { id: "debug", labelKey: "settings.logDebug" },
];

const autoUpdateOptions = [0, 6, 12, 24] as const;

const traySpeedOptions: Array<{ id: TraySpeedDisplay; labelKey: string }> = [
  { id: "icon", labelKey: "settings.traySpeedIcon" },
  { id: "tooltip", labelKey: "settings.traySpeedTooltip" },
  { id: "off", labelKey: "settings.traySpeedOff" },
];

const motionOptions: Array<{ id: MotionPreference; labelKey: string }> = [
  { id: "full", labelKey: "settings.motionFull" },
  { id: "reduced", labelKey: "settings.motionReduced" },
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
    updateSubscriptionUpdateHours,
    updateUpdateSubscriptionOnLaunch,
    updateAutoConnect,
    updateSettingsMode,
    updateSilentStart,
    updateMotion,
    updateTrayShowInfo,
    updateTraySpeedDisplay,
  } = useAppSettings();
  const runtime = useRuntime();
  const integration = useSystemIntegration();
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
  const sections = visibleSections(settings.settingsMode);

  const shows = (id: SettingsSectionId): boolean =>
    sections.some((section) => section.id === id);

  // The app routes with `HashRouter`, so an `href="#…"` anchor would replace
  // the route. Scroll the target into view instead.
  const jumpTo = (id: SettingsSectionId) => {
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <WorkspacePage
      eyebrow={t("settings.eyebrow")}
      title={t("settings.title")}
      badge={storageLabel}
      badgeTone="neutral"
      className="settings-page"
    >
      <nav className="settings-section-nav" aria-label={t("settings.sectionNav")}>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => jumpTo(section.id)}
          >
            <span className="settings-section-index">{section.index}</span>
            {t(section.titleKey)}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="workspace-feedback workspace-feedback-error" role="alert">
          {error}
        </p>
      ) : null}

      {integrationError ? (
        <ResourceFeedback
          error={{ code: "platform_integration", message: integrationError, retryable: true }}
          unavailable={false}
        />
      ) : integration.notice ? (
        <p className="workspace-feedback" role="status">
          {integration.notice}
        </p>
      ) : null}

      {shows("appearance") ? (
        <SettingsSection definition={settingsSection("appearance")}>
          <div className="theme-options">
            {themeOptions.map(({ id, nameKey, captionKey, icon: Icon }) => (
              <button
                key={id}
                className={`theme-option theme-option-${id}`}
                type="button"
                aria-pressed={settings.theme === id}
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
                  {settings.theme === id ? (
                    <Check size={13} strokeWidth={2.4} />
                  ) : null}
                </span>
              </button>
            ))}
          </div>

          <SettingsSubheading
            kicker={t("settings.languageCaption")}
            title={t("settings.language")}
            icon={<Languages aria-hidden="true" size={16} />}
          />
          <div className="workspace-option-list">
            {languageOptions.map(({ id, nameKey, captionKey }) => (
              <SettingsOption
                key={id}
                pressed={settings.language === id}
                disabled={controlsDisabled}
                onClick={() => void updateLanguage(id)}
                title={t(nameKey)}
                caption={t(captionKey)}
              />
            ))}
          </div>

          <SettingsSubheading
            kicker={t("settings.uiScaleLabel")}
            title={t("settings.uiScale")}
            icon={<ZoomIn aria-hidden="true" size={16} />}
          />
          <div
            className="ui-scale-options"
            role="group"
            aria-label={t("settings.uiScale")}
          >
            {UI_SCALE_STEPS.map((step) => (
              <button
                key={step}
                className="ui-scale-option"
                type="button"
                aria-pressed={settings.uiScale === step}
                disabled={controlsDisabled}
                onClick={() => void updateUiScale(step)}
              >
                {step}%
              </button>
            ))}
          </div>
          <p className="settings-inline-hint">{t("settings.uiScaleHint")}</p>

          <SettingsSubheading
            kicker={t("settings.settingsModeCaption")}
            title={t("settings.settingsMode")}
            icon={<SlidersHorizontal aria-hidden="true" size={16} />}
          />
          <div
            className="workspace-option-grid"
            role="group"
            aria-label={t("settings.settingsMode")}
          >
            {SETTINGS_MODES.map((id) => (
              <SettingsOption
                key={id}
                pressed={settings.settingsMode === id}
                disabled={controlsDisabled}
                onClick={() => void updateSettingsMode(id)}
                title={t(settingsModeLabelKey(id))}
                caption={t(settingsModeCaptionKey(id))}
              />
            ))}
          </div>
          <p className="settings-inline-hint">{t("settings.settingsModeHint")}</p>
        </SettingsSection>
      ) : null}

      {shows("window") ? (
        <SettingsSection definition={settingsSection("window")}>
          <div className="workspace-option-list">
            {closeOptions.map(({ id, labelKey, captionKey }) => (
              <SettingsOption
                key={id}
                pressed={settings.closeBehavior === id}
                disabled={controlsDisabled}
                onClick={() => void updateCloseBehavior(id)}
                title={t(labelKey)}
                caption={t(captionKey)}
              />
            ))}
          </div>

          <SettingsSubheading
            kicker={t("settings.startupKicker")}
            title={t("settings.startup")}
            icon={<Wifi aria-hidden="true" size={16} />}
          />
          <div className="workspace-option-list">
            <SettingsSwitchRow
              title={t("settings.silentStart")}
              caption={t("settings.silentStartCaption")}
              checked={settings.silentStart}
              disabled={controlsDisabled}
              onChange={(checked) => void updateSilentStart(checked)}
            />
            <SettingsSwitchRow
              icon={<Waves aria-hidden="true" size={16} />}
              title={t("settings.autoConnect")}
              caption={t("settings.autoConnectCaption")}
              checked={settings.autoConnect}
              disabled={controlsDisabled}
              onChange={(checked) => void updateAutoConnect(checked)}
            />
            <SettingsSwitchRow
              icon={<RadioTower aria-hidden="true" size={16} />}
              title={t("settings.launchAtLogin")}
              caption={
                launchAtLoginCapability?.message ?? capabilityFallback
              }
              checked={launchAtLoginEnabled}
              disabled={launchAtLoginDisabled}
              onChange={(checked) =>
                void integration.setLaunchAtLoginEnabled(checked)
              }
            />
          </div>
        </SettingsSection>
      ) : null}

      {shows("network") ? (
        <SettingsSection definition={settingsSection("network")}>
          <div className="workspace-option-list">
            <SettingsSwitchRow
              icon={<RadioTower aria-hidden="true" size={16} />}
              title={t("settings.systemProxy")}
              caption={systemProxyCapability?.message ?? capabilityFallback}
              checked={systemProxyEnabled}
              disabled={systemProxyDisabled}
              onChange={(checked) =>
                void integration.setSystemProxyEnabled(checked)
              }
            />
            <div className="workspace-setting-row">
              <span className="workspace-setting-icon">
                <ShieldCheck aria-hidden="true" size={16} />
              </span>
              <span>
                <strong>{t("settings.tunInterface")}</strong>
                <small>{t("settings.detectionOnly")}</small>
                <span className="workspace-setting-detail">
                  {tunCapability?.message ??
                    (integration.isLoading
                      ? t("settings.checkingElevation")
                      : t("settings.tunDisabled"))}
                </span>
              </span>
              <span className="workspace-status-pill" data-state={tunState ?? "unverified"}>
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
        </SettingsSection>
      ) : null}

      {shows("subscription") ? (
        <SettingsSection definition={settingsSection("subscription")}>
          <div className="workspace-option-list">
            <SettingsSwitchRow
              icon={<Timer aria-hidden="true" size={16} />}
              title={t("settings.updateOnLaunch")}
              caption={t("settings.updateOnLaunchCaption")}
              checked={settings.updateSubscriptionOnLaunch}
              disabled={controlsDisabled}
              onChange={(checked) =>
                void updateUpdateSubscriptionOnLaunch(checked)
              }
            />
          </div>

          <SettingsSubheading
            kicker={t("settings.autoUpdateKicker")}
            title={t("settings.autoUpdate")}
            icon={<Timer aria-hidden="true" size={16} />}
          />
          <div className="choice-chips" role="group" aria-label={t("settings.autoUpdate")}>
            {autoUpdateOptions.map((hours) => (
              <button
                key={hours}
                type="button"
                className="choice-chip"
                aria-pressed={settings.subscriptionUpdateHours === hours}
                disabled={controlsDisabled}
                onClick={() => void updateSubscriptionUpdateHours(hours)}
              >
                {hours === 0
                  ? t("settings.autoUpdateOff")
                  : t("settings.autoUpdateHours", { hours })}
              </button>
            ))}
          </div>
          <p className="settings-inline-hint">{t("settings.autoUpdateHint")}</p>
          <AutoUpdateCustom controlsDisabled={controlsDisabled} />
          <SubscriptionUserAgent controlsDisabled={controlsDisabled} />
        </SettingsSection>
      ) : null}

      {shows("logs") ? <LogSection controlsDisabled={controlsDisabled} /> : null}

      {shows("core") ? (
        <SettingsSection definition={settingsSection("core")}>
          <div className="workspace-option-list">
            {logLevelOptions.map(({ id, labelKey }) => (
              <SettingsOption
                key={id}
                pressed={settings.coreLogLevel === id}
                disabled={controlsDisabled}
                onClick={() => void updateCoreLogLevel(id)}
                title={t(labelKey)}
              />
            ))}
          </div>
          <p className="settings-inline-hint">
            {runtime.snapshot?.state === "connected"
              ? t("settings.restartToApply")
              : t("settings.appliesOnNextStart")}
          </p>

          <div className="workspace-option-list">
            <SettingsSwitchRow
              icon={<ShieldCheck aria-hidden="true" size={16} />}
              title={t("settings.ipv6")}
              caption={t("settings.ipv6Hint")}
              checked={settings.ipv6}
              disabled={controlsDisabled}
              onChange={(checked) => void updateIpv6(checked)}
            />
          </div>
        </SettingsSection>
      ) : null}

      {shows("core") ? <MihomoCorePanel /> : null}

      {shows("tray") ? (
        <SettingsSection definition={settingsSection("tray")}>
          <div className="workspace-option-list">
            <SettingsSwitchRow
              icon={<Activity aria-hidden="true" size={16} />}
              title={t("settings.trayShowInfo")}
              caption={t("settings.trayShowInfoCaption")}
              checked={settings.trayShowInfo}
              disabled={controlsDisabled}
              onChange={(checked) => void updateTrayShowInfo(checked)}
            />
          </div>

          <SettingsSubheading
            kicker={t("settings.traySpeedKicker")}
            title={t("settings.traySpeedDisplay")}
            icon={<Activity aria-hidden="true" size={16} />}
          />
          <div
            className="workspace-option-grid"
            role="group"
            aria-label={t("settings.traySpeedDisplay")}
          >
            {traySpeedOptions.map(({ id, labelKey }) => (
              <SettingsOption
                key={id}
                pressed={settings.traySpeedDisplay === id}
                disabled={controlsDisabled}
                onClick={() => void updateTraySpeedDisplay(id)}
                title={t(labelKey)}
              />
            ))}
          </div>

          <SettingsSubheading
            kicker={t("settings.motionCaption")}
            title={t("settings.motion")}
            icon={<Waves aria-hidden="true" size={16} />}
          />
          <div
            className="workspace-option-grid"
            role="group"
            aria-label={t("settings.motion")}
          >
            {motionOptions.map(({ id, labelKey }) => (
              <SettingsOption
                key={id}
                pressed={settings.motion === id}
                disabled={controlsDisabled}
                onClick={() => void updateMotion(id)}
                title={t(labelKey)}
              />
            ))}
          </div>
        </SettingsSection>
      ) : null}

      {shows("advanced") ? (
        <AdvancedCoreSection controlsDisabled={controlsDisabled} />
      ) : null}

      {shows("substore") ? (
        <SubStoreSection controlsDisabled={controlsDisabled} />
      ) : null}
    </WorkspacePage>
  );
}

/**
 * A free-form update interval next to the preset chips.
 *
 * The presets cover the common cases; providers that rotate their node list
 * on an unusual cadence need any whole number of hours. The value is only
 * saved on blur once it parses inside the range the native side accepts.
 */
function AutoUpdateCustom({ controlsDisabled }: { controlsDisabled: boolean }) {
  const { t } = useTranslation();
  const { settings, updateSubscriptionUpdateHours } = useAppSettings();
  const [draft, setDraft] = useState(
    settings.subscriptionUpdateHours > 0 &&
      !(autoUpdateOptions as readonly number[]).includes(
        settings.subscriptionUpdateHours,
      )
      ? String(settings.subscriptionUpdateHours)
      : "",
  );
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setInvalid(false);
      return;
    }
    const hours = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (hours !== settings.subscriptionUpdateHours) {
      void updateSubscriptionUpdateHours(hours);
    }
  };

  return (
    <div className="delay-probe settings-custom-interval">
      <label className="subscription-field">
        <span>{t("settings.autoUpdateCustomLabel")}</span>
        <input
          type="number"
          min={1}
          max={168}
          step={1}
          value={draft}
          placeholder={String(settings.subscriptionUpdateHours || 0)}
          disabled={controlsDisabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
        />
      </label>
      <p className="settings-inline-hint">
        {invalid
          ? t("settings.autoUpdateCustomInvalid")
          : t("settings.autoUpdateCustomHint")}
      </p>
    </div>
  );
}

/** The User-Agent sent when downloading a subscription. */
function SubscriptionUserAgent({
  controlsDisabled,
}: {
  controlsDisabled: boolean;
}) {
  const { t } = useTranslation();
  const { settings, updateSubscriptionUserAgent } = useAppSettings();
  const [draft, setDraft] = useState(settings.subscriptionUserAgent ?? "");

  const commit = () => {
    const next = draft.trim();
    if (next === (settings.subscriptionUserAgent ?? "")) {
      return;
    }
    void updateSubscriptionUserAgent(next);
  };

  return (
    <>
      <SettingsSubheading
        kicker={t("settings.subscriptionUserAgentCaption")}
        title={t("settings.subscriptionUserAgent")}
        icon={<Languages aria-hidden="true" size={16} />}
      />
      <div className="delay-probe">
        <label className="subscription-field subscription-field-wide">
          <span>{t("settings.subscriptionUserAgent")}</span>
          <input
            type="text"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            maxLength={512}
            placeholder={t("settings.subscriptionUserAgentPlaceholder")}
            disabled={controlsDisabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
          />
        </label>
      </div>
      <p className="settings-inline-hint">
        {t("settings.subscriptionUserAgentHint")}
      </p>
    </>
  );
}

function LogSection({ controlsDisabled }: { controlsDisabled: boolean }) {  const { t } = useTranslation();
  const { settings, updateLogToFile, updateLogRetentionDays } = useAppSettings();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const openDirectory = async () => {
    setPending(true);
    setStatus(null);
    try {
      const result = await openLogDirectory();
      if (result.status === "error") {
        setStatus(result.error.message);
      }
    } finally {
      setPending(false);
    }
  };

  const clearFiles = async () => {
    setPending(true);
    setStatus(null);
    try {
      const result = await clearLogFiles();
      if (result.status === "ok") {
        setStatus(t("settings.logsCleared", { count: result.data }));
      } else if (result.status === "error") {
        setStatus(result.error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsSection
      definition={settingsSection("logs")}
      actions={
        <>
          <button
            className="workspace-action-button"
            type="button"
            disabled={pending}
            onClick={() => void openDirectory()}
          >
            <ScrollText aria-hidden="true" size={14} />
            {t("settings.openLogDirectory")}
          </button>
          <button
            className="workspace-action-button"
            type="button"
            disabled={pending}
            onClick={() => void clearFiles()}
          >
            {t("settings.clearLogFiles")}
          </button>
        </>
      }
    >
      <div className="workspace-option-list">
        <SettingsSwitchRow
          icon={<ScrollText aria-hidden="true" size={16} />}
          title={t("settings.logToFile")}
          caption={t("settings.logToFileCaption")}
          checked={settings.logToFile}
          disabled={controlsDisabled}
          onChange={(checked) => void updateLogToFile(checked)}
        />
      </div>

      <SettingsSubheading
        kicker={t("settings.logRetentionKicker")}
        title={t("settings.logRetention")}
        icon={<Database aria-hidden="true" size={16} />}
      />
      <div
        className="choice-chips"
        role="group"
        aria-label={t("settings.logRetention")}
      >
        {LOG_RETENTION_OPTIONS.map((days) => (
          <button
            key={days}
            type="button"
            className="choice-chip"
            aria-pressed={settings.logRetentionDays === days}
            disabled={controlsDisabled || !settings.logToFile}
            onClick={() => void updateLogRetentionDays(days)}
          >
            {days === DEFAULT_LOG_RETENTION_DAYS
              ? t("settings.logRetentionDaysDefault", { days })
              : t("settings.logRetentionDays", { days })}
          </button>
        ))}
      </div>
      {status ? (
        <p className="settings-inline-hint" role="status">
          {status}
        </p>
      ) : null}
    </SettingsSection>
  );
}

function AdvancedCoreSection({
  controlsDisabled,
}: {
  controlsDisabled: boolean;
}) {
  const { t } = useTranslation();
  const {
    settings,
    updateDelayProbe,
    updateUnifiedDelay,
    updateTcpConcurrent,
    updateFixedProxyPort,
  } = useAppSettings();
  const [probeUrl, setProbeUrl] = useState(settings.delayProbeUrl);
  const [probeTimeout, setProbeTimeout] = useState(settings.delayTimeoutMs);
  const [port, setPort] = useState(
    settings.fixedProxyPort === null ? "" : String(settings.fixedProxyPort),
  );
  const [portError, setPortError] = useState<string | null>(null);

  const saveProbe = () => {
    if (!isValidProbeUrl(probeUrl)) {
      return;
    }
    void updateDelayProbe(probeUrl, normalizeDelayTimeout(probeTimeout));
  };

  const savePort = () => {
    const trimmed = port.trim();
    if (trimmed === "") {
      setPortError(null);
      if (settings.fixedProxyPort !== null) {
        void updateFixedProxyPort(null);
      }
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    const normalized = normalizeProxyPort(Number.isFinite(parsed) ? parsed : null);
    if (normalized === null) {
      setPortError(t("settings.fixedProxyPortInvalid"));
      return;
    }
    setPortError(null);
    if (normalized !== settings.fixedProxyPort) {
      void updateFixedProxyPort(normalized);
    }
  };

  return (
    <SettingsSection
      definition={settingsSection("advanced")}
    >
      <div className="workspace-option-list">
        <SettingsSwitchRow
          icon={<Timer aria-hidden="true" size={16} />}
          title={t("settings.unifiedDelay")}
          caption={t("settings.unifiedDelayHint")}
          checked={settings.unifiedDelay}
          disabled={controlsDisabled}
          onChange={(checked) => void updateUnifiedDelay(checked)}
        />
        <SettingsSwitchRow
          icon={<Activity aria-hidden="true" size={16} />}
          title={t("settings.tcpConcurrent")}
          caption={t("settings.tcpConcurrentHint")}
          checked={settings.tcpConcurrent}
          disabled={controlsDisabled}
          onChange={(checked) => void updateTcpConcurrent(checked)}
        />
      </div>

      <SettingsSubheading
        kicker={t("settings.proxyPortKicker")}
        title={t("settings.fixedProxyPort")}
        icon={<Wifi aria-hidden="true" size={16} />}
      />
      <div className="delay-probe">
        <label className="subscription-field">
          <span>{t("settings.fixedProxyPort")}</span>
          <input
            type="number"
            min={1024}
            max={65535}
            step={1}
            value={port}
            placeholder={t("settings.fixedProxyPortAuto")}
            disabled={controlsDisabled}
            onChange={(event) => setPort(event.target.value)}
            onBlur={savePort}
          />
        </label>
      </div>
      {portError ? (
        <p className="settings-inline-hint" role="alert">
          {portError}
        </p>
      ) : (
        <p className="settings-inline-hint">{t("settings.fixedProxyPortHint")}</p>
      )}

      <SettingsSubheading
        kicker={t("settings.delayProbeKicker")}
        title={t("settings.delayProbe")}
        icon={<Timer aria-hidden="true" size={16} />}
      />
      <div className="delay-probe">
        <label className="subscription-field">
          <span>{t("settings.probeUrl")}</span>
          <input
            type="url"
            value={probeUrl}
            spellCheck={false}
            autoComplete="off"
            disabled={controlsDisabled}
            onChange={(event) => setProbeUrl(event.target.value)}
            onBlur={() => {
              if (
                probeUrl !== settings.delayProbeUrl &&
                isValidProbeUrl(probeUrl)
              ) {
                saveProbe();
              }
            }}
          />
        </label>
        <label className="subscription-field delay-probe-timeout">
          <span>{t("settings.probeTimeout")}</span>
          <input
            type="number"
            min={1000}
            max={10000}
            step={500}
            value={probeTimeout}
            disabled={controlsDisabled}
            onChange={(event) =>
              setProbeTimeout(Number(event.target.value) || 0)
            }
            onBlur={() => {
              const normalized = normalizeDelayTimeout(probeTimeout);
              setProbeTimeout(normalized);
              if (
                normalized !== settings.delayTimeoutMs ||
                probeUrl !== settings.delayProbeUrl
              ) {
                saveProbe();
              }
            }}
          />
        </label>
      </div>
      {!isValidProbeUrl(probeUrl) ? (
        <p className="settings-inline-hint" role="alert">
          {t("settings.probeUrlInvalid")}
        </p>
      ) : null}
    </SettingsSection>
  );
}

function SubStoreSection({ controlsDisabled }: { controlsDisabled: boolean }) {
  const { t } = useTranslation();
  const { settings, updateSubStore } = useAppSettings();
  const [url, setUrl] = useState(settings.substoreUrl);
  const [token, setToken] = useState(settings.substoreToken);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<
    SubStoreSubscription[] | null
  >(null);

  const connect = async () => {
    setPending(true);
    setStatus(null);
    try {
      const result = await listSubStoreSubscriptions(url, token);
      if (result.status === "unavailable") {
        setStatus(t("settings.substoreBridgeUnavailable"));
        return;
      }
      if (result.status === "error") {
        setStatus(result.error.message);
        return;
      }
      setSubscriptions(result.data);
      // Persisting here means the address is ready the next time the page
      // opens, which is the point of the connection test.
      void updateSubStore(url, token);
    } finally {
      setPending(false);
    }
  };

  const importOne = async (subscription: SubStoreSubscription) => {
    setImporting(subscription.url);
    setStatus(null);
    try {
      const result = await importSubStoreSubscription(
        subscription.name,
        subscription.url,
      );
      if (result.status === "unavailable") {
        setStatus(t("settings.substoreBridgeUnavailable"));
      } else if (result.status === "error") {
        setStatus(result.error.message);
      } else {
        setStatus(t("settings.substoreImported", { name: subscription.name }));
      }
    } finally {
      setImporting(null);
    }
  };

  return (
    <SettingsSection
      definition={settingsSection("substore")}
    >
      <p className="workspace-hint">{t("settings.substoreHint")}</p>
      <div className="substore-form">
        <label className="subscription-field">
          <span>{t("settings.substoreUrl")}</span>
          <input
            type="url"
            value={url}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://substore.example.com"
            disabled={controlsDisabled || pending}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className="subscription-field">
          <span>{t("settings.substoreToken")}</span>
          <input
            type="password"
            value={token}
            spellCheck={false}
            autoComplete="off"
            disabled={controlsDisabled || pending}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
      </div>

      <div className="subscription-actions">
        <span className="subscription-actions-note">
          {t("settings.substoreNote")}
        </span>
        <button
          type="button"
          className="workspace-primary-button"
          disabled={controlsDisabled || pending || url.trim() === ""}
          onClick={() => void connect()}
        >
          {pending ? t("settings.substoreConnecting") : t("settings.substoreConnect")}
        </button>
      </div>

      {status ? (
        <p className="settings-inline-hint" role="status">
          {status}
        </p>
      ) : null}

      {subscriptions !== null ? (
        subscriptions.length === 0 ? (
          <p className="substore-empty">{t("settings.substoreEmpty")}</p>
        ) : (
          <div className="substore-list">
            {subscriptions.map((subscription) => (
              <div className="substore-row" key={`${subscription.name}-${subscription.url}`}>
                <span className="substore-row-copy">
                  <strong>{subscription.name}</strong>
                  <small>{subscription.url}</small>
                </span>
                <button
                  type="button"
                  className="workspace-action-button"
                  disabled={controlsDisabled || importing !== null}
                  onClick={() => void importOne(subscription)}
                >
                  {importing === subscription.url
                    ? t("settings.substoreImporting")
                    : t("settings.substoreImport")}
                </button>
              </div>
            ))}
          </div>
        )
      ) : null}
    </SettingsSection>
  );
}
