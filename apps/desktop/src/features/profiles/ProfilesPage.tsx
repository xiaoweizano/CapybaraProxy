import { CircleCheck, FileStack, RefreshCw } from "lucide-react";
import { useRuntime } from "../../app/runtime/runtimeContext";
import { useBridgeResource } from "../../app/runtime/useBridgeResource";
import { getProfiles } from "../../platform/runtime";
import {
  LoadingState,
  ResourceFeedback,
  RuntimeDisconnected,
  WorkspacePage,
} from "../workspace/WorkspaceUi";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ProfilesPage() {
  const { snapshot } = useRuntime();
  const isConnected = snapshot?.state === "connected";
  const profiles = useBridgeResource(getProfiles, isConnected);

  return (
    <WorkspacePage
      eyebrow="Configuration"
      title="Profiles"
      badge={isConnected ? "Live Mihomo" : "Offline"}
    >
      <ResourceFeedback
        error={profiles.error}
        unavailable={profiles.unavailable}
      />

      {!isConnected ? (
        <RuntimeDisconnected />
      ) : (
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
                <article className="profile-card" key={profile.id}>
                  <span className="profile-icon" aria-hidden="true">
                    <FileStack size={19} />
                  </span>
                  <span className="profile-copy">
                    <strong>{profile.name}</strong>
                    <small>
                      {profile.updated_at_ms === null
                        ? "Update time unavailable"
                        : `Updated ${dateFormatter.format(profile.updated_at_ms)}`}
                    </small>
                  </span>
                  {profile.active ? (
                    <span className="profile-active">
                      <CircleCheck aria-hidden="true" size={13} />
                      Active
                    </span>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </WorkspacePage>
  );
}
