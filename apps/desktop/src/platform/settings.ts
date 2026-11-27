import type { ThemeId } from "../app/theme/theme";
import type { CloseBehavior } from "../shared/closeBehavior";
import type { LanguageId } from "../i18n/language";
import { invokeNativeCommand, type NativeBridgeError } from "./tauri";

export type SettingsMode = "simple" | "standard" | "relaxed";
export type TraySpeedDisplay = "icon" | "tooltip" | "off";
export type MotionPreference = "full" | "reduced";

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
  /** Refresh the stored subscription once, right after launch. */
  update_subscription_on_launch?: boolean;
  /** How many settings groups the Settings page shows. */
  settings_mode?: SettingsMode;
  /** Start with the main window hidden so only the tray icon appears. */
  silent_start?: boolean;
  /** Interface animation preference. */
  motion?: MotionPreference;
  /** Show the connection state and current node in the tray. */
  tray_show_info?: boolean;
  /** What the tray icon does with the live transfer rate. */
  tray_speed_display?: TraySpeedDisplay;
  /** Mirror Runtime events into a rotating log file. */
  log_to_file?: boolean;
  /** How many days of log files are kept. */
  log_retention_days?: number;
  /** Merge latency measurements before displaying them. */
  unified_delay?: boolean;
  /** Allow several parallel connections to one host. */
  tcp_concurrent?: boolean;
  /** Fixed mixed-port; `null` picks a free port on every start. */
  fixed_proxy_port?: number | null;
  /** Base URL of an external Sub-Store backend. */
  substore_url?: string;
  /** Token sent to the Sub-Store backend as `x-api-token`. */
  substore_token?: string;
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
    (value.update_subscription_on_launch === undefined ||
      typeof value.update_subscription_on_launch === "boolean") &&
    (value.settings_mode === undefined ||
      value.settings_mode === "simple" ||
      value.settings_mode === "standard" ||
      value.settings_mode === "relaxed") &&
    (value.silent_start === undefined ||
      typeof value.silent_start === "boolean") &&
    (value.motion === undefined ||
      value.motion === "full" ||
      value.motion === "reduced") &&
    (value.tray_show_info === undefined ||
      typeof value.tray_show_info === "boolean") &&
    (value.tray_speed_display === undefined ||
      value.tray_speed_display === "icon" ||
      value.tray_speed_display === "tooltip" ||
      value.tray_speed_display === "off") &&
    (value.log_to_file === undefined ||
      typeof value.log_to_file === "boolean") &&
    (value.log_retention_days === undefined ||
      typeof value.log_retention_days === "number") &&
    (value.unified_delay === undefined ||
      typeof value.unified_delay === "boolean") &&
    (value.tcp_concurrent === undefined ||
      typeof value.tcp_concurrent === "boolean") &&
    (value.fixed_proxy_port === undefined ||
      value.fixed_proxy_port === null ||
      typeof value.fixed_proxy_port === "number") &&
    (value.substore_url === undefined ||
      typeof value.substore_url === "string") &&
    (value.substore_token === undefined ||
      typeof value.substore_token === "string") &&
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
