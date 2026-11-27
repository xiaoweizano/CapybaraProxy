import { Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../../platform/tauri";

function runWindowAction(action: () => Promise<void>): void {
  void Promise.resolve()
    .then(action)
    .catch((error: unknown) => {
      console.error("CapybaraProxy window action failed", error);
    });
}

export function WindowControls() {
  const { t } = useTranslation();

  return (
    <div className="window-controls" aria-label={t("shell.windowControls")}>
      <button
        className="window-control"
        type="button"
        aria-label={t("shell.minimize")}
        onClick={() => runWindowAction(minimizeWindow)}
      >
        <Minus aria-hidden="true" size={14} strokeWidth={1.8} />
      </button>
      <button
        className="window-control"
        type="button"
        aria-label={t("shell.maximize")}
        onClick={() => runWindowAction(toggleMaximizeWindow)}
      >
        <Square aria-hidden="true" size={11} strokeWidth={1.7} />
      </button>
      <button
        className="window-control window-control-close"
        type="button"
        aria-label={t("shell.close")}
        onClick={() => runWindowAction(closeWindow)}
      >
        <X aria-hidden="true" size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
}
