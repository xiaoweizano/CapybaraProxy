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

/** One installed Mihomo build. */
export type CoreVersion = {
  /** File name inside the core directory; `bundled` for the shipped core. */
  id: string;
  version: string;
  sha256: string;
  active: boolean;
  size_bytes: number;
};

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

export type RoutingMode = "rule" | "global" | "direct";

export type CoreLogLevel = "silent" | "error" | "warning" | "info" | "debug";

export type CorePreferences = {
  mode: RoutingMode | null;
  log_level: CoreLogLevel | null;
};

export type DelaySample = {
  proxy: string;
  delay_ms: number;
};

export type GroupDelayResult = {
  group: string;
  delays: DelaySample[];
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

/** A rule or proxy provider the active profile declares. */
export type ProviderInfo = {
  name: string;
  /** `proxy` or `rule`. */
  kind: string;
  vehicle_type: string | null;
  entry_count: number | null;
  proxy_count: number | null;
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
 * Traffic and expiry numbers a provider reports in `subscription-userinfo`.
 * Every field is optional because providers omit what they do not track.
 */
export type SubscriptionUsage = {
  upload_bytes: number | null;
  download_bytes: number | null;
  /** `0` is how many providers spell "unlimited". */
  total_bytes: number | null;
  /** Expiry in epoch milliseconds. */
  expire_at_ms: number | null;
};

/**
 * Groups and rules read from the stored subscription while the Runtime is
 * stopped. Read-only: it never reflects a running core.
 */
export type SubscriptionSnapshot = {
  groups: ProxyGroup[];
  rules: RuleItem[];
  has_subscription: boolean;
  /** Set when the subscription was imported from a URL. */
  source_url?: string | null;
  /** Import timestamp in epoch milliseconds. */
  updated_at_ms?: number | null;
  /** Name the operator gave the subscription. */
  name?: string | null;
  /** Usage and expiry captured at the last import. */
  usage?: SubscriptionUsage | null;
  /** Identifier of the active subscription. */
  id?: string | null;
  /** Always true for the snapshot: it describes the active entry. */
  active?: boolean;
  /** Custom rules the operator added on top of the subscription's own. */
  override_rules?: string[];
  /** The operator's override document, if any. */
  override_yaml?: string | null;
};

/** Transfer counters for a day or a rolling window. */
export type TrafficTotals = {
  upload_bytes: number;
  download_bytes: number;
};

/** Today's accumulated transfer plus a seven-day window. */
export type TrafficSummary = {
  today: TrafficTotals;
  week: TrafficTotals;
};

/** One latency measurement recorded by the app. */
export type DelayHistoryEntry = {
  proxy: string;
  delay_ms: number;
  timestamp_ms: number;
};

/** Latency history, oldest first, plus the server clock at read time. */
export type DelayHistory = {
  entries: DelayHistoryEntry[];
  now_ms: number;
};

/** An entry listed by an external Sub-Store backend. */
export type SubStoreSubscription = {
  name: string;
  url: string;
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

function isCoreVersion(value: unknown): value is CoreVersion {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.version) &&
    isString(value.sha256) &&
    typeof value.active === "boolean" &&
    isNonNegativeInteger(value.size_bytes)
  );
}

const isCoreVersionList = (value: unknown): value is CoreVersion[] =>
  Array.isArray(value) && value.every(isCoreVersion);

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

const routingModes = new Set<RoutingMode>(["rule", "global", "direct"]);
const coreLogLevels = new Set<CoreLogLevel>([
  "silent",
  "error",
  "warning",
  "info",
  "debug",
]);

function isCorePreferences(value: unknown): value is CorePreferences {
  return (
    isRecord(value) &&
    (value.mode === null ||
      (typeof value.mode === "string" && routingModes.has(value.mode as RoutingMode))) &&
    (value.log_level === null ||
      (typeof value.log_level === "string" &&
        coreLogLevels.has(value.log_level as CoreLogLevel)))
  );
}

function isGroupDelayResult(value: unknown): value is GroupDelayResult {
  return (
    isRecord(value) &&
    isString(value.group) &&
    Array.isArray(value.delays) &&
    value.delays.every(
      (sample) =>
        isRecord(sample) &&
        isString(sample.proxy) &&
        isNonNegativeInteger(sample.delay_ms),
    )
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

function isProviderInfo(value: unknown): value is ProviderInfo {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.kind) &&
    (value.vehicle_type === null || isString(value.vehicle_type)) &&
    (value.entry_count === null || isNonNegativeInteger(value.entry_count)) &&
    (value.proxy_count === null || isNonNegativeInteger(value.proxy_count))
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

function isSubStoreSubscription(value: unknown): value is SubStoreSubscription {
  return isRecord(value) && isString(value.name) && isString(value.url);
}

function isSubStoreList(value: unknown): value is SubStoreSubscription[] {
  return Array.isArray(value) && value.every(isSubStoreSubscription);
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
    | "get_core_versions"
    | "register_core_version"
    | "activate_core_version"
    | "open_core_versions_directory"
    | "get_telemetry"
    | "get_proxy_groups"
    | "select_proxy"
    | "test_proxy_delay"
    | "test_group_delay"
    | "get_core_preferences"
    | "set_core_preferences"
    | "get_connections"
    | "close_connection"
    | "close_all_connections"
    | "get_delay_history"
    | "get_traffic_today"
    | "get_rules"
    | "get_providers"
    | "get_profiles"
    | "get_subscription_snapshot"
    | "import_subscription"
    | "clear_subscription"
    | "remove_subscription"
    | "activate_subscription"
    | "set_subscription_rules"
    | "set_subscription_override_yaml"
    | "refresh_subscription"
    | "list_substore_subscriptions"
    | "import_substore_subscription"
    | "open_log_directory"
    | "export_diagnostics"
    | "clear_log_files",
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

/** Lists the bundled core plus every registered build. */
export function getCoreVersions(): Promise<RuntimeBridgeResult<CoreVersion[]>> {
  return executeRuntimeCommand("get_core_versions", isCoreVersionList);
}

/** Registers a build the operator placed in the cores directory. */
export function registerCoreVersion(
  id: string,
): Promise<RuntimeBridgeResult<CoreVersion[]>> {
  return executeRuntimeCommand("register_core_version", isCoreVersionList, {
    id,
  });
}

/** Switches the core the next start uses; `null` restores the bundled one. */
export function activateCoreVersion(
  id: string | null,
): Promise<RuntimeBridgeResult<CoreVersion[]>> {
  return executeRuntimeCommand("activate_core_version", isCoreVersionList, {
    id,
  });
}

/** Opens the directory an operator drops a build into. */
export function openCoreVersionsDirectory(): Promise<
  RuntimeBridgeResult<string>
> {
  return executeRuntimeCommand("open_core_versions_directory", isString);
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

export function testGroupDelay(
  group: string,
  timeoutMs: number,
): Promise<RuntimeBridgeResult<GroupDelayResult>> {
  return executeRuntimeCommand(
    "test_group_delay",
    isGroupDelayResult,
    { group, timeoutMs },
  );
}

export function getCorePreferences(): Promise<
  RuntimeBridgeResult<CorePreferences>
> {
  return executeRuntimeCommand("get_core_preferences", isCorePreferences);
}

export function setCorePreferences(
  mode: RoutingMode | null,
  logLevel: CoreLogLevel | null,
): Promise<RuntimeBridgeResult<CorePreferences>> {
  return executeRuntimeCommand("set_core_preferences", isCorePreferences, {
    mode,
    logLevel,
  });
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

/** Closes every open connection in one call. */
export function closeAllConnections(): Promise<RuntimeBridgeResult<null>> {
  return executeRuntimeCommand(
    "close_all_connections",
    (value): value is null => value === null,
  );
}

export function getRules(): Promise<RuntimeBridgeResult<RuleItem[]>> {
  return executeRuntimeCommand(
    "get_rules",
    (value): value is RuleItem[] =>
      Array.isArray(value) && value.every(isRuleItem),
  );
}

/** Reads the providers the active profile declares. */
export function getProviders(): Promise<RuntimeBridgeResult<ProviderInfo[]>> {
  return executeRuntimeCommand(
    "get_providers",
    (value): value is ProviderInfo[] =>
      Array.isArray(value) && value.every(isProviderInfo),
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

function isSubscriptionUsage(value: unknown): value is SubscriptionUsage {
  return (
    isRecord(value) &&
    (value.upload_bytes === null || isNonNegativeInteger(value.upload_bytes)) &&
    (value.download_bytes === null ||
      isNonNegativeInteger(value.download_bytes)) &&
    (value.total_bytes === null || isNonNegativeInteger(value.total_bytes)) &&
    (value.expire_at_ms === null || Number.isInteger(value.expire_at_ms))
  );
}

function isSubscriptionSnapshot(value: unknown): value is SubscriptionSnapshot {
  return (
    isRecord(value) &&
    typeof value.has_subscription === "boolean" &&
    Array.isArray(value.groups) &&
    value.groups.every(isProxyGroup) &&
    Array.isArray(value.rules) &&
    value.rules.every(isRuleItem) &&
    (value.source_url === undefined ||
      value.source_url === null ||
      isString(value.source_url)) &&
    (value.updated_at_ms === undefined ||
      value.updated_at_ms === null ||
      Number.isInteger(value.updated_at_ms)) &&
    (value.name === undefined ||
      value.name === null ||
      isString(value.name)) &&
    (value.usage === undefined ||
      value.usage === null ||
      isSubscriptionUsage(value.usage)) &&
    (value.id === undefined || value.id === null || isString(value.id)) &&
    (value.active === undefined || typeof value.active === "boolean") &&
    (value.override_rules === undefined ||
      (Array.isArray(value.override_rules) &&
        value.override_rules.every(isString))) &&
    (value.override_yaml === undefined ||
      value.override_yaml === null ||
      isString(value.override_yaml))
  );
}

function isDelayHistoryEntry(value: unknown): value is DelayHistoryEntry {
  return (
    isRecord(value) &&
    isString(value.proxy) &&
    isNonNegativeInteger(value.delay_ms) &&
    Number.isInteger(value.timestamp_ms)
  );
}

function isTrafficTotals(value: unknown): value is TrafficTotals {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.upload_bytes) &&
    isNonNegativeInteger(value.download_bytes)
  );
}

function isTrafficSummary(value: unknown): value is TrafficSummary {
  return (
    isRecord(value) &&
    isTrafficTotals(value.today) &&
    isTrafficTotals(value.week)
  );
}

function isDelayHistory(value: unknown): value is DelayHistory {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.every(isDelayHistoryEntry) &&
    Number.isInteger(value.now_ms)
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

/** Removes one subscription from the library. */
export function removeSubscription(
  id: string,
): Promise<RuntimeBridgeResult<ProfileInfo[]>> {
  return executeRuntimeCommand("remove_subscription", isProfileList, { id });
}

/** Selects the subscription the next start launches with. */
export function activateSubscription(
  id: string,
): Promise<RuntimeBridgeResult<ProfileInfo[]>> {
  return executeRuntimeCommand("activate_subscription", isProfileList, { id });
}

/** Replaces the operator's custom rules for one subscription. */
export function setSubscriptionRules(
  id: string,
  rules: string[],
): Promise<RuntimeBridgeResult<ProfileInfo[]>> {
  return executeRuntimeCommand("set_subscription_rules", isProfileList, {
    id,
    rules,
  });
}

/** Replaces the operator's override YAML for one subscription. */
export function setSubscriptionOverrideYaml(
  id: string,
  yaml: string | null,
): Promise<RuntimeBridgeResult<ProfileInfo[]>> {
  return executeRuntimeCommand("set_subscription_override_yaml", isProfileList, {
    id,
    yaml,
  });
}

/** Reads today's accumulated transfer and the rolling seven-day total. */
export function getTrafficSummary(): Promise<
  RuntimeBridgeResult<TrafficSummary>
> {
  return executeRuntimeCommand("get_traffic_today", isTrafficSummary);
}

/** Reads the latency measurements the app recorded for the history view. */
export function getDelayHistory(): Promise<RuntimeBridgeResult<DelayHistory>> {
  return executeRuntimeCommand("get_delay_history", isDelayHistory);
}

/// Re-downloads the stored subscription from its recorded source URL.
export function refreshSubscription(): Promise<
  RuntimeBridgeResult<ProfileInfo[]>
> {
  return executeRuntimeCommand("refresh_subscription", isProfileList);
}

/**
 * Notifies the page when the native side refreshed the subscription itself,
 * for example from the automatic update check in the background loop.
 */
export function subscribeSubscriptionUpdated(
  listener: () => void,
): Promise<() => void> {
  return listenNativeEvent("subscription-updated", () => listener());
}

/** Lists the subscriptions stored on an external Sub-Store backend. */
export function listSubStoreSubscriptions(
  url: string,
  token: string,
): Promise<RuntimeBridgeResult<SubStoreSubscription[]>> {
  return executeRuntimeCommand("list_substore_subscriptions", isSubStoreList, {
    url,
    token,
  });
}

/** Imports one subscription listed by a Sub-Store backend. */
export function importSubStoreSubscription(
  name: string,
  url: string,
): Promise<RuntimeBridgeResult<ProfileInfo[]>> {
  return executeRuntimeCommand("import_substore_subscription", isProfileList, {
    name,
    url,
  });
}

/** Opens the rotating log directory in the platform file manager. */
export function openLogDirectory(): Promise<RuntimeBridgeResult<string>> {
  return executeRuntimeCommand("open_log_directory", isString);
}

/** Writes a redacted diagnostic bundle and opens its folder. */
export function exportDiagnostics(): Promise<RuntimeBridgeResult<string>> {
  return executeRuntimeCommand("export_diagnostics", isString);
}

/** Deletes every log file FlowProxy created. */
export function clearLogFiles(): Promise<RuntimeBridgeResult<number>> {
  return executeRuntimeCommand(
    "clear_log_files",
    (value): value is number => typeof value === "number" && value >= 0,
  );
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
