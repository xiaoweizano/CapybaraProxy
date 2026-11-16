export const APP_VISIBILITY_EVENT = "flowproxy:app-visibility";

export type AppVisibilityDetail = {
  hidden: boolean;
};

export function isAppHidden(): boolean {
  return (
    document.visibilityState === "hidden" ||
    document.documentElement.dataset.appVisibility === "hidden"
  );
}

export function setAppVisibility(hidden: boolean): void {
  const nextVisibility = hidden ? "hidden" : "visible";

  if (document.documentElement.dataset.appVisibility === nextVisibility) {
    return;
  }

  document.documentElement.dataset.appVisibility = nextVisibility;

  window.dispatchEvent(
    new CustomEvent<AppVisibilityDetail>(APP_VISIBILITY_EVENT, {
      detail: { hidden },
    }),
  );
}
