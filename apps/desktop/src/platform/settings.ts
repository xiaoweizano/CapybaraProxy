import type { ThemeId } from "../app/theme/theme";
import type { CloseBehavior } from "../shared/closeBehavior";
import type { LanguageId } from "../i18n/language";
import { invokeNativeCommand, type NativeBridgeError } from "./tauri";

export type DesktopSettings = {
  version: 1;
  theme: ThemeId;
  close_behavior: CloseBehavior;
  /** Optional because builds before the field existed do not send it. */
  language?: LanguageId;
  /** Interface scale in percent; 100 is the default. */
  ui_scale?: number;
  /** Core log verbosity baked into the generated profile. */
  log_level?: "silent" | "error" | "warning" | "info" | "debug";
  /** Whether the core may use IPv6. */
  ipv6?: boolean;
  /** URL the core requests to measure node latency. */
  delay_probe_url?: string;
  /** Latency probe timeout in milliseconds. */
  delay_timeout_ms?: number;
  /** Automatic subscription refresh interval in hours; 0 disables it. */
  subscription_update_hours?: number;
  /** Remembered window size in physical pixels. */
  window_width?: number | null;
  window_height?: number | null;
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
      value.close_behavior === "exit_application") &&
    (value.language === undefined ||
      value.language === "english" ||
      value.language === "simplified_chinese") &&
    (value.ui_scale === undefined || typeof value.ui_scale === "number") &&
    (value.log_level === undefined ||
      value.log_level === "silent" ||
      value.log_level === "error" ||
      value.log_level === "warning" ||
      value.log_level === "info" ||
      value.log_level === "debug") &&
    (value.ipv6 === undefined || typeof value.ipv6 === "boolean") &&
    (value.delay_probe_url === undefined ||
      typeof value.delay_probe_url === "string") &&
    (value.delay_timeout_ms === undefined ||
      typeof value.delay_timeout_ms === "number") &&
    (value.subscription_update_hours === undefined ||
      typeof value.subscription_update_hours === "number") &&
    (value.window_width === undefined ||
      value.window_width === null ||
      typeof value.window_width === "number") &&
    (value.window_height === undefined ||
      value.window_height === null ||
      typeof value.window_height === "number")
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

/**
 * Asks the native shell to zoom the webview.
 *
 * The stylesheets already scale off the root font size; this keeps scrollbars
 * and pointer targets in step. It is best-effort: a preview build has no
 * webview to zoom, and the CSS scale still applies.
 */
export async function applyNativeUiScale(scale: number): Promise<void> {
  await invokeNativeCommand("apply_ui_scale", { scale }).catch(() => undefined);
}
