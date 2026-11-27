import {
  CircleCheck,
  FileStack,
  Link2,
  RefreshCw,
  SlidersHorizontal,
  Timer,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import {
  activateSubscription,
  getProfiles,
  getSubscriptionSnapshot,
  importSubscription,
  importSubscriptionFromUrl,
  refreshSubscription,
  removeSubscription,
  setSubscriptionOverrideYaml,
  setSubscriptionRules,
  subscribeSubscriptionUpdated,
  type ProfileInfo,
  type RuntimeError,
} from "../../platform/runtime";
import {
  LoadingState,
  ResourceFeedback,
  WorkspacePage,
} from "../workspace/WorkspaceUi";

type ImportMode = "url" | "yaml";

function formatTraffic(bytes: number): string {
  const GIBIBYTE = 1024 ** 3;
  const MEBIBYTE = 1024 ** 2;
  if (bytes >= GIBIBYTE) {
    return `${(bytes / GIBIBYTE).toFixed(2)} GB`;
  }
  if (bytes >= MEBIBYTE) {
    return `${(bytes / MEBIBYTE).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Usage and expiry reported by the provider.
 *
 * Renders nothing when the header was absent, which is the normal case for a
 * pasted subscription. `total_bytes === 0` is how providers spell "unlimited".
 */
function SubscriptionUsagePanel() {
  const { t, i18n } = useTranslation();
  const stored = useBridgeResource(getSubscriptionSnapshot, true);
  // Read the clock once per mount instead of on every render, so the expiry
  // badge cannot flip back and forth while the page re-renders.
  const [now] = useState(() => Date.now());
  const usage = stored.data?.usage;
  if (!usage) {
    return null;
  }

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const used =
    (usage.upload_bytes ?? 0) + (usage.download_bytes ?? 0);
  const unlimited = usage.total_bytes === 0;
  const usedLabel =
    typeof usage.total_bytes === "number" && !unlimited
      ? t("profiles.usageUsed", {
          used: formatTraffic(used),
          total: formatTraffic(usage.total_bytes),
        })
      : t("profiles.usageUnlimited", { used: formatTraffic(used) });
  const percent =
    typeof usage.total_bytes === "number" && usage.total_bytes > 0
      ? Math.min(100, Math.round((used / usage.total_bytes) * 100))
      : null;
  const expired =
    typeof usage.expire_at_ms === "number" &&
    usage.expire_at_ms > 0 &&
    usage.expire_at_ms < now;

  return (
    <div className="subscription-usage">
      <span className="workspace-kicker">{t("profiles.usageKicker")}</span>
      <div className="subscription-usage-numbers">
        <strong>{usedLabel}</strong>
        <span>
          {t("profiles.usageUpload")} {formatTraffic(usage.upload_bytes ?? 0)}
          {" · "}
          {t("profiles.usageDownload")}{" "}
          {formatTraffic(usage.download_bytes ?? 0)}
        </span>
      </div>
      {percent !== null ? (
        <div
          className="subscription-usage-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} data-exhausted={percent >= 100} />
        </div>
      ) : null}
      <span className="subscription-usage-expire" data-expired={expired}>
        {typeof usage.expire_at_ms === "number" && usage.expire_at_ms > 0
          ? expired
            ? t("profiles.usageExpired", {
                time: dateFormatter.format(usage.expire_at_ms),
              })
            : t("profiles.usageExpire", {
                time: dateFormatter.format(usage.expire_at_ms),
              })
          : t("profiles.usageExpireUnknown")}
      </span>
    </div>
  );
}

export function ProfilesPage() {
  const { t } = useTranslation();
  const { snapshot, measureGroupDelay } = useRuntime();
  const profiles = useBridgeResource(getProfiles, true);
  // The stored document carries the group names, which is what the bulk delay
  // test needs; the profile metadata only has counts.
  const stored = useBridgeResource(getSubscriptionSnapshot, true);
  const [mode, setMode] = useState<ImportMode>("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [yaml, setYaml] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const [pendingTest, setPendingTest] = useState(false);
  const [actionError, setActionError] = useState<RuntimeError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasSubscription = (profiles.data ?? []).some(
    (profile): boolean => profile.source === "subscription",
  );
  const subscriptionProfiles = (profiles.data ?? []).filter(
    (profile): boolean => profile.source === "subscription",
  );
  const activeProfile =
    subscriptionProfiles.find((profile) => profile.active) ?? null;
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);
  const coreRunning = snapshot?.state === "connected";
  const refreshable =
    stored.data?.has_subscription === true &&
    typeof stored.data.source_url === "string" &&
    stored.data.source_url.length > 0;
  const testableGroups = (stored.data?.groups ?? []).filter(
    (group) => group.nodes.length > 0,
  );

  // An automatic refresh happens in the native health loop; reload when it
  // lands so the page does not show the previous document.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeSubscriptionUpdated(() => {
      if (!active) {
        return;
      }
      void profiles.reload();
      void stored.reload();
      setNotice(t("profiles.noticeAutoRefreshed"));
    })
      .then((cleanup) => {
        if (active) {
          unsubscribe = cleanup;
        } else {
          cleanup();
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe?.();
    };
    // `profiles`/`stored` expose stable reload callbacks per render; the
    // subscription itself only needs to be created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitImport(): Promise<void> {
    setActionError(null);
    setNotice(null);
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();

    if (trimmedName.length === 0) {
      setActionError({
        code: "subscription_invalid",
        message: t("profiles.errorName"),
        retryable: false,
      });
      return;
    }
    if (mode === "url" && trimmedUrl.length === 0) {
      setActionError({
        code: "subscription_invalid",
        message: t("profiles.errorUrl"),
        retryable: false,
      });
      return;
    }
    if (mode === "yaml" && yaml.trim().length === 0) {
      setActionError({
        code: "subscription_invalid",
        message: t("profiles.errorYaml"),
        retryable: false,
      });
      return;
    }

    setPending(true);
    try {
      const result =
        mode === "url"
          ? await importSubscriptionFromUrl(trimmedName, trimmedUrl)
          : await importSubscription(trimmedName, yaml);

      if (result.status === "unavailable") {
        setActionError({
          code: "internal",
          message: t("profiles.errorBridge"),
          retryable: true,
        });
        return;
      }
      if (result.status === "error") {
        setActionError(result.error);
        return;
      }

      await profiles.reload();
      await stored.reload();
      setNotice(
        coreRunning
          ? t("profiles.noticeRunning")
          : t("profiles.noticeStopped"),
      );
      setUrl("");
      setYaml("");
    } finally {
      setPending(false);
    }
  }

  /** Removes one subscription, leaving the others untouched. */
  async function removeOne(profile: ProfileInfo): Promise<void> {
    setActionError(null);
    setNotice(null);
    setPendingProfile(profile.id);
    try {
      const result = await removeSubscription(profile.id);
      if (result.status === "unavailable") {
        setActionError({
          code: "internal",
          message: t("profiles.errorBridge"),
          retryable: true,
        });
        return;
      }
      if (result.status === "error") {
        setActionError(result.error);
        return;
      }
      await Promise.all([profiles.reload(), stored.reload()]);
      setNotice(t("profiles.noticeRemoved"));
    } finally {
      setPendingProfile(null);
    }
  }

  /** Makes another stored subscription the one the core launches with. */
  async function activateOne(profile: ProfileInfo): Promise<void> {
    setActionError(null);
    setNotice(null);
    setPendingProfile(profile.id);
    try {
      const result = await activateSubscription(profile.id);
      if (result.status === "unavailable") {
        setActionError({
          code: "internal",
          message: t("profiles.errorBridge"),
          retryable: true,
        });
        return;
      }
      if (result.status === "error") {
        setActionError(result.error);
        return;
      }
      await Promise.all([profiles.reload(), stored.reload()]);
      setNotice(
        coreRunning
          ? t("profiles.noticeRefreshedRunning")
          : t("profiles.noticeRefreshedStopped"),
      );
    } finally {
      setPendingProfile(null);
    }
  }

  async function refreshStoredSubscription(): Promise<void> {
    setActionError(null);
    setNotice(null);
    setPendingRefresh(true);
    try {
      const result = await refreshSubscription();
      if (result.status === "unavailable") {
        setActionError({
          code: "internal",
          message: t("profiles.errorBridge"),
          retryable: true,
        });
        return;
      }
      if (result.status === "error") {
        setActionError(result.error);
        return;
      }

      await Promise.all([profiles.reload(), stored.reload()]);
      setNotice(
        coreRunning
          ? t("profiles.noticeRefreshedRunning")
          : t("profiles.noticeRefreshedStopped"),
      );
    } finally {
      setPendingRefresh(false);
    }
  }

  /**
   * Probes the subscription's own groups.
   *
   * The offline snapshot carries the node names, but latency only exists while
   * the core runs; this reuses the live group probe and the names come from the
   * document so a stopped core reports a clear reason instead of doing nothing.
   */
  async function testStoredSubscription(): Promise<void> {
    setActionError(null);
    setNotice(null);
    if (!coreRunning) {
      setActionError({
        code: "invalid_state",
        message: t("profiles.testNeedsCore"),
        retryable: true,
      });
      return;
    }

    setPendingTest(true);
    try {
      let measured = 0;
      for (const group of testableGroups) {
        const delays = await measureGroupDelay(group.name);
        if (delays) {
          measured += Object.keys(delays).length;
        }
      }
      setNotice(t("profiles.testFinished", { count: measured }));
    } finally {
      setPendingTest(false);
    }
  }

  return (
    <WorkspacePage
      eyebrow={t("profiles.eyebrow")}
      title={t("profiles.title")}
      badge={t("common.local")}
    >
      <ResourceFeedback
        error={profiles.error}
        unavailable={profiles.unavailable}
      />

      <section className="workspace-panel subscription-status-panel">
        <div className="workspace-panel-heading">
          <div>
            <span className="workspace-kicker">{t("profiles.kicker")}</span>
            <h2>{t("profiles.heading")}</h2>
          </div>
          <div className="workspace-panel-actions">
            {hasSubscription ? (
              <>
                <button
                  className="workspace-action-button subscription-tool-button"
                  type="button"
                  disabled={pendingTest || testableGroups.length === 0}
                  title={
                    coreRunning
                      ? t("profiles.testAll")
                      : t("profiles.testNeedsCore")
                  }
                  onClick={() => void testStoredSubscription()}
                >
                  <Timer aria-hidden="true" size={14} />
                  {pendingTest ? t("profiles.testingAll") : t("profiles.testAll")}
                </button>
                <button
                  className="workspace-action-button subscription-tool-button"
                  type="button"
                  disabled={pendingRefresh || !refreshable}
                  title={
                    refreshable
                      ? t("profiles.refreshSubscription")
                      : t("profiles.refreshUnavailable")
                  }
                  onClick={() => void refreshStoredSubscription()}
                >
                  <RefreshCw aria-hidden="true" size={14} />
                  {pendingRefresh
                    ? t("profiles.refreshing")
                    : t("profiles.refreshSubscription")}
                </button>
              </>
            ) : null}
            <button
              className="workspace-icon-button"
              type="button"
              aria-label={t("profiles.refresh")}
              title={t("profiles.refresh")}
              disabled={profiles.isLoading}
              onClick={() => {
                void profiles.reload();
                void stored.reload();
              }}
            >
              <RefreshCw aria-hidden="true" size={15} />
            </button>
          </div>
        </div>

        {profiles.isLoading && profiles.data === null ? (
          <LoadingState label={t("profiles.loading")} />
        ) : !profiles.data?.length ? (
          <div className="workspace-empty">
            <FileStack aria-hidden="true" size={22} />
            <div>
              <h2>{t("profiles.emptyTitle")}</h2>
              <p>{t("profiles.emptyBody")}</p>
            </div>
          </div>
        ) : (
          <div className="profile-list">
            {profiles.data.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                removable={hasSubscription && profile.source === "subscription"}
                disabled={pending || pendingProfile !== null}
                onRemove={() => void removeOne(profile)}
                onActivate={
                  profile.source === "subscription" && !profile.active
                    ? () => void activateOne(profile)
                    : undefined
                }
              />
            ))}
          </div>
        )}
        <SubscriptionUsagePanel />
      </section>

      {activeProfile ? (
        <OverridesPanel
          key={activeProfile.id}
          profile={activeProfile}
          disabled={pending}
          onSaved={() => {
            void profiles.reload();
            void stored.reload();
            setNotice(t("profiles.overridesSaved"));
          }}
        />
      ) : null}

      <section className="workspace-panel">
        <div className="workspace-panel-heading subscription-heading">
          <div>
            <span className="workspace-kicker">
              {t("profiles.subscriptionKicker")}
            </span>
            <h2>{t("profiles.subscriptionHeading")}</h2>
          </div>
          <div className="subscription-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "url"}
              className={mode === "url" ? "is-active" : undefined}
              onClick={() => setMode("url")}
            >
              <Link2 aria-hidden="true" size={14} /> {t("profiles.tabUrl")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "yaml"}
              className={mode === "yaml" ? "is-active" : undefined}
              onClick={() => setMode("yaml")}
            >
              <Upload aria-hidden="true" size={14} /> {t("profiles.tabYaml")}
            </button>
          </div>
        </div>
        <p className="workspace-hint">{t("profiles.subscriptionHint")}</p>
        {subscriptionProfiles.length > 0 ? (
          <p className="workspace-hint subscription-replace-hint">
            {t("profiles.addsAnother")}
          </p>
        ) : null}

          <div className="subscription-form">
          <label className="subscription-field">
            <span>{t("profiles.name")}</span>
            <input
              type="text"
              value={name}
              maxLength={120}
              placeholder={t("profiles.namePlaceholder")}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {mode === "url" ? (
            <label className="subscription-field">
              <span>{t("profiles.url")}</span>
              <input
                type="url"
                value={url}
                placeholder={t("profiles.urlPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                disabled={pending}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
          ) : (
            <label className="subscription-field subscription-field-wide">
              <span>{t("profiles.yaml")}</span>
              <textarea
                rows={8}
                value={yaml}
                placeholder={t("profiles.yamlPlaceholder")}
                spellCheck={false}
                disabled={pending}
                onChange={(event) => setYaml(event.target.value)}
              />
            </label>
          )}
        </div>

        {actionError ? (
          <ResourceFeedback error={actionError} unavailable={false} />
        ) : null}
        {notice ? (
          <div className="workspace-notice" role="status">
            {notice}
          </div>
        ) : null}

        {hasSubscription && refreshable ? (
          <div className="subscription-auto-update">
            <span className="subscription-auto-update-label">
              {t("profiles.autoUpdate")}
            </span>
            <p className="workspace-hint">
              {t("profiles.autoUpdateMoved")}
            </p>
          </div>
        ) : null}

        <div className="subscription-actions">
          <span className="subscription-actions-note">
            {t("profiles.importSupport")}
          </span>
          <button
            type="button"
            className="workspace-primary-button"
            disabled={pending}
            onClick={() => void submitImport()}
          >
            {pending ? t("profiles.importing") : t("profiles.import")}
          </button>
        </div>
      </section>
    </WorkspacePage>
  );
}

/**
 * Editor for the operator's overrides on the active subscription.
 *
 * Rules are stored one per line and inserted before the subscription's own
 * catch-all; the YAML box replaces whole top-level blocks. Both survive a
 * refresh, which is the point of keeping them beside the document rather than
 * inside it.
 */
function OverridesPanel({
  profile,
  disabled,
  onSaved,
}: {
  profile: ProfileInfo;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const stored = useBridgeResource(getSubscriptionSnapshot, true);
  const [rules, setRules] = useState(
    () => (stored.data?.override_rules ?? []).join("\n"),
  );
  const [yaml, setYaml] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const ruleList = rules
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      const rulesResult = await setSubscriptionRules(profile.id, ruleList);
      if (rulesResult.status !== "ok") {
        setError(
          rulesResult.status === "error"
            ? rulesResult.error.message
            : t("profiles.errorBridge"),
        );
        return;
      }
      const yamlResult = await setSubscriptionOverrideYaml(
        profile.id,
        yaml.trim() === "" ? null : yaml,
      );
      if (yamlResult.status !== "ok") {
        setError(
          yamlResult.status === "error"
            ? yamlResult.error.message
            : t("profiles.errorBridge"),
        );
        return;
      }
      onSaved();
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="workspace-panel overrides-panel">
      <div className="workspace-panel-heading">
        <div>
          <span className="workspace-kicker">{t("profiles.overrides")}</span>
          <h2>{t("profiles.overrides")}</h2>
        </div>
        <span className="workspace-icon-button" aria-hidden="true">
          <SlidersHorizontal size={15} />
        </span>
      </div>
      <p className="workspace-hint">{t("profiles.overridesHint")}</p>

      <div className="subscription-form overrides-form">
        <label className="subscription-field subscription-field-wide">
          <span>{t("profiles.overrideRules")}</span>
          <textarea
            rows={4}
            value={rules}
            spellCheck={false}
            placeholder={t("profiles.overrideRulesPlaceholder")}
            disabled={disabled || pending}
            onChange={(event) => setRules(event.target.value)}
          />
        </label>
        <label className="subscription-field subscription-field-wide">
          <span>{t("profiles.overrideYaml")}</span>
          <textarea
            rows={5}
            value={yaml}
            spellCheck={false}
            placeholder={t("profiles.overrideYamlPlaceholder")}
            disabled={disabled || pending}
            onChange={(event) => setYaml(event.target.value)}
          />
        </label>
      </div>
      <p className="settings-inline-hint">{t("profiles.overrideRulesHint")}</p>
      <p className="settings-inline-hint">{t("profiles.overrideYamlHint")}</p>

      {error ? (
        <ResourceFeedback
          error={{ code: "subscription_invalid", message: error, retryable: false }}
          unavailable={false}
        />
      ) : null}

      <div className="subscription-actions">
        <span className="subscription-actions-note">
          {t("profiles.overridesHint2")}
        </span>
        <button
          type="button"
          className="workspace-primary-button"
          disabled={disabled || pending}
          onClick={() => void save()}
        >
          {pending ? t("profiles.savingOverrides") : t("profiles.saveOverrides")}
        </button>
      </div>
    </section>
  );
}

function ProfileCard({
  profile,
  removable,
  disabled,
  onRemove,
  onActivate,
}: {
  profile: ProfileInfo;
  removable: boolean;
  disabled: boolean;
  onRemove: () => void;
  onActivate?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <article className="profile-card">
      <span className="profile-icon" aria-hidden="true">
        <FileStack size={19} />
      </span>
      <span className="profile-copy">
        <strong>{profile.name}</strong>
        <small>
          {profile.updated_at_ms === null
            ? t("profiles.updateUnavailable")
            : t("profiles.updated", {
                time: dateFormatter.format(profile.updated_at_ms),
              })}
          {typeof profile.proxy_count === "number"
            ? ` · ${t("profiles.proxyCount", { count: profile.proxy_count })}`
            : ""}
        </small>
      </span>
      {profile.active ? (
        <span className="profile-active">
          <CircleCheck aria-hidden="true" size={13} />
          {t("profiles.active")}
        </span>
      ) : null}
      {onActivate ? (
        <button
          type="button"
          className="workspace-action-button"
          disabled={disabled}
          onClick={onActivate}
        >
          {t("profiles.activate")}
        </button>
      ) : null}
      {removable ? (
        <button
          type="button"
          className="workspace-icon-button"
          aria-label={t("profiles.removeOne", { name: profile.name })}
          title={t("profiles.removeOne", { name: profile.name })}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      ) : null}
    </article>
  );
}