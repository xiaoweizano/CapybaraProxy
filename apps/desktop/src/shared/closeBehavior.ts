export const CLOSE_BEHAVIOR_STORAGE_KEY = "capybara.closeBehavior";

export type CloseBehavior = "hide_to_tray" | "exit_application";

type CloseBehaviorReader = {
  getItem(key: string): string | null;
};

type CloseBehaviorWriter = {
  setItem(key: string, value: string): void;
};

export function parseCloseBehavior(value: string | null): CloseBehavior {
  return value === "exit_application" ? "exit_application" : "hide_to_tray";
}

export function readStoredCloseBehavior(
  storage: CloseBehaviorReader,
): CloseBehavior {
  return parseCloseBehavior(storage.getItem(CLOSE_BEHAVIOR_STORAGE_KEY));
}

export function writeStoredCloseBehavior(
  storage: CloseBehaviorWriter,
  behavior: CloseBehavior,
): void {
  storage.setItem(CLOSE_BEHAVIOR_STORAGE_KEY, behavior);
}
