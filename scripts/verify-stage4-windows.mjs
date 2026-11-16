import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  assert,
  createCdpClient,
  createPage,
  delay,
  findAvailablePort,
  findFlowProxyPid,
  processIdsStillAlive,
  terminateProcessTree,
  waitForPageTarget,
  waitForProcessExit,
} from "./lib/tauri-cdp.mjs";
import {
  applyWindowsStage4Registry,
  readWindowsStage4Registry,
  registryValuesEqual,
} from "./lib/windows-registry.mjs";

const appExecutable = path.resolve(
  process.env.FLOWPROXY_APP_EXECUTABLE ??
    "F:/codex-install/cargo-target/release/flowproxy-desktop.exe",
);
const mihomoExecutable = path.resolve(
  process.env.FLOWPROXY_MIHOMO_PATH ??
    "F:/codex-install/mihomo/v1.19.33/win-amd64/mihomo-windows-amd64.exe",
);
const configRoot = path.join(
  process.env.APPDATA ??
    (() => {
      throw new Error("APPDATA is unavailable.");
    })(),
  "com.flowproxy.desktop",
);
const journalPath = path.join(configRoot, "system-proxy.json");
const resultPath = path.resolve("artifacts/stage4-windows-acceptance.json");
const pageUrlPrefix = "http://tauri.localhost/";

async function readOptionalFile(filePath) {
  try {
    return { exists: true, contents: await readFile(filePath) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, contents: null };
    }
    throw error;
  }
}

async function restoreOptionalFile(filePath, snapshot) {
  if (snapshot.exists) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, snapshot.contents);
  } else {
    await rm(filePath, { force: true });
  }
}

async function readJournal() {
  return JSON.parse(await readFile(journalPath, "utf8"));
}

async function waitForCondition(check, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }

  throw new Error(
    `Timed out waiting for ${description}.${
      lastError ? ` Last error: ${lastError.message}` : ""
    }`,
  );
}

async function waitForRegistry(predicate, description, timeoutMs = 15_000) {
  return waitForCondition(
    async () => {
      const current = await readWindowsStage4Registry();
      return predicate(current) ? current : null;
    },
    description,
    timeoutMs,
  );
}

async function waitForJournal(exists, description, timeoutMs = 15_000) {
  return waitForCondition(
    async () => {
      const snapshot = await readOptionalFile(journalPath);
      return snapshot.exists === exists ? snapshot : null;
    },
    description,
    timeoutMs,
  );
}

async function invokeOk(page, command, args, action) {
  const result = await page.invoke(command, args);
  assert(
    result?.ok,
    `FlowProxy could not ${action}: ${JSON.stringify(result)}`,
  );
  return result.data;
}

async function waitForRuntimeState(page, state) {
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === ${JSON.stringify(
        state,
      )})`,
    `the Runtime state ${state}`,
  );
}

async function connectToApplication(port) {
  const target = await waitForPageTarget(port, {
    expectedUrlPrefix: pageUrlPrefix,
    timeoutMs: 30_000,
  });
  const client = createCdpClient(target.webSocketDebuggerUrl);
  const page = createPage(client);

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await page.waitFor(
    `document.readyState === "complete" &&
      document.querySelector(".app-frame") !== null &&
      typeof window.__TAURI_INTERNALS__?.invoke === "function"`,
    "the FlowProxy application shell",
  );

  assert(
    target.url.startsWith(pageUrlPrefix),
    `Expected the production Tauri frontend, received ${target.url}.`,
  );

  return { client, page, target };
}

async function startApplication() {
  const browserPort = await findAvailablePort();
  const child = spawn(appExecutable, [], {
    cwd: path.dirname(appExecutable),
    env: {
      ...process.env,
      FLOWPROXY_MIHOMO_PATH: mihomoExecutable,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
        process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
        `--remote-debugging-port=${browserPort}`,
      ]
        .filter(Boolean)
        .join(" "),
    },
    stdio: "ignore",
    windowsHide: true,
  });

  assert(
    Number.isInteger(child.pid) && child.pid > 0,
    "FlowProxy did not return a process identifier.",
  );

  try {
    const connected = await connectToApplication(browserPort);
    return { ...connected, browserPort, child, pid: child.pid };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function verifyProxyRegistry(registry, expectedServer, description) {
  assert(
    registry.proxyEnable.exists &&
      registry.proxyEnable.kind === "DWord" &&
      registry.proxyEnable.value === 1,
    `${description}: ProxyEnable was not enabled.`,
  );
  assert(
    registry.proxyServer.exists &&
      registry.proxyServer.kind === "String" &&
      registry.proxyServer.value === expectedServer,
    `${description}: ProxyServer did not match ${expectedServer}.`,
  );
}

function safeKill(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

await mkdir(path.dirname(resultPath), { recursive: true });
await mkdir(configRoot, { recursive: true });

const initialRegistry = await readWindowsStage4Registry();
const initialJournal = await readOptionalFile(journalPath);
const initialAppPid = await findFlowProxyPid(appExecutable);
assert(
  initialAppPid === null,
  `Stop FlowProxy process ${initialAppPid} before running stage 4 acceptance.`,
);
assert(
  !initialJournal.exists,
  `FlowProxy already has a system proxy journal at ${journalPath}; recovery must be inspected before acceptance.`,
);

const audit = {
  timestamp: new Date().toISOString(),
  environment: {
    appExecutable,
    mihomoExecutable,
    configRoot,
  },
  initialRegistry,
  cases: {},
  manualVerificationRequired: {
    trayConnect: "not_run",
    trayDisconnect: "not_run",
    trayShow: "not_run",
    trayExit: "not_run",
  },
};

let application = null;
let client = null;
let page = null;
let applicationPid = null;
let completedControlledExit = false;
const managedCorePids = new Set();

try {
  application = await startApplication();
  ({ client, page } = application);
  applicationPid = application.pid;

  const initialStatus = await invokeOk(
    page,
    "get_system_integration_status",
    undefined,
    "read initial system integration status",
  );
  assert(
    initialStatus.platform === "windows",
    `Expected Windows integration, received ${initialStatus.platform}.`,
  );
  assert(
    initialStatus.capabilities.system_proxy.state === "available",
    `System proxy is not available: ${JSON.stringify(
      initialStatus.capabilities.system_proxy,
    )}`,
  );
  assert(
    initialStatus.capabilities.launch_at_login.state === "available",
    `Launch at login is not available: ${JSON.stringify(
      initialStatus.capabilities.launch_at_login,
    )}`,
  );
  assert(
    initialStatus.capabilities.tun.state !== "available",
    "Stage 4 must not report TUN activation as available.",
  );
  assert(
    initialStatus.system_proxy.managed === false,
    "Initial system proxy state was unexpectedly managed.",
  );
  audit.cases.capabilityStatus = initialStatus.capabilities;

  await page.evaluate('location.hash = "/";');
  await invokeOk(page, "start_runtime", undefined, "start Mihomo");
  await waitForRuntimeState(page, "connected");
  let coreInfo = await invokeOk(
    page,
    "get_core_info",
    undefined,
    "read Mihomo process information",
  );
  managedCorePids.add(coreInfo.pid);
  audit.cases.initialRuntime = {
    state: "connected",
    corePid: coreInfo.pid,
    coreVersion: coreInfo.version,
  };

  const enabledStatus = await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: true },
    "enable the Windows system proxy",
  );
  assert(
    enabledStatus.system_proxy.state === "enabled" &&
      enabledStatus.system_proxy.managed === true &&
      enabledStatus.system_proxy.active === true,
    `Unexpected enabled system proxy status: ${JSON.stringify(
      enabledStatus.system_proxy,
    )}`,
  );
  const enabledJournal = await readJournal();
  const enabledRegistry = await waitForRegistry(
    (registry) =>
      registry.proxyServer.value === enabledJournal.managed_server &&
      registry.proxyEnable.value === 1,
    "FlowProxy to own the system proxy",
  );
  await verifyProxyRegistry(
    enabledRegistry,
    enabledJournal.managed_server,
    "Enable",
  );
  assert(
    enabledJournal.managed_server.startsWith("127.0.0.1:"),
    `Managed endpoint was not loopback: ${enabledJournal.managed_server}`,
  );
  audit.cases.enableAndDisable = {
    managedServer: enabledJournal.managed_server,
    original: enabledJournal.original,
  };

  const disabledStatus = await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: false },
    "disable the Windows system proxy",
  );
  const disabledRegistry = await waitForRegistry(
    (registry) => registryValuesEqual(registry, initialRegistry),
    "the original Windows proxy values to be restored",
  );
  await waitForJournal(false, "the proxy journal to be removed");
  assert(
    disabledStatus.system_proxy.managed === false &&
      disabledStatus.system_proxy.active === false,
    `Unexpected disabled system proxy status: ${JSON.stringify(
      disabledStatus.system_proxy,
    )}`,
  );
  audit.cases.enableAndDisable.restoredRegistry = disabledRegistry;

  await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: true },
    "enable the system proxy for external-change protection",
  );
  const foreignProxy = await readWindowsStage4Registry();
  foreignProxy.proxyEnable = {
    exists: true,
    kind: "DWord",
    value: 1,
  };
  foreignProxy.proxyServer = {
    exists: true,
    kind: "String",
    value: "10.0.0.2:8080",
  };
  await applyWindowsStage4Registry(foreignProxy);
  await waitForRegistry(
    (registry) => registry.proxyServer.value === "10.0.0.2:8080",
    "the simulated external proxy change",
  );
  const externalProtectedStatus = await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: false },
    "release a system proxy changed by the user",
  );
  const protectedRegistry = await readWindowsStage4Registry();
  await waitForJournal(false, "the externally protected journal to be removed");
  assert(
    protectedRegistry.proxyEnable.value === 1 &&
      protectedRegistry.proxyServer.value === "10.0.0.2:8080",
    `FlowProxy overwrote an external proxy change: ${JSON.stringify(
      protectedRegistry,
    )}`,
  );
  assert(
    externalProtectedStatus.system_proxy.managed === false,
    "External proxy ownership was not released.",
  );
  await applyWindowsStage4Registry(initialRegistry);
  audit.cases.externalChangeProtection = {
    preservedProxyEnable: protectedRegistry.proxyEnable,
    preservedProxyServer: protectedRegistry.proxyServer,
    journalRemoved: true,
  };

  await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: true },
    "enable the system proxy before a core crash",
  );
  safeKill(coreInfo.pid);
  await waitForRuntimeState(page, "error");
  const crashRegistry = await waitForRegistry(
    (registry) => registryValuesEqual(registry, initialRegistry),
    "the original proxy values after the core crash",
  );
  await waitForJournal(false, "journal cleanup after the core crash");
  const crashStatus = await invokeOk(
    page,
    "get_system_integration_status",
    undefined,
    "read integration status after the core crash",
  );
  assert(
    crashStatus.system_proxy.managed === false,
    "System proxy ownership remained after core crash recovery.",
  );
  audit.cases.coreCrashRecovery = {
    crashedCorePid: coreInfo.pid,
    restoredRegistry: crashRegistry,
    managed: crashStatus.system_proxy.managed,
  };

  await invokeOk(page, "start_runtime", undefined, "restart Mihomo");
  await waitForRuntimeState(page, "connected");
  coreInfo = await invokeOk(
    page,
    "get_core_info",
    undefined,
    "read the replacement Mihomo process",
  );
  managedCorePids.add(coreInfo.pid);
  await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: true },
    "enable the system proxy before a Runtime restart",
  );
  const beforeRestartJournal = await readJournal();
  const restarted = await invokeOk(
    page,
    "restart_runtime",
    undefined,
    "restart Mihomo with a managed system proxy",
  );
  assert(
    restarted.state === "running_disconnected",
    `Runtime restart returned ${restarted.state} before the replacement core connected.`,
  );
  await waitForRuntimeState(page, "connected");
  const restartedCoreInfo = await invokeOk(
    page,
    "get_core_info",
    undefined,
    "read the restarted Mihomo process",
  );
  managedCorePids.add(restartedCoreInfo.pid);
  assert(
    restartedCoreInfo.pid !== coreInfo.pid,
    "Mihomo PID did not change after restart.",
  );
  const afterRestartJournal = await waitForCondition(
    async () => {
      const journal = await readJournal();
      return journal.managed_server !== beforeRestartJournal.managed_server ||
        restartedCoreInfo.pid !== coreInfo.pid
        ? journal
        : null;
    },
    "the restarted Runtime to publish its system proxy journal",
  );
  const afterRestartRegistry = await waitForRegistry(
    (registry) =>
      registry.proxyEnable.value === 1 &&
      registry.proxyServer.value === afterRestartJournal.managed_server,
    "the system proxy to be re-enabled after Runtime restart",
  );
  await verifyProxyRegistry(
    afterRestartRegistry,
    afterRestartJournal.managed_server,
    "Restart",
  );
  audit.cases.runtimeRestart = {
    initialCommandState: restarted.state,
    previousCorePid: coreInfo.pid,
    restartedCorePid: restartedCoreInfo.pid,
    previousManagedServer: beforeRestartJournal.managed_server,
    managedServer: afterRestartJournal.managed_server,
  };
  await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: false },
    "restore the system proxy after the Runtime restart test",
  );

  await page.evaluate('location.hash = "/settings";');
  await page.waitFor(
    'document.querySelector(".settings-grid") !== null',
    "the Settings page before startup tests",
  );
  const startupAbsent = structuredClone(initialRegistry);
  startupAbsent.startup = { exists: false };
  await applyWindowsStage4Registry(startupAbsent);
  const startupDisabled = await invokeOk(
    page,
    "set_launch_at_login_enabled",
    { enabled: false },
    "leave launch at login disabled",
  );
  assert(
    startupDisabled.launch_at_login.state === "disabled",
    `Launch at login was not disabled: ${JSON.stringify(
      startupDisabled.launch_at_login,
    )}`,
  );
  const startupEnabled = await invokeOk(
    page,
    "set_launch_at_login_enabled",
    { enabled: true },
    "enable launch at login",
  );
  assert(
    startupEnabled.launch_at_login.state === "enabled",
    `Launch at login was not enabled: ${JSON.stringify(
      startupEnabled.launch_at_login,
    )}`,
  );
  const startupRegistry = await readWindowsStage4Registry();
  const expectedStartupCommand = `"${appExecutable}"`;
  assert(
    startupRegistry.startup.exists &&
      startupRegistry.startup.kind === "String" &&
      startupRegistry.startup.value === expectedStartupCommand,
    `Unexpected launch-at-login command: ${JSON.stringify(
      startupRegistry.startup,
    )}`,
  );
  await invokeOk(
    page,
    "set_launch_at_login_enabled",
    { enabled: false },
    "disable launch at login",
  );
  const startupRemoved = await readWindowsStage4Registry();
  assert(
    startupRemoved.startup.exists === false,
    `Launch-at-login value was not removed: ${JSON.stringify(
      startupRemoved.startup,
    )}`,
  );

  const foreignStartup = structuredClone(startupRemoved);
  foreignStartup.startup = {
    exists: true,
    kind: "String",
    value: '"C:\\Other\\Tool.exe" --background',
  };
  await applyWindowsStage4Registry(foreignStartup);
  const startupConflict = await invokeOk(
    page,
    "set_launch_at_login_enabled",
    { enabled: true },
    "preserve a foreign launch-at-login value",
  );
  const conflictRegistry = await readWindowsStage4Registry();
  assert(
    startupConflict.launch_at_login.state === "conflict" &&
      conflictRegistry.startup.value === foreignStartup.startup.value,
    `FlowProxy did not preserve the foreign startup value: ${JSON.stringify(
      conflictRegistry.startup,
    )}`,
  );
  await invokeOk(
    page,
    "set_launch_at_login_enabled",
    { enabled: false },
    "attempt to disable a conflicting launch-at-login value",
  );
  const conflictAfterDisable = await readWindowsStage4Registry();
  assert(
    registryValuesEqual(conflictAfterDisable, foreignStartup),
    "Disabling launch at login overwrote a foreign registry value.",
  );
  audit.cases.launchAtLogin = {
    expectedCommand: expectedStartupCommand,
    disabledState: startupDisabled.launch_at_login,
    enabledState: startupEnabled.launch_at_login,
    conflictState: startupConflict.launch_at_login,
    foreignCommandPreserved: conflictAfterDisable.startup.value,
  };
  await applyWindowsStage4Registry(initialRegistry);

  await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: true },
    "enable the system proxy before abrupt process termination",
  );
  const staleJournalBeforeTermination = await readJournal();
  const staleCoreInfo = await invokeOk(
    page,
    "get_core_info",
    undefined,
    "read Mihomo before application termination",
  );
  const staleApplicationPid = applicationPid;
  safeKill(staleApplicationPid);
  safeKill(staleCoreInfo.pid);
  client.close();
  client = null;
  page = null;
  application = null;
  applicationPid = null;
  assert(
    await waitForProcessExit(staleApplicationPid, 15_000),
    "FlowProxy did not terminate for the stale journal test.",
  );
  await waitForProcessExit(staleCoreInfo.pid, 15_000);
  await waitForJournal(
    true,
    "the journal to remain after abrupt application termination",
  );
  const staleRegistryBeforeRestart = await readWindowsStage4Registry();
  assert(
    staleRegistryBeforeRestart.proxyServer.value ===
      staleJournalBeforeTermination.managed_server,
    "The managed proxy was not left in place for stale journal recovery.",
  );

  application = await startApplication();
  ({ client, page } = application);
  applicationPid = application.pid;
  const recoveredRegistry = await waitForRegistry(
    (registry) => registryValuesEqual(registry, initialRegistry),
    "startup recovery to restore stale Windows proxy values",
  );
  await waitForJournal(false, "startup recovery to remove the stale journal");
  const staleRecoveryStatus = await invokeOk(
    page,
    "get_system_integration_status",
    undefined,
    "read integration status after stale journal recovery",
  );
  assert(
    staleRecoveryStatus.system_proxy.managed === false,
    "Stale journal recovery left the system proxy managed.",
  );
  audit.cases.staleJournalRecovery = {
    previousApplicationPid: staleApplicationPid,
    previousCorePid: staleCoreInfo.pid,
    staleManagedServer: staleJournalBeforeTermination.managed_server,
    restoredRegistry: recoveredRegistry,
  };

  await invokeOk(page, "start_runtime", undefined, "start Mihomo for exit");
  await waitForRuntimeState(page, "connected");
  const exitCoreInfo = await invokeOk(
    page,
    "get_core_info",
    undefined,
    "read Mihomo before controlled exit",
  );
  managedCorePids.add(exitCoreInfo.pid);
  await invokeOk(
    page,
    "set_system_proxy_enabled",
    { enabled: true },
    "enable the system proxy before controlled exit",
  );
  const exitJournal = await readJournal();
  const exitApplicationPid = applicationPid;
  audit.cases.controlledExit = {
    appPid: exitApplicationPid,
    corePid: exitCoreInfo.pid,
    managedServer: exitJournal.managed_server,
    commandAccepted: false,
  };

  try {
    const exitResult = await page.invoke("request_application_exit");
    audit.cases.controlledExit.commandAccepted = exitResult?.ok === true;
  } catch {
    // app.exit can close the CDP connection before it returns a response.
  }
  assert(
    await waitForProcessExit(exitApplicationPid, 20_000),
    "FlowProxy did not exit after the controlled exit request.",
  );
  completedControlledExit = true;
  application = null;
  applicationPid = null;
  await waitForProcessExit(exitCoreInfo.pid, 20_000);
  const exitRegistry = await waitForRegistry(
    (registry) => registryValuesEqual(registry, initialRegistry),
    "controlled exit to restore the Windows proxy values",
  );
  await waitForJournal(false, "controlled exit to remove the proxy journal");
  audit.cases.controlledExit.commandAccepted = true;
  audit.cases.controlledExit.appExited = true;
  audit.cases.controlledExit.coreExited = true;
  audit.cases.controlledExit.restoredRegistry = exitRegistry;

  audit.status = "passed";
  audit.completedAt = new Date().toISOString();
  await writeFile(resultPath, `${JSON.stringify(audit, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  process.stdout.write(`Stage 4 Windows acceptance written to ${resultPath}\n`);
} catch (error) {
  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        ...audit,
        status: "failed",
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    )}\n`,
  );
  throw error;
} finally {
  client?.close();

  if (applicationPid && !completedControlledExit) {
    await terminateProcessTree(applicationPid).catch(() => undefined);
  }
  if (application?.child && !application.child.killed) {
    application.child.kill();
  }

  for (const corePid of managedCorePids) {
    const remaining = await processIdsStillAlive([corePid]);
    if (remaining.length > 0) {
      safeKill(corePid);
    }
  }

  await applyWindowsStage4Registry(initialRegistry);
  await restoreOptionalFile(journalPath, initialJournal);
}
