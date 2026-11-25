import { CircleAlert, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RuntimeError } from "../../platform/runtime";

export function WorkspacePage({
  eyebrow,
  title,
  badge,
  children,
}: {
  eyebrow: string;
  title: string;
  badge: string;
  children: ReactNode;
}) {
  return (
    <section className="workspace-page" aria-labelledby="workspace-page-title">
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">{eyebrow}</span>
          <h1 id="workspace-page-title">{title}</h1>
        </div>
        <span className="workspace-live-badge">{badge}</span>
      </div>
      {children}
    </section>
  );
}

export function ResourceFeedback({
  error,
  unavailable,
}: {
  error: RuntimeError | null;
  unavailable: boolean;
}) {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className="workspace-feedback workspace-feedback-error" role="alert">
        <CircleAlert aria-hidden="true" size={16} />
        <span>{error.message}</span>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="workspace-feedback" role="status">
        <WifiOff aria-hidden="true" size={16} />
        <span>{t("workspace.unavailable")}</span>
      </div>
    );
  }

  return null;
}

export function RuntimeDisconnected() {
  const { t } = useTranslation();

  return (
    <div className="workspace-empty workspace-empty-large">
      <span className="workspace-empty-icon">
        <WifiOff aria-hidden="true" size={25} strokeWidth={1.5} />
      </span>
      <div>
        <h2>{t("workspace.disconnectedTitle")}</h2>
        <p>{t("workspace.disconnectedBody")}</p>
      </div>
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="workspace-loading" role="status">
      <LoaderCircle aria-hidden="true" size={17} />
      <span>{label}</span>
    </div>
  );
}

export function RefreshButton({
  isLoading,
  onClick,
  label = "Refresh",
}: {
  isLoading: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      className="workspace-icon-button"
      type="button"
      aria-label={label}
      title={label}
      disabled={isLoading}
      onClick={onClick}
    >
      <RefreshCw aria-hidden="true" size={15} />
    </button>
  );
}
