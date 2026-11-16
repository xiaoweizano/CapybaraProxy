import { useEffect } from "react";
import { subscribeToNativeVisibility } from "../platform/tauri";
import {
  APP_VISIBILITY_EVENT,
  setAppVisibility,
  type AppVisibilityDetail,
} from "../shared/appVisibility";

export function useDocumentVisibility(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const updateFromDocument = () => {
      setAppVisibility(document.visibilityState === "hidden");
    };

    const updateFromNativeShell = (event: Event) => {
      const { hidden } = (event as CustomEvent<AppVisibilityDetail>).detail;

      if (typeof hidden === "boolean") {
        setAppVisibility(hidden || document.visibilityState === "hidden");
      }
    };

    updateFromDocument();
    document.addEventListener("visibilitychange", updateFromDocument);
    window.addEventListener(APP_VISIBILITY_EVENT, updateFromNativeShell);

    void subscribeToNativeVisibility((hidden) => {
      setAppVisibility(hidden || document.visibilityState === "hidden");
    })
      .then((disposeListener) => {
        if (disposed) {
          disposeListener();
        } else {
          unlisten = disposeListener;
        }
      })
      .catch((error: unknown) => {
        console.error("FlowProxy native visibility subscription failed", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("visibilitychange", updateFromDocument);
      window.removeEventListener(APP_VISIBILITY_EVENT, updateFromNativeShell);
      delete document.documentElement.dataset.appVisibility;
    };
  }, []);
}
