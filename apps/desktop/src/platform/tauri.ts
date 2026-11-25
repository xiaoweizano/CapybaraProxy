import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type NativeVisibilityPayload = boolean | { hidden: boolean };

export type NativeCommandName =
  | "get_runtime_snapshot"
  | "start_runtime"
  | "stop_runtime"
  | "restart_runtime"
  | "simulate_runtime_crash"
  | "get_core_info"
  | "get_telemetry"
  | "get_proxy_groups"
  | "select_proxy"
  | "test_proxy_delay"
  | "get_connections"
  | "close_connection"
  | "get_rules"
  | "get_profiles"
  | "get_subscription_snapshot"
  | "import_subscription"
  | "clear_subscription"
  | "get_runtime_logs"
  | "get_settings"
  | "save_settings"
  | "get_system_integration_status"
  | "set_system_proxy_enabled"
  | "set_launch_at_login_enabled"
  | "request_application_exit";

export type NativeEventName =
  | "app-visibility"
  | "runtime-state-changed"
  | "runtime-log"
  | "system-integration-changed";

export type NativeBridgeError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type NativeCommandResult =
  | { status: "ok"; data: unknown }
  | { status: "error"; error: NativeBridgeError }
  | { status: "unavailable" };

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNativeBridgeError(value: unknown): value is NativeBridgeError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    typeof value.retryable === "boolean"
  );
}

function invalidNativeResponse(message: string): NativeCommandResult {
  return {
    status: "error",
    error: {
      code: "internal",
      message,
      retryable: true,
    },
  };
}

function parseNativeCommandResult(value: unknown): NativeCommandResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return invalidNativeResponse(
      "FlowProxy received an invalid desktop response.",
    );
  }

  if (value.ok && "data" in value) {
    return { status: "ok", data: value.data };
  }

  if (!value.ok && isNativeBridgeError(value.error)) {
    return { status: "error", error: value.error };
  }

  return invalidNativeResponse(
    "FlowProxy received an invalid desktop response.",
  );
}

export async function invokeNativeCommand(
  command: NativeCommandName,
  args?: Record<string, unknown>,
): Promise<NativeCommandResult> {
  if (!isTauriRuntime()) {
    return { status: "unavailable" };
  }

  try {
    const response = await invoke<unknown>(command, args);
    return parseNativeCommandResult(response);
  } catch {
    return {
      status: "error",
      error: {
        code: "internal",
        message: "FlowProxy could not contact the desktop Runtime.",
        retryable: true,
      },
    };
  }
}

export async function listenNativeEvent(
  eventName: NativeEventName,
  listener: (payload: unknown) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  let active = true;
  const unlisten = await listen<unknown>(eventName, (event) => {
    if (active) {
      listener(event.payload);
    }
  });

  return () => {
    if (!active) {
      return;
    }

    active = false;
    unlisten();
  };
}

export async function minimizeWindow(): Promise<void> {
  if (isTauriRuntime()) {
    await getCurrentWindow().minimize();
  }
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (isTauriRuntime()) {
    await getCurrentWindow().toggleMaximize();
  }
}

export async function closeWindow(): Promise<void> {
  if (isTauriRuntime()) {
    await getCurrentWindow().close();
  }
}

export async function subscribeToNativeVisibility(
  listener: (hidden: boolean) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  return listen<NativeVisibilityPayload>("app-visibility", (event) => {
    const hidden =
      typeof event.payload === "boolean"
        ? event.payload
        : event.payload.hidden;

    if (typeof hidden === "boolean") {
      listener(hidden);
    }
  });
}
