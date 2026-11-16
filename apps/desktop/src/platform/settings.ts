import type { ThemeId } from "../app/theme/theme";
import type { CloseBehavior } from "../shared/closeBehavior";
import { invokeNativeCommand, type NativeBridgeError } from "./tauri";

export type DesktopSettings = {
  version: 1;
  theme: ThemeId;
  close_behavior: CloseBehavior;
};

export type SettingsBridgeResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: NativeBridgeError }
  | { status: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDesktopSettings(value: unknown): value is DesktopSettings {
  return (
    isRecord(value) &&
    value.version === 1 &&
    (value.theme === "cyber_flow" || value.theme === "warm_flow") &&
    (value.close_behavior === "hide_to_tray" ||
      value.close_behavior === "exit_application")
  );
}

function invalidSettingsResponse<T>(): SettingsBridgeResult<T> {
  return {
    status: "error",
    error: {
      code: "internal",
      message: "FlowProxy received an invalid settings response.",
      retryable: true,
    },
  };
}

function mapSettingsError<T>(
  error: NativeBridgeError,
): SettingsBridgeResult<T> {
  if (error.code === "settings_io" || error.code === "internal") {
    return { status: "error", error };
  }

  return invalidSettingsResponse<T>();
}

function parseSettingsResult(
  result:
    | { status: "ok"; data: unknown }
    | { status: "error"; error: NativeBridgeError }
    | { status: "unavailable" },
): SettingsBridgeResult<DesktopSettings> {
  if (result.status !== "ok") {
    return result.status === "error"
      ? mapSettingsError(result.error)
      : result;
  }

  if (!isDesktopSettings(result.data)) {
    return invalidSettingsResponse();
  }

  return { status: "ok", data: result.data };
}

export async function getSettings(): Promise<
  SettingsBridgeResult<DesktopSettings>
> {
  return parseSettingsResult(await invokeNativeCommand("get_settings"));
}

export async function saveSettings(
  settings: DesktopSettings,
): Promise<SettingsBridgeResult<DesktopSettings>> {
  return parseSettingsResult(
    await invokeNativeCommand("save_settings", { settings }),
  );
}
