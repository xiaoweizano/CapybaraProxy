import type { RuntimeError, RuntimeErrorCode } from "./runtime";
import { invokeNativeCommand, listenNativeEvent } from "./tauri";

export type PlatformKind = "windows" | "macos" | "linux";
export type CapabilityState =
  | "available"
  | "blocked"
  | "unsupported"
  | "unverified";
export type SystemProxyState =
  | "disabled"
  | "enabled"
  | "managed_inactive";
export type LaunchAtLoginState =
  | "disabled"
  | "enabled"
  | "conflict";

export type CapabilityStatus = {
  state: CapabilityState;
  message: string;
};

export type PlatformCapabilities = {
  system_proxy: CapabilityStatus;
  launch_at_login: CapabilityStatus;
  tun: CapabilityStatus;
};

export type SystemIntegrationStatus = {
  platform: PlatformKind;
  capabilities: PlatformCapabilities;
  system_proxy: {
    state: SystemProxyState;
    managed: boolean;
    active: boolean;
  };
  launch_at_login: {
    state: LaunchAtLoginState;
    enabled: boolean;
  };
  last_error: RuntimeError | null;
};

export type SystemIntegrationEvent =
  | { kind: "status"; status: SystemIntegrationStatus }
  | { kind: "error"; error: RuntimeError };

export type SystemIntegrationBridgeResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: RuntimeError }
  | { status: "unavailable" };

const capabilityStates = new Set<CapabilityState>([
  "available",
  "blocked",
  "unsupported",
  "unverified",
]);
const platforms = new Set<PlatformKind>(["windows", "macos", "linux"]);
const proxyStates = new Set<SystemProxyState>([
  "disabled",
  "enabled",
  "managed_inactive",
]);
const loginStates = new Set<LaunchAtLoginState>([
  "disabled",
  "enabled",
  "conflict",
]);
const runtimeErrorCodes = new Set<RuntimeErrorCode>([
  "already_running",
  "not_running",
  "invalid_state",
  "adapter_failure",
  "core_unavailable",
  "config_invalid",
  "api_unavailable",
  "selection_failed",
  "connection_not_found",
  "permission_required",
  "settings_io",
  "platform_integration",
  "internal",
]);
const MAX_MESSAGE_LENGTH = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key));
}

function isSafeMessage(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MESSAGE_LENGTH
  ) {
    return false;
  }

  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 0x1f && codePoint !== 0x7f;
  });
}

function isRuntimeErrorCode(value: unknown): value is RuntimeErrorCode {
  return (
    typeof value === "string" &&
    runtimeErrorCodes.has(value as RuntimeErrorCode)
  );
}

function isRuntimeError(value: unknown): value is RuntimeError {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["code", "message", "retryable"]) &&
    isRuntimeErrorCode(value.code) &&
    isSafeMessage(value.message) &&
    typeof value.retryable === "boolean"
  );
}

function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["state", "message"]) &&
    typeof value.state === "string" &&
    capabilityStates.has(value.state as CapabilityState) &&
    isSafeMessage(value.message)
  );
}

function isPlatformCapabilities(
  value: unknown,
): value is PlatformCapabilities {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["system_proxy", "launch_at_login", "tun"]) &&
    isCapabilityStatus(value.system_proxy) &&
    isCapabilityStatus(value.launch_at_login) &&
    isCapabilityStatus(value.tun)
  );
}

function isSystemIntegrationStatus(
  value: unknown,
): value is SystemIntegrationStatus {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "platform",
      "capabilities",
      "system_proxy",
      "launch_at_login",
      "last_error",
    ]) ||
    typeof value.platform !== "string" ||
    !platforms.has(value.platform as PlatformKind) ||
    !isPlatformCapabilities(value.capabilities) ||
    !isRecord(value.system_proxy) ||
    !hasOnlyKeys(value.system_proxy, ["state", "managed", "active"]) ||
    typeof value.system_proxy.state !== "string" ||
    !proxyStates.has(value.system_proxy.state as SystemProxyState) ||
    typeof value.system_proxy.managed !== "boolean" ||
    typeof value.system_proxy.active !== "boolean" ||
    !isRecord(value.launch_at_login) ||
    !hasOnlyKeys(value.launch_at_login, ["state", "enabled"]) ||
    typeof value.launch_at_login.state !== "string" ||
    !loginStates.has(value.launch_at_login.state as LaunchAtLoginState) ||
    typeof value.launch_at_login.enabled !== "boolean"
  ) {
    return false;
  }

  return value.last_error === null || isRuntimeError(value.last_error);
}

function isSystemIntegrationEvent(
  value: unknown,
): value is SystemIntegrationEvent {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "status") {
    return (
      hasOnlyKeys(value, ["kind", "status"]) &&
      isSystemIntegrationStatus(value.status)
    );
  }

  if (value.kind === "error") {
    return (
      hasOnlyKeys(value, ["kind", "error"]) &&
      isRuntimeError(value.error)
    );
  }

  return false;
}

function invalidIntegrationResponse<T>(): SystemIntegrationBridgeResult<T> {
  return {
    status: "error",
    error: {
      code: "internal",
      message: "FlowProxy received an invalid system integration response.",
      retryable: true,
    },
  };
}

async function executeIntegrationCommand(
  command:
    | "get_system_integration_status"
    | "set_system_proxy_enabled"
    | "set_launch_at_login_enabled",
  args?: Record<string, unknown>,
): Promise<SystemIntegrationBridgeResult<SystemIntegrationStatus>> {
  const result = await invokeNativeCommand(command, args);

  if (result.status === "unavailable") {
    return result;
  }

  if (result.status === "error") {
    return isRuntimeError(result.error)
      ? { status: "error", error: result.error }
      : invalidIntegrationResponse();
  }

  return isSystemIntegrationStatus(result.data)
    ? { status: "ok", data: result.data }
    : invalidIntegrationResponse();
}

export function getSystemIntegrationStatus(): Promise<
  SystemIntegrationBridgeResult<SystemIntegrationStatus>
> {
  return executeIntegrationCommand("get_system_integration_status");
}

export function setSystemProxyEnabled(
  enabled: boolean,
): Promise<SystemIntegrationBridgeResult<SystemIntegrationStatus>> {
  return executeIntegrationCommand("set_system_proxy_enabled", { enabled });
}

export function setLaunchAtLoginEnabled(
  enabled: boolean,
): Promise<SystemIntegrationBridgeResult<SystemIntegrationStatus>> {
  return executeIntegrationCommand("set_launch_at_login_enabled", {
    enabled,
  });
}

export function subscribeSystemIntegration(
  listener: (event: SystemIntegrationEvent) => void,
): Promise<() => void> {
  return listenNativeEvent("system-integration-changed", (payload) => {
    if (isSystemIntegrationEvent(payload)) {
      listener(payload);
    }
  });
}
