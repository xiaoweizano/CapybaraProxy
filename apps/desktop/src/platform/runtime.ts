import { invokeNativeCommand, listenNativeEvent } from "./tauri";

export type RuntimeBackend = "demo" | "mihomo";

export type RuntimeState =
  | "stopped"
  | "starting"
  | "running_disconnected"
  | "connected"
  | "stopping"
  | "error"
  | "permission_required";

export type RuntimeErrorCode =
  | "already_running"
  | "not_running"
  | "invalid_state"
  | "adapter_failure"
  | "core_unavailable"
  | "config_invalid"
  | "api_unavailable"
  | "selection_failed"
  | "connection_not_found"
  | "permission_required"
  | "settings_io"
  | "platform_integration"
  | "subscription_invalid"
  | "internal";

export type RuntimeError = {
  code: RuntimeErrorCode;
  message: string;
  retryable: boolean;
};

export type RuntimeSnapshot = {
  backend: RuntimeBackend;
  state: RuntimeState;
  sequence: number;
  started_at_ms: number | null;
  last_error: RuntimeError | null;
  log_count: number;
};

export type RuntimeLogLevel = "info" | "warn" | "error";

export type RuntimeLogEntry = {
  sequence: number;
  timestamp_ms: number;
  level: RuntimeLogLevel;
  message: string;
  error_code: RuntimeErrorCode | null;
};

export type RuntimeBridgeResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: RuntimeError }
  | { status: "unavailable" };

export type CoreInfo = {
  backend: RuntimeBackend;
  version: string;
  pid: number | null;
};

export type ProxyNode = {
  name: string;
  proxy_type: string;
  udp: boolean;
  delay_ms: number | null;
  alive: boolean;
};

export type ProxyGroup = {
  name: string;
  group_type: string;
  selected: string;
  nodes: ProxyNode[];
};

export type TelemetrySnapshot = {
  state: RuntimeState;
  timestamp_ms: number;
  upload_bps: number;
  download_bps: number;
  total_upload_bytes: number;
  total_download_bytes: number;
  memory_bytes: number;
  active_connections: number;
};

export type ConnectionSummary = {
  id: string;
  host: string;
  destination_ip: string;
  destination_port: number;
  network: string;
  rule: string;
  rule_payload: string;
  chains: string[];
  upload_bytes: number;
  download_bytes: number;
  started_at_ms: number;
};

export type ConnectionPage = {
  upload_total_bytes: number;
  download_total_bytes: number;
  memory_bytes: number;
  connections: ConnectionSummary[];
};

export type RuleItem = {
  index: number;
  rule_type: string;
  payload: string;
  proxy: string;
};

export type ProfileInfo = {
  id: string;
  name: string;
  active: boolean;
  updated_at_ms: number | null;
  source: string | null;
  proxy_count: number | null;
};

/**
 * Groups and rules read from the stored subscription while the Runtime is
 * stopped. Read-only: it never reflects a running core.
 */
export type SubscriptionSnapshot = {
  groups: ProxyGroup[];
  rules: RuleItem[];
  has_subscription: boolean;
};

const runtimeStates = new Set<RuntimeState>([
  "stopped",
  "starting",
  "running_disconnected",
  "connected",
  "stopping",
  "error",
  "permission_required",
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
  "subscription_invalid",
  "internal",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
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
    isRuntimeErrorCode(value.code) &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    typeof value.retryable === "boolean"
  );
}

function isRuntimeSnapshot(value: unknown): value is RuntimeSnapshot {
  return (
    isRecord(value) &&
    (value.backend === "demo" || value.backend === "mihomo") &&
    typeof value.state === "string" &&
    runtimeStates.has(value.state as RuntimeState) &&
    isNonNegativeInteger(value.sequence) &&
    (value.started_at_ms === null ||
      Number.isInteger(value.started_at_ms)) &&
    (value.last_error === null || isRuntimeError(value.last_error)) &&
    isNonNegativeInteger(value.log_count)
  );
}

function isRuntimeLogEntry(value: unknown): value is RuntimeLogEntry {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.sequence) &&
    Number.isInteger(value.timestamp_ms) &&
    (value.level === "info" ||
      value.level === "warn" ||
      value.level === "error") &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    (value.error_code === null ||
      isRuntimeErrorCode(value.error_code))
  );
}

function isRuntimeBackend(value: unknown): value is RuntimeBackend {
  return value === "demo" || value === "mihomo";
}

function isCoreInfo(value: unknown): value is CoreInfo {
  return (
    isRecord(value) &&
    isRuntimeBackend(value.backend) &&
    isString(value.version) &&
    (value.pid === null || isNonNegativeInteger(value.pid))
  );
}

function isProxyNode(value: unknown): value is ProxyNode {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.proxy_type) &&
    typeof value.udp === "boolean" &&
    (value.delay_ms === null || isNonNegativeInteger(value.delay_ms)) &&
    typeof value.alive === "boolean"
  );
}

function isProxyGroup(value: unknown): value is ProxyGroup {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.group_type) &&
    isString(value.selected) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isProxyNode)
  );
}

function isTelemetrySnapshot(value: unknown): value is TelemetrySnapshot {
  return (
    isRecord(value) &&
    typeof value.state === "string" &&
    runtimeStates.has(value.state as RuntimeState) &&
    Number.isInteger(value.timestamp_ms) &&
    isNonNegativeInteger(value.upload_bps) &&
    isNonNegativeInteger(value.download_bps) &&
    isNonNegativeInteger(value.total_upload_bytes) &&
    isNonNegativeInteger(value.total_download_bytes) &&
    isNonNegativeInteger(value.memory_bytes) &&
    isNonNegativeInteger(value.active_connections)
  );
}

function isConnectionSummary(value: unknown): value is ConnectionSummary {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.host) &&
    isString(value.destination_ip) &&
    isNonNegativeInteger(value.destination_port) &&
    value.destination_port <= 65_535 &&
    isString(value.network) &&
    isString(value.rule) &&
    isString(value.rule_payload) &&
    Array.isArray(value.chains) &&
    value.chains.every(isString) &&
    isNonNegativeInteger(value.upload_bytes) &&
    isNonNegativeInteger(value.download_bytes) &&
    Number.isInteger(value.started_at_ms)
  );
}

function isConnectionPage(value: unknown): value is ConnectionPage {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.upload_total_bytes) &&
    isNonNegativeInteger(value.download_total_bytes) &&
    isNonNegativeInteger(value.memory_bytes) &&
    Array.isArray(value.connections) &&
    value.connections.every(isConnectionSummary)
  );
}

function isRuleItem(value: unknown): value is RuleItem {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.index) &&
    isString(value.rule_type) &&
    isString(value.payload) &&
    isString(value.proxy)
  );
}

function isProfileInfo(value: unknown): value is ProfileInfo {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    typeof value.active === "boolean" &&
    (value.updated_at_ms === null || Number.isInteger(value.updated_at_ms)) &&
    (value.source === undefined ||
      value.source === null ||
      isString(value.source)) &&
    (value.proxy_count === undefined ||
      value.proxy_count === null ||
      isNonNegativeInteger(value.proxy_count))
  );
}

function invalidRuntimeError(): RuntimeError {
  return {
    code: "internal",
    message: "FlowProxy received an invalid Runtime response.",
    retryable: true,
  };
}

function normalizeRuntimeError(error: {
  code: string;
  message: string;
  retryable: boolean;
}): RuntimeError {
  return isRuntimeErrorCode(error.code)
    ? {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      }
    : invalidRuntimeError();
}

function invalidRuntimeResponse<T>(): RuntimeBridgeResult<T> {
  return { status: "error", error: invalidRuntimeError() };
}

async function executeRuntimeCommand<T>(
  command:
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
    | "clear_subscription",
  isValidData: (value: unknown) => value is T,
  args?: Record<string, unknown>,
): Promise<RuntimeBridgeResult<T>> {
  const result = await invokeNativeCommand(command, args);

  if (result.status === "unavailable") {
    return result;
  }

  if (result.status === "error") {
    return {
      status: "error",
      error: normalizeRuntimeError(result.error),
    };
  }

  if (!isValidData(result.data)) {
    return invalidRuntimeResponse<T>();
  }

  return { status: "ok", data: result.data };
}

export function getRuntimeSnapshot(): Promise<
  RuntimeBridgeResult<RuntimeSnapshot>
> {
  return executeRuntimeCommand("get_runtime_snapshot", isRuntimeSnapshot);
}

export function getCoreInfo(): Promise<RuntimeBridgeResult<CoreInfo>> {
  return executeRuntimeCommand("get_core_info", isCoreInfo);
}

export function getTelemetry(): Promise<RuntimeBridgeResult<TelemetrySnapshot>> {
  return executeRuntimeCommand("get_telemetry", isTelemetrySnapshot);
}

export function getProxyGroups(): Promise<RuntimeBridgeResult<ProxyGroup[]>> {
  return executeRuntimeCommand(
    "get_proxy_groups",
    (value): value is ProxyGroup[] =>
      Array.isArray(value) && value.every(isProxyGroup),
  );
}

export function selectProxy(
  group: string,
  proxy: string,
): Promise<RuntimeBridgeResult<null>> {
  return executeRuntimeCommand(
    "select_proxy",
    (value): value is null => value === null,
    { group, proxy },
  );
}

export function testProxyDelay(
  proxy: string,
  timeoutMs: number,
): Promise<RuntimeBridgeResult<number>> {
  return executeRuntimeCommand(
    "test_proxy_delay",
    (value): value is number => isNonNegativeInteger(value),
    { proxy, timeoutMs },
  );
}

export function getConnections(): Promise<
  RuntimeBridgeResult<ConnectionPage>
> {
  return executeRuntimeCommand("get_connections", isConnectionPage);
}

export function closeConnection(
  connectionId: string,
): Promise<RuntimeBridgeResult<null>> {
  return executeRuntimeCommand(
    "close_connection",
    (value): value is null => value === null,
    { connectionId },
  );
}

export function getRules(): Promise<RuntimeBridgeResult<RuleItem[]>> {
  return executeRuntimeCommand(
    "get_rules",
    (value): value is RuleItem[] =>
      Array.isArray(value) && value.every(isRuleItem),
  );
}

export function getProfiles(): Promise<RuntimeBridgeResult<ProfileInfo[]>> {
  return executeRuntimeCommand(
    "get_profiles",
    (value): value is ProfileInfo[] =>
      Array.isArray(value) && value.every(isProfileInfo),
  );
}

const isProfileList = (value: unknown): value is ProfileInfo[] =>
  Array.isArray(value) && value.every(isProfileInfo);

function isSubscriptionSnapshot(value: unknown): value is SubscriptionSnapshot {
  return (
    isRecord(value) &&
    typeof value.has_subscription === "boolean" &&
    Array.isArray(value.groups) &&
    value.groups.every(isProxyGroup) &&
    Array.isArray(value.rules) &&
    value.rules.every(isRuleItem)
  );
}

/** Reads the offline summary of the stored subscription. */
export function getSubscriptionSnapshot(): Promise<
  RuntimeBridgeResult<SubscriptionSnapshot>
> {
  return executeRuntimeCommand(
    "get_subscription_snapshot",
    isSubscriptionSnapshot,
  );
}

export function importSubscription(
  name: string,
  yaml: string,
): Promise<RuntimeBridgeResult<ProfileInfo[]>> {
  return executeRuntimeCommand("import_subscription", isProfileList, {
    name,
    yaml,
  });
}

export function importSubscriptionFromUrl(
  name: string,
  url: string,
): Promise<RuntimeBridgeResult<ProfileInfo[]>> {
  return executeRuntimeCommand("import_subscription", isProfileList, {
    name,
    url,
  });
}

export function clearSubscription(): Promise<
  RuntimeBridgeResult<ProfileInfo[]>
> {
  return executeRuntimeCommand("clear_subscription", isProfileList);
}

export function startRuntime(): Promise<RuntimeBridgeResult<RuntimeSnapshot>> {
  return executeRuntimeCommand("start_runtime", isRuntimeSnapshot);
}

export function stopRuntime(): Promise<RuntimeBridgeResult<RuntimeSnapshot>> {
  return executeRuntimeCommand("stop_runtime", isRuntimeSnapshot);
}

export function restartRuntime(): Promise<
  RuntimeBridgeResult<RuntimeSnapshot>
> {
  return executeRuntimeCommand("restart_runtime", isRuntimeSnapshot);
}

export function simulateRuntimeCrash(): Promise<
  RuntimeBridgeResult<RuntimeSnapshot>
> {
  return executeRuntimeCommand("simulate_runtime_crash", isRuntimeSnapshot);
}

export async function getRuntimeLogs(): Promise<
  RuntimeBridgeResult<RuntimeLogEntry[]>
> {
  const result = await invokeNativeCommand("get_runtime_logs");

  if (result.status === "unavailable") {
    return result;
  }

  if (result.status === "error") {
    return {
      status: "error",
      error: normalizeRuntimeError(result.error),
    };
  }

  if (
    !Array.isArray(result.data) ||
    !result.data.every(isRuntimeLogEntry)
  ) {
    return invalidRuntimeResponse<RuntimeLogEntry[]>();
  }

  return { status: "ok", data: result.data };
}

export function subscribeRuntimeState(
  listener: (snapshot: RuntimeSnapshot) => void,
): Promise<() => void> {
  return listenNativeEvent("runtime-state-changed", (payload) => {
    if (isRuntimeSnapshot(payload)) {
      listener(payload);
    }
  });
}

export function subscribeRuntimeLog(
  listener: (entry: RuntimeLogEntry) => void,
): Promise<() => void> {
  return listenNativeEvent("runtime-log", (payload) => {
    if (isRuntimeLogEntry(payload)) {
      listener(payload);
    }
  });
}

export async function requestApplicationExit(): Promise<
  RuntimeBridgeResult<null>
> {
  const result = await invokeNativeCommand("request_application_exit");

  if (result.status === "unavailable") {
    return result;
  }

  if (result.status === "error") {
    return {
      status: "error",
      error: normalizeRuntimeError(result.error),
    };
  }

  if (result.data !== null) {
    return invalidRuntimeResponse<null>();
  }

  return { status: "ok", data: null };
}
