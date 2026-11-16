import { spawn } from "node:child_process";
import { ClientRequest, createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  assert,
  createCdpClient,
  createPage,
  delay,
  findAvailablePort,
  findFlowProxyPid,
  runPowerShell,
  terminateProcessTree,
  waitForPageTarget,
  waitForProcessExit,
} from "./lib/tauri-cdp.mjs";

const appExecutable = path.resolve(
  process.env.FLOWPROXY_APP_EXECUTABLE ??
    "F:/codex-install/cargo-target/release/flowproxy-desktop.exe",
);
const mihomoExecutable = path.resolve(
  process.env.FLOWPROXY_MIHOMO_PATH ??
    "F:/codex-install/mihomo/v1.19.33/win-amd64/mihomo-windows-amd64.exe",
);
const configRoot =
  process.env.FLOWPROXY_CONFIG_ROOT ??
  path.join(
    process.env.APPDATA ??
      (() => {
        throw new Error("APPDATA is unavailable.");
      })(),
    "com.flowproxy.desktop",
  );
const outputPath = path.resolve(
  process.env.FLOWPROXY_PERF_OUTPUT ??
    "artifacts/stage6-performance-before.json",
);
const scale = Number(process.env.FLOWPROXY_PERF_SCALE ?? "1");
const fullSizeConnections = Number(
  process.env.FLOWPROXY_PERF_LARGE_CONNECTIONS ?? "160",
);
const sampleIntervalMs = Number(
  process.env.FLOWPROXY_PERF_SAMPLE_INTERVAL_MS ?? "5000",
);
const pageUrlPrefix = "http://tauri.localhost/";
const scenarioDurations = {
  idle: Math.round(5 * 60 * 1_000 * scale),
  stable: Math.round(5 * 60 * 1_000 * scale),
  traffic: Math.round(5 * 60 * 1_000 * scale),
  hidden: Math.round(10 * 60 * 1_000 * scale),
};
const largeConnectionCount = Math.max(
  1,
  Math.round(fullSizeConnections * Math.min(1, scale)),
);

assert(
  Number.isFinite(scale) && scale > 0,
  "FLOWPROXY_PERF_SCALE must be a positive number.",
);
assert(
  Number.isFinite(sampleIntervalMs) && sampleIntervalMs >= 500,
  "FLOWPROXY_PERF_SAMPLE_INTERVAL_MS must be at least 500.",
);

function processCategory(processName) {
  const normalized = processName.toLowerCase();

  if (normalized.includes("mihomo")) {
    return "mihomo";
  }

  if (normalized === "msedgewebview2" || normalized.includes("webview")) {
    return "webview";
  }

  if (normalized.startsWith("flowproxy")) {
    return "flowproxy";
  }

  return "other";
}

function summarizeProcesses(processes) {
  const byCategory = Object.fromEntries(
    ["flowproxy", "webview", "mihomo", "other"].map((category) => [
      category,
      {
        processCount: 0,
        cpuSeconds: 0,
        workingSetBytes: 0,
        privateBytes: 0,
      },
    ]),
  );
  let cpuSeconds = 0;
  let workingSetBytes = 0;
  let privateBytes = 0;

  for (const entry of processes) {
    const category = entry.category;
    const bucket = byCategory[category] ?? byCategory.other;
    bucket.processCount += 1;
    bucket.cpuSeconds += entry.cpuSeconds;
    bucket.workingSetBytes += entry.workingSetBytes;
    bucket.privateBytes += entry.privateBytes;
    cpuSeconds += entry.cpuSeconds;
    workingSetBytes += entry.workingSetBytes;
    privateBytes += entry.privateBytes;
  }

  for (const bucket of Object.values(byCategory)) {
    bucket.cpuSeconds = Number(bucket.cpuSeconds.toFixed(3));
  }

  return {
    processCount: processes.length,
    cpuSeconds: Number(cpuSeconds.toFixed(3)),
    workingSetBytes,
    privateBytes,
    byCategory,
    processes,
  };
}

async function readProcessTree(rootPid) {
  const output = await runPowerShell(`
    $rootPid = ${rootPid};
    $processes = Get-CimInstance Win32_Process |
      Select-Object ProcessId, ParentProcessId, Name, ExecutablePath;
    $ids = [System.Collections.Generic.HashSet[int]]::new();
    [void]$ids.Add($rootPid);
    do {
      $added = $false;
      foreach ($entry in $processes) {
        if (
          $ids.Contains([int]$entry.ParentProcessId) -and
          $ids.Add([int]$entry.ProcessId)
        ) {
          $added = $true;
        }
      }
    } while ($added);

    $rows = foreach ($processId in $ids) {
      $live = Get-Process -Id $processId -ErrorAction SilentlyContinue;
      if ($live) {
        [pscustomobject]@{
          id = $live.Id;
          name = $live.ProcessName;
          cpuSeconds = if ($null -eq $live.CPU) { 0 } else { [double]$live.CPU };
          workingSetBytes = [long]$live.WorkingSet64;
          privateBytes = [long]$live.PrivateMemorySize64;
        }
      }
    }

    @($rows) | ConvertTo-Json -Compress
  `);
  const parsed = JSON.parse(output || "[]");
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows.map((entry) => ({
    id: entry.id,
    name: entry.name,
    category: processCategory(entry.name),
    cpuSeconds: Number(entry.cpuSeconds),
    workingSetBytes: Number(entry.workingSetBytes),
    privateBytes: Number(entry.privateBytes),
  }));
}

function resourceDelta(start, end, elapsedMs) {
  const elapsedSeconds = elapsedMs / 1_000;
  const cpuSeconds = Math.max(0, end.cpuSeconds - start.cpuSeconds);
  const cpuPercent =
    elapsedSeconds > 0
      ? (cpuSeconds / (elapsedSeconds * os.availableParallelism())) * 100
      : 0;

  return {
    elapsedMs,
    cpuSeconds: Number(cpuSeconds.toFixed(3)),
    systemCpuPercent: Number(cpuPercent.toFixed(3)),
    workingSetBytes: end.workingSetBytes,
    privateBytes: end.privateBytes,
    processCount: end.processCount,
  };
}

async function readUiState(page) {
  return page.evaluate(`(() => {
    const text = document.body.textContent ?? "";
    const sampleMatches = [...text.matchAll(/(\\d+)\\s+samples?/gi)];
    const sampleCounts = sampleMatches.map((match) => Number(match[1]));
    const runningAnimations = document.getAnimations()
      ? document.getAnimations().filter((animation) => animation.playState === "running").length
      : null;
    return {
      route: location.hash || "#/",
      theme: document.documentElement.dataset.theme ?? null,
      documentVisibility: document.visibilityState,
      nativeVisibility:
        document.documentElement.dataset.appVisibility ?? "visible",
      sampleCount: sampleCounts.length > 0 ? Math.max(...sampleCounts) : null,
      runningAnimations,
      connectionRows: document.querySelectorAll(".connection-row").length,
      logRows: document.querySelectorAll(".log-list li").length,
      hasOverview: Boolean(document.querySelector(".connection-hero")),
      hasConnectionHero: Boolean(document.querySelector(".connection-hero")),
      bodyTextLength: text.length,
    };
  })()`);
}

async function monitorScenario(page, rootPid, label, durationMs) {
  const startedAt = Date.now();
  const samples = [];
  let previous = summarizeProcesses(await readProcessTree(rootPid));
  let previousAt = Date.now();
  samples.push({
    atMs: 0,
    resources: previous,
    ui: await readUiState(page),
  });

  while (Date.now() - startedAt < durationMs) {
    const waitMs = Math.min(
      sampleIntervalMs,
      Math.max(0, durationMs - (Date.now() - startedAt)),
    );
    if (waitMs > 0) {
      await delay(waitMs);
    }

    const current = summarizeProcesses(await readProcessTree(rootPid));
    const currentAt = Date.now();
    samples.push({
      atMs: currentAt - startedAt,
      resources: current,
      delta: resourceDelta(previous, current, currentAt - previousAt),
      ui: await readUiState(page),
    });
    previous = current;
    previousAt = currentAt;
  }

  if (samples.length === 1) {
    const current = summarizeProcesses(await readProcessTree(rootPid));
    const currentAt = Date.now();
    samples.push({
      atMs: currentAt - startedAt,
      resources: current,
      delta: resourceDelta(previous, current, currentAt - previousAt),
      ui: await readUiState(page),
    });
  }

  const completed = samples.at(-1);
  const elapsedMs = completed.atMs;
  const aggregateStart = samples[0].resources;
  const aggregateEnd = completed.resources;
  const deltaSamples = samples
    .map((sample) => sample.delta)
    .filter((sample) => sample !== undefined);
  const worstCpu = deltaSamples.reduce(
    (worst, sample) =>
      sample.systemCpuPercent > worst.systemCpuPercent ? sample : worst,
    { systemCpuPercent: 0 },
  );
  const peakWorkingSet = samples.reduce(
    (peak, sample) =>
      Math.max(peak, sample.resources.workingSetBytes),
    0,
  );
  const peakPrivateBytes = samples.reduce(
    (peak, sample) =>
      Math.max(peak, sample.resources.privateBytes),
    0,
  );

  return {
    label,
    durationMs,
    sampleCount: samples.length,
    aggregate: resourceDelta(aggregateStart, aggregateEnd, elapsedMs),
    worstInterval: worstCpu,
    peakWorkingSetBytes: peakWorkingSet,
    peakPrivateBytes,
    startUi: samples[0].ui,
    endUi: completed.ui,
    samples,
  };
}

async function findProxyPort(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findProxyPort(entryPath);
      if (nested !== null) {
        return nested;
      }
    } else if (entry.name === "config.yaml") {
      const profile = await readFile(entryPath, "utf8");
      const match = profile.match(/^mixed-port:\s*(\d+)$/m);
      if (match) {
        return Number(match[1]);
      }
    }
  }

  return null;
}

function createTrafficTarget() {
  const activeResponses = new Set();
  const holder = {
    server: null,
    port: 0,
    close: async () => {
      for (const response of activeResponses) {
        response.destroy();
      }
      activeResponses.clear();
      await new Promise((resolve) => holder.server.close(resolve));
    },
  };

  holder.server = createServer((request, response) => {
    if (request.url === "/hold") {
      activeResponses.add(response);
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      });
      response.write(Buffer.alloc(4_096, 0x46));
      response.on("close", () => activeResponses.delete(response));
      return;
    }

    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
    });
    let remaining = 24;
    const timer = setInterval(() => {
      if (response.destroyed || remaining <= 0) {
        clearInterval(timer);
        response.end();
        return;
      }
      remaining -= 1;
      response.write(Buffer.alloc(64 * 1_024, 0x46));
    }, 20);
    response.on("close", () => clearInterval(timer));
  });

  return new Promise((resolve) => {
    holder.server.listen(0, "127.0.0.1", () => {
      holder.port = holder.server.address().port;
      resolve(holder);
    });
  });
}

function requestThroughProxy(proxyPort, targetPort, route, options = {}) {
  return new Promise((resolve, reject) => {
    const request = new ClientRequest({
      host: "127.0.0.1",
      port: proxyPort,
      method: "GET",
      path: `http://127.0.0.1:${targetPort}${route}`,
      headers: {
        Host: `127.0.0.1:${targetPort}`,
        Connection: "keep-alive",
      },
    });
    request.setTimeout(15_000, () => {
      request.destroy(new Error("Proxied traffic request timed out."));
    });
    request.on("error", reject);
    request.on("response", (response) => {
      if (options.hold) {
        resolve({ request, response });
        return;
      }
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk);
      });
      response.resume();
      response.on("end", () => resolve({ request, response, bytes }));
    });
    request.end();
  });
}

async function startTraffic(proxyPort, targetPort, durationMs) {
  let stopped = false;
  let bytesDownloaded = 0;
  let requestsStarted = 0;
  let errors = 0;
  const inFlight = new Set();

  const startRequest = () => {
    requestsStarted += 1;
    const promise = requestThroughProxy(proxyPort, targetPort, "/stream")
      .then(({ bytes }) => {
        bytesDownloaded += bytes;
      })
      .catch(() => {
        errors += 1;
      })
      .finally(() => {
        inFlight.delete(promise);
      });
    inFlight.add(promise);
  };

  const timer = setInterval(() => {
    if (!stopped) {
      startRequest();
    }
  }, 250);
  startRequest();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await Promise.race([
        Promise.allSettled([...inFlight]),
        delay(5_000),
      ]);
      return {
        durationMs,
        requestsStarted,
        errors,
        bytesDownloaded,
      };
    },
  };
}

async function openHeldConnections(proxyPort, targetPort, count) {
  const connections = [];

  for (let batchStart = 0; batchStart < count; batchStart += 20) {
    const batchEnd = Math.min(count, batchStart + 20);
    const batch = await Promise.allSettled(
      Array.from({ length: batchEnd - batchStart }, () =>
        requestThroughProxy(proxyPort, targetPort, "/hold", { hold: true }),
      ),
    );
    for (const result of batch) {
      if (result.status === "fulfilled") {
        connections.push(result.value);
      }
    }
    await delay(50);
  }

  return {
    requested: count,
    opened: connections.length,
    close: () => {
      for (const { request, response } of connections) {
        response.destroy();
        request.destroy();
      }
    },
  };
}

async function saveTheme(page, theme) {
  const settings = await page.invoke("get_settings");
  assert(
    settings?.ok,
    `Could not read settings before theme switch: ${JSON.stringify(settings)}`,
  );
  const saved = await page.invoke("save_settings", {
    settings: {
      ...settings.data,
      theme,
    },
  });
  assert(
    saved?.ok,
    `Could not save ${theme}: ${JSON.stringify(saved)}`,
  );

  const startedAt = Date.now();
  try {
    await page.evaluate("location.reload()");
  } catch {
    // Reload invalidates the current JavaScript execution context.
  }
  await delay(500);
  await page.waitFor(
    `document.readyState === "complete" &&
      document.documentElement.dataset.theme === ${JSON.stringify(theme)} &&
      document.querySelector(".app-frame") !== null`,
    `the ${theme} theme`,
    30_000,
  );
  return Date.now() - startedAt;
}

async function measureRouteRender(page, route, readyExpression, timeoutMs = 30_000) {
  const startedAt = Date.now();
  await page.evaluate(`location.hash = ${JSON.stringify(`#${route}`)};`);
  await page.waitFor(readyExpression, `${route} to render`, timeoutMs);
  await page.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  return Date.now() - startedAt;
}

async function showHiddenWindow() {
  await runPowerShell(`
    Add-Type -AssemblyName UIAutomationClient;
    Add-Type -AssemblyName UIAutomationTypes;

    $root = [System.Windows.Automation.AutomationElement]::RootElement;
    $buttonType = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    );
    $flowProxyName = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      "FlowProxy"
    );
    $trayButtonCondition = New-Object System.Windows.Automation.AndCondition(
      $buttonType,
      $flowProxyName
    );
    $trayClass = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ClassNameProperty,
      "Shell_TrayWnd"
    );
    $tray = $root.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      $trayClass
    );
    if (-not $tray) {
      throw "The Windows taskbar was not found.";
    }

    $trayButton = $tray.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      $trayButtonCondition
    );
    if (-not $trayButton) {
      $overflowId = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        "1502"
      );
      $overflowCondition = New-Object System.Windows.Automation.AndCondition(
        $buttonType,
        $overflowId
      );
      $overflowButton = $tray.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $overflowCondition
      );
      if (-not $overflowButton) {
        throw "The hidden-icons button was not found.";
      }
      $overflowInvoke = $overflowButton.GetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern
      );
      $overflowInvoke.Invoke();
      Start-Sleep -Milliseconds 300;

      $overflowClass = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty,
        "NotifyIconOverflowWindow"
      );
      $overflow = $root.FindFirst(
        [System.Windows.Automation.TreeScope]::Children,
        $overflowClass
      );
      if (-not $overflow) {
        throw "The notification-area overflow window was not found.";
      }
      $trayButton = $overflow.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $trayButtonCondition
      );
    }

    if (-not $trayButton) {
      throw "The FlowProxy tray icon was not found.";
    }
    $trayInvoke = $trayButton.GetCurrentPattern(
      [System.Windows.Automation.InvokePattern]::Pattern
    );
    $trayInvoke.Invoke();
  `);
  return Date.now();
}

const existingPid = await findFlowProxyPid(appExecutable);
assert(
  existingPid === null,
  `Stop FlowProxy process ${existingPid} before the Stage 6 performance run.`,
);

const browserPort = await findAvailablePort();
const startedAt = Date.now();
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
const appPid = child.pid;
let client = null;
let page = null;
let runtimeStarted = false;
let trafficTarget = null;
let traffic = null;
let heldConnections = null;
let currentStep = "launching FlowProxy";
const evidence = {
  timestamp: new Date().toISOString(),
  status: "started",
  host: {
    os: os.version(),
    platform: process.platform,
    architecture: process.arch,
    logicalProcessors: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(),
  },
  executable: appExecutable,
  mihomoExecutable,
  durations: scenarioDurations,
  sampling: {
    intervalMs: sampleIntervalMs,
    connectionPayload: largeConnectionCount,
  },
  startup: null,
  scenarios: {},
  interactions: {},
  cleanup: null,
};

try {
  assert(
    Number.isInteger(appPid) && appPid > 0,
    "FlowProxy did not return a process identifier.",
  );
  const target = await waitForPageTarget(browserPort, {
    expectedUrlPrefix: pageUrlPrefix,
    timeoutMs: 30_000,
  });
  client = createCdpClient(target.webSocketDebuggerUrl);
  page = createPage(client);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  currentStep = "waiting for interactive Overview";
  await page.waitFor(
    `document.readyState === "complete" &&
      document.querySelector(".app-frame") !== null &&
      document.querySelector(".page-viewport") !== null &&
      typeof window.__TAURI_INTERNALS__?.invoke === "function"`,
    "the interactive FlowProxy shell",
    30_000,
  );
  await page.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  evidence.startup = {
    interactiveMs: Date.now() - startedAt,
    targetUrl: target.url,
  };

  currentStep = "reading initial settings";
  const settings = await page.invoke("get_settings");
  assert(settings?.ok, `Initial settings failed: ${JSON.stringify(settings)}`);
  evidence.startup.settings = settings.data;
  if (settings.data.theme !== "cyber_flow") {
    await saveTheme(page, "cyber_flow");
  }
  await page.evaluate('location.hash = "/";');
  await page.waitFor(
    'document.querySelector(".connection-hero") !== null',
    "Overview for baseline measurement",
  );

  currentStep = "idle stopped-home baseline";
  evidence.scenarios.idle = await monitorScenario(
    page,
    appPid,
    "home_idle_stopped",
    scenarioDurations.idle,
  );

  currentStep = "starting Mihomo for stable baseline";
  await page.invoke("start_runtime").then((result) => {
    assert(result?.ok, `Mihomo start failed: ${JSON.stringify(result)}`);
    runtimeStarted = true;
  });
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "connected")`,
    "connected Mihomo for stable baseline",
    30_000,
  );
  await page.waitFor(
    "document.body.textContent?.includes('Connected') === true",
    "connected UI",
  );
  await delay(1_000);

  currentStep = "stable connected-home baseline";
  evidence.scenarios.stable = await monitorScenario(
    page,
    appPid,
    "home_stable_connected",
    scenarioDurations.stable,
  );

  currentStep = "locating loopback proxy port";
  const proxyPort = await findProxyPort(configRoot);
  assert(
    Number.isInteger(proxyPort) && proxyPort > 0,
    `No loopback proxy port was found below ${configRoot}.`,
  );
  trafficTarget = await createTrafficTarget();
  currentStep = "continuous loopback proxy traffic baseline";
  traffic = await startTraffic(
    proxyPort,
    trafficTarget.port,
    scenarioDurations.traffic,
  );
  evidence.scenarios.traffic = await monitorScenario(
    page,
    appPid,
    "home_continuous_traffic",
    scenarioDurations.traffic,
  );
  evidence.scenarios.traffic.generator = await traffic.stop();
  traffic = null;

  currentStep = "closing window to tray";
  await page.evaluate(
    'document.querySelector(".window-control-close")?.click();',
  );
  await page.waitFor(
    'document.documentElement.dataset.appVisibility === "hidden"',
    "the hidden-to-tray state",
    10_000,
  );
  await delay(1_000);

  currentStep = "hidden-to-tray baseline";
  evidence.scenarios.hidden = await monitorScenario(
    page,
    appPid,
    "tray_hidden_connected",
    scenarioDurations.hidden,
  );
  const hiddenUi = await readUiState(page);
  assert(
    hiddenUi.nativeVisibility === "hidden",
    `The window left the hidden state during sampling: ${JSON.stringify(hiddenUi)}`,
  );
  assert(
    hiddenUi.runningAnimations === 0,
    `Animations were still running while hidden: ${JSON.stringify(hiddenUi)}`,
  );

  currentStep = "showing the tray-hidden window";
  await showHiddenWindow();
  await delay(1_500);
  await page.evaluate("window.focus();");
  await page.waitFor(
    'document.documentElement.dataset.appVisibility !== "hidden"',
    "the native window to become visible again",
    10_000,
  );

  currentStep = "switching A/C themes";
  const warmSwitchMs = await saveTheme(page, "warm_flow");
  const warmUi = await readUiState(page);
  const cyberSwitchMs = await saveTheme(page, "cyber_flow");
  const cyberUi = await readUiState(page);
  evidence.interactions.themeSwitch = {
    toWarmFlowMs: warmSwitchMs,
    toCyberFlowMs: cyberSwitchMs,
    warmTheme: warmUi.theme,
    cyberTheme: cyberUi.theme,
  };
  assert(
    warmUi.theme === "warm_flow" && cyberUi.theme === "cyber_flow",
    `Theme persistence failed: ${JSON.stringify(evidence.interactions.themeSwitch)}`,
  );

  currentStep = "opening large Connections list";
  heldConnections = await openHeldConnections(
    proxyPort,
    trafficTarget.port,
    largeConnectionCount,
  );
  await delay(1_000);
  const connectionRenderMs = await measureRouteRender(
    page,
    "/connections",
    `document.querySelectorAll(".connection-row").length >= Math.min(20, ${largeConnectionCount})`,
  );
  const connectionUi = await readUiState(page);
  evidence.interactions.largeConnections = {
    renderMs: connectionRenderMs,
    requested: heldConnections.requested,
    opened: heldConnections.opened,
    renderedRows: connectionUi.connectionRows,
  };
  heldConnections.close();
  heldConnections = null;
  await delay(500);

  currentStep = "opening bounded Logs list";
  const logRenderMs = await measureRouteRender(
    page,
    "/logs",
    'document.querySelector(".logs-panel") !== null',
  );
  const logUi = await readUiState(page);
  evidence.interactions.logs = {
    renderMs: logRenderMs,
    renderedRows: logUi.logRows,
  };

  currentStep = "Mihomo restart recovery";
  const restartStartedAt = Date.now();
  const restart = await page.invoke("restart_runtime");
  assert(restart?.ok, `Mihomo restart failed: ${JSON.stringify(restart)}`);
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "connected")`,
    "Mihomo restart recovery",
    30_000,
  );
  const restartedCore = await page.invoke("get_core_info");
  evidence.interactions.restart = {
    recoveryMs: Date.now() - restartStartedAt,
    connected: restartedCore?.ok === true,
    corePid: restartedCore?.ok ? restartedCore.data.pid : null,
  };

  currentStep = "Mihomo crash and recovery";
  const coreBeforeCrash = await page.invoke("get_core_info");
  assert(
    coreBeforeCrash?.ok && Number.isInteger(coreBeforeCrash.data.pid),
    `Core PID unavailable before crash: ${JSON.stringify(coreBeforeCrash)}`,
  );
  process.kill(coreBeforeCrash.data.pid, "SIGKILL");
  const crashDetectedAt = Date.now();
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "error")`,
    "Mihomo crash detection",
    30_000,
  );
  const crashDetectionMs = Date.now() - crashDetectedAt;
  const recoveryStartedAt = Date.now();
  const recovered = await page.invoke("start_runtime");
  assert(
    recovered?.ok,
    `Crash recovery start failed: ${JSON.stringify(recovered)}`,
  );
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "connected")`,
    "Mihomo crash recovery",
    30_000,
  );
  evidence.interactions.crashRecovery = {
    detectionMs: crashDetectionMs,
    recoveryMs: Date.now() - recoveryStartedAt,
  };

  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.currentStep = currentStep;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  heldConnections?.close();
  if (traffic) {
    evidence.cleanup = {
      ...(evidence.cleanup ?? {}),
      traffic: await traffic.stop().catch(() => null),
    };
  }
  if (trafficTarget) {
    await trafficTarget.close().catch(() => undefined);
  }
  if (page) {
    try {
      await Promise.race([page.invoke("stop_runtime"), delay(5_000)]);
    } catch {
      // Continue to controlled exit.
    }
    try {
      await Promise.race([
        page.invoke("request_application_exit"),
        delay(5_000),
      ]);
    } catch {
      // app.exit can close CDP before responding.
    }
  }
  client?.close();

  const exited = await waitForProcessExit(appPid, 15_000);
  if (!exited) {
    await terminateProcessTree(appPid).catch(() => undefined);
    child.kill();
    evidence.cleanup = {
      ...(evidence.cleanup ?? {}),
      forcedTermination: true,
    };
  } else {
    evidence.cleanup = {
      ...(evidence.cleanup ?? {}),
      controlledExit: true,
    };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`Stage 6 performance evidence written to ${outputPath}\n`);
