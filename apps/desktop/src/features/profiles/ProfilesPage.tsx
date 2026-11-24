import {
  CircleCheck,
  FileStack,
  Link2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
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

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type ImportMode = "url" | "yaml";

export function ProfilesPage() {
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
        message: "Give the subscription a name first.",
        retryable: false,
      });
      return;
    }
    if (mode === "url" && trimmedUrl.length === 0) {
      setActionError({
        code: "subscription_invalid",
        message: "Paste a subscription URL first.",
        retryable: false,
      });
      return;
    }
    if (mode === "yaml" && yaml.trim().length === 0) {
      setActionError({
        code: "subscription_invalid",
        message: "Paste the subscription YAML first.",
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
          message: "The native bridge is unavailable in this build.",
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
          ? "Subscription imported. Restart the Runtime to load its nodes."
          : "Subscription imported. Start the Runtime to load its nodes.",
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
          message: "The native bridge is unavailable in this build.",
          retryable: true,
        });
        return;
      }
      await profiles.reload();
      setNotice("Subscription removed. The direct profile is active again.");
    } finally {
      setPending(false);
    }
  }

  const showImportForm = !hasSubscription;

  return (
    <WorkspacePage eyebrow="Configuration" title="Profiles" badge="Local">
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
            <span className="workspace-kicker">Mihomo profiles</span>
            <h2>Available configurations</h2>
          </div>
          <button
            className="workspace-icon-button"
            type="button"
            aria-label="Refresh profiles"
            title="Refresh profiles"
            disabled={profiles.isLoading}
            onClick={() => void profiles.reload()}
          >
            <RefreshCw aria-hidden="true" size={15} />
          </button>
        </div>

        {profiles.isLoading && profiles.data === null ? (
          <LoadingState label="Loading profiles..." />
        ) : !profiles.data?.length ? (
          <div className="workspace-empty">
            <FileStack aria-hidden="true" size={22} />
            <div>
              <h2>No profiles reported</h2>
              <p>Mihomo did not expose any profile metadata.</p>
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
              <span className="workspace-kicker">Subscription</span>
              <h2>Import a subscription</h2>
            </div>
          </div>
          <p className="workspace-hint">
            FlowProxy keeps the control endpoint, API secret and proxy port
            under its own policy. Everything else in the subscription is used
            unchanged.
          </p>

          <div className="subscription-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "url"}
              className={mode === "url" ? "is-active" : undefined}
              onClick={() => setMode("url")}
            >
              <Link2 aria-hidden="true" size={14} /> From a URL
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "yaml"}
              className={mode === "yaml" ? "is-active" : undefined}
              onClick={() => setMode("yaml")}
            >
              <Upload aria-hidden="true" size={14} /> Paste YAML
            </button>
          </div>

          <label className="subscription-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              maxLength={120}
              placeholder="My provider"
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {mode === "url" ? (
            <label className="subscription-field">
              <span>Subscription URL</span>
              <input
                type="url"
                value={url}
                placeholder="https://provider.example.com/subscribe?token=..."
                spellCheck={false}
                autoComplete="off"
                disabled={pending}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
          ) : (
            <label className="subscription-field">
              <span>Subscription YAML</span>
              <textarea
                rows={10}
                value={yaml}
                placeholder={"proxies:\n  - name: Tokyo 01\n    type: ss\n    ..."}
                spellCheck={false}
                disabled={pending}
                onChange={(event) => setYaml(event.target.value)}
              />
            </label>
          )}

          <div className="workspace-panel-actions">
            <button
              type="button"
              className="workspace-primary-button"
              disabled={pending}
              onClick={() => void submitImport()}
            >
              {pending ? "Importing..." : "Import subscription"}
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
  return (
    <article className="profile-card">
      <span className="profile-icon" aria-hidden="true">
        <FileStack size={19} />
      </span>
      <span className="profile-copy">
        <strong>{profile.name}</strong>
        <small>
          {profile.updated_at_ms === null
            ? "Update time unavailable"
            : `Updated ${dateFormatter.format(profile.updated_at_ms)}`}
          {typeof profile.proxy_count === "number"
            ? ` · ${profile.proxy_count} proxies`
            : ""}
        </small>
      </span>
      {profile.active ? (
        <span className="profile-active">
          <CircleCheck aria-hidden="true" size={13} />
          Active
        </span>
      ) : null}
      {removable ? (
        <button
          type="button"
          className="workspace-icon-button"
          aria-label="Remove subscription"
          title="Remove subscription"
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      ) : null}
    </article>
  );
}
