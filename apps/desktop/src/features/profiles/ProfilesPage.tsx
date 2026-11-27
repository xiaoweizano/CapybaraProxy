import {
  CircleCheck,
  FileStack,
  Link2,
  RefreshCw,
  Timer,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import {
  clearSubscription,
  getProfiles,
  getSubscriptionSnapshot,
  importSubscription,
  importSubscriptionFromUrl,
  refreshSubscription,
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

  async function removeSubscription(): Promise<void> {
    setActionError(null);
    setNotice(null);
    setPending(true);
    try {
      const result = await clearSubscription();
      if (result.status === "error") {
        setActionError(result.error);
        return;
      }
      if (result.status === "unavailable") {
        setActionError({
          code: "internal",
          message: t("profiles.errorBridge"),
          retryable: true,
        });
        return;
      }
      await profiles.reload();
      await stored.reload();
      setNotice(t("profiles.noticeRemoved"));
    } finally {
      setPending(false);
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
                disabled={pending}
                onRemove={() => void removeSubscription()}
              />
            ))}
          </div>
        )}
      </section>

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
        {hasSubscription ? (
          <p className="workspace-hint subscription-replace-hint">
            {t("profiles.replacesCurrent")}
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

function ProfileCard({
  profile,
  removable,
  disabled,
  onRemove,
}: {
  profile: ProfileInfo;
  removable: boolean;
  disabled: boolean;
  onRemove: () => void;
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
      {removable ? (
        <button
          type="button"
          className="workspace-icon-button"
          aria-label={t("profiles.remove")}
          title={t("profiles.remove")}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      ) : null}
    </article>
  );
}