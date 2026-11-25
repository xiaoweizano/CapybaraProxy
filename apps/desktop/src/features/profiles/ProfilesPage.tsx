import {
  CircleCheck,
  FileStack,
  Link2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import {
  clearSubscription,
  getProfiles,
  importSubscription,
  importSubscriptionFromUrl,
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
  const { snapshot } = useRuntime();
  const profiles = useBridgeResource(getProfiles, true);
  const [mode, setMode] = useState<ImportMode>("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [yaml, setYaml] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<RuntimeError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasSubscription = (profiles.data ?? []).some(
    (profile): boolean => profile.source === "subscription",
  );
  const coreRunning = snapshot?.state === "connected";

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
      setNotice(t("profiles.noticeRemoved"));
    } finally {
      setPending(false);
    }
  }

  const showImportForm = !hasSubscription;

  return (
    <WorkspacePage
      eyebrow={t("profiles.eyebrow")}
      title={t("profiles.title")}
      badge={t("common.local")}
    >
      <ResourceFeedback
        error={profiles.error ?? actionError}
        unavailable={profiles.unavailable}
      />
      {notice ? (
        <div className="workspace-notice" role="status">
          {notice}
        </div>
      ) : null}

      <section className="workspace-panel">
        <div className="workspace-panel-heading">
          <div>
            <span className="workspace-kicker">{t("profiles.kicker")}</span>
            <h2>{t("profiles.heading")}</h2>
          </div>
          <button
            className="workspace-icon-button"
            type="button"
            aria-label={t("profiles.refresh")}
            title={t("profiles.refresh")}
            disabled={profiles.isLoading}
            onClick={() => void profiles.reload()}
          >
            <RefreshCw aria-hidden="true" size={15} />
          </button>
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

      {showImportForm ? (
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <div>
              <span className="workspace-kicker">
                {t("profiles.subscriptionKicker")}
              </span>
              <h2>{t("profiles.subscriptionHeading")}</h2>
            </div>
          </div>
          <p className="workspace-hint">{t("profiles.subscriptionHint")}</p>

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

          <div className="subscription-actions">
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
      ) : null}
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