import { Minus, Square, X } from "lucide-react";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../../platform/tauri";

function runWindowAction(action: () => Promise<void>): void {
  void Promise.resolve()
    .then(action)
    .catch((error: unknown) => {
      console.error("FlowProxy window action failed", error);
    });
}

export function WindowControls() {
  return (
    <div className="window-controls" aria-label="Window controls">
      <button
        className="window-control"
        type="button"
        aria-label="Minimize window"
        onClick={() => runWindowAction(minimizeWindow)}
      >
        <Minus aria-hidden="true" size={14} strokeWidth={1.8} />
      </button>
      <button
        className="window-control"
        type="button"
        aria-label="Maximize window"
        onClick={() => runWindowAction(toggleMaximizeWindow)}
      >
        <Square aria-hidden="true" size={11} strokeWidth={1.7} />
      </button>
      <button
        className="window-control window-control-close"
        type="button"
        aria-label="Close window"
        onClick={() => runWindowAction(closeWindow)}
      >
        <X aria-hidden="true" size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
}
