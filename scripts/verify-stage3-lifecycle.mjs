import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const browserPort = process.env.CAPYBARA_CDP_PORT ?? "9222";
const browserUrl = `http://127.0.0.1:${browserPort}`;
const appExecutable = path.resolve(
  process.env.CAPYBARA_APP_EXECUTABLE ??
    "F:/codex-proxy/target/release/capybara-desktop.exe",
);
const resultPath = path.resolve(
  "artifacts/stage3-lifecycle-audit.json",
);
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function runPowerShell(script) {
  const result = await run("C:/Program Files/PowerShell/7/pwsh.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  assert(
    result.code === 0,
    `PowerShell process inspection failed: ${result.stderr}`,
  );
  return result.stdout.trim();
}

async function findApplicationPid() {
  const configuredPid = Number(process.env.CAPYBARA_APP_PID);
  if (Number.isInteger(configuredPid) && configuredPid > 0) {
    return configuredPid;
  }

  const normalizedExecutable = appExecutable
    .toLowerCase()
    .replaceAll("'", "''");
  const output = await runPowerShell(`
    $target = '${normalizedExecutable}';
    Get-CimInstance Win32_Process -Filter "Name = 'capybara-desktop.exe'" |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant() -eq $target } |
      Select-Object -First 1 -ExpandProperty ProcessId
  `);
  const pid = Number(output);
  assert(Number.isInteger(pid) && pid > 0, "CapybaraProxy release process was not found.");
  return pid;
}

async function processSnapshot(rootPid) {
  const output = await runPowerShell(`
    $rootPid = ${rootPid};
    $processes = Get-CimInstance Win32_Process |
      Select-Object ProcessId, ParentProcessId, Name;
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
          cpu_seconds = if ($null -eq $live.CPU) { 0 } else { [double]$live.CPU };
          working_set_bytes = [long]$live.WorkingSet64;
        }
      }
    }

    @($rows) | ConvertTo-Json -Compress
  `);
  const parsed = JSON.parse(output || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

function summarizeSnapshot(processes) {
  return {
    processCount: processes.length,
    cpuSeconds: Number(
      processes
        .reduce((total, entry) => total + entry.cpu_seconds, 0)
        .toFixed(3),
    ),
    workingSetBytes: processes.reduce(
      (total, entry) => total + entry.working_set_bytes,
      0,
    ),
    processes,
  };
}

function resourceRate(start, end, elapsedMs) {
  const cpuDelta = Math.max(0, end.cpuSeconds - start.cpuSeconds);
  const seconds = elapsedMs / 1_000;
  return {
    elapsedMs,
    cpuSeconds: Number(cpuDelta.toFixed(3)),
    systemCpuPercent: Number(
      ((cpuDelta / (seconds * os.availableParallelism())) * 100).toFixed(2),
    ),
    workingSetBytes: end.workingSetBytes,
  };
}

async function processIdsStillAlive(ids) {
  if (ids.length === 0) {
    return [];
  }

  const output = await runPowerShell(`
    $ids = @(${ids.join(",")});
    @(
      Get-Process -Id $ids -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Id
    ) | ConvertTo-Json -Compress
  `);
  const parsed = JSON.parse(output || "[]");
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${browserUrl}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) =>
            target.type === "page" &&
            typeof target.webSocketDebuggerUrl === "string",
        );
        if (page) {
          return page;
        }
      }
    } catch {
      // The WebView is still starting.
    }

    await delay(250);
  }

  throw new Error("CapybaraProxy WebView2 CDP endpoint did not become available.");
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pendingCommands = new Map();
  let nextCommandId = 1;

  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    const pending = pendingCommands.get(message.id);

    if (!pending) {
      return;
    }

    pendingCommands.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  };

  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () =>
      reject(new Error("Could not connect to the CapybaraProxy WebView."));
  });

  return {
    async send(method, params = {}) {
      await ready;
      const id = nextCommandId;
      nextCommandId += 1;

      return new Promise((resolve, reject) => {
        pendingCommands.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

function createPage(client) {
  async function evaluate(expression) {
    const response = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (response.exceptionDetails) {
      const detail =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text;
      throw new Error(`Page evaluation failed: ${detail}`);
    }

    return response.result.value;
  }

  async function waitFor(expression, description, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await evaluate(expression)) {
        return;
      }
      await delay(200);
    }

    throw new Error(`Timed out waiting for ${description}.`);
  }

  async function invoke(command, args) {
    return evaluate(`(() => window.__TAURI_INTERNALS__.invoke(
      ${JSON.stringify(command)},
      ${JSON.stringify(args ?? {})}
    ))()`);
  }

  return { evaluate, invoke, waitFor };
}

async function readUiState(page) {
  return page.evaluate(`(() => {
    const text = document.body.textContent ?? "";
    const countMatches = [...text.matchAll(/(\\d+)\\s+samples?/gi)];
    const countValues = countMatches.map((match) => Number(match[1]));
    return {
      documentVisibility: document.visibilityState,
      nativeVisibility:
        document.documentElement.dataset.appVisibility ?? "visible",
      sampleCount: countValues.length > 0 ? Math.max(...countValues) : null,
      hasOverview: Boolean(document.querySelector(".connection-hero")),
      connected: text.includes("Connected"),
    };
  })()`);
}

await mkdir(path.dirname(resultPath), { recursive: true });

const appPid = await findApplicationPid();
const target = await findPageTarget();
const client = createCdpClient(target.webSocketDebuggerUrl);
const page = createPage(client);
let audit;

try {
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await page.evaluate('location.hash = "/";');
  await page.waitFor(
    'document.querySelector(".connection-hero") !== null',
    "the Overview page",
  );
  const startResult = await page.invoke("start_runtime");
  assert(
    startResult?.ok,
    `CapybaraProxy Runtime did not start: ${JSON.stringify(startResult)}`,
  );
  await page.waitFor(
    `document.body.textContent?.includes("Connected") === true`,
    "the connected Mihomo state",
  );
  await page.waitFor(
    `(() => /(\\d+)\\s+samples?/i.test(document.body.textContent ?? ""))()`,
    "live telemetry samples",
  );

  const visibleUiStart = await readUiState(page);
  const visibleProcessStart = summarizeSnapshot(
    await processSnapshot(appPid),
  );
  const visibleStartedAt = Date.now();
  await delay(3_200);
  const visibleElapsedMs = Date.now() - visibleStartedAt;
  const visibleProcessEnd = summarizeSnapshot(
    await processSnapshot(appPid),
  );
  const visibleUiEnd = await readUiState(page);

  assert(visibleUiStart.nativeVisibility === "visible", "Window was not visible.");
  assert(visibleUiEnd.connected, "Mihomo was not connected during the resource sample.");
  assert(
    visibleUiEnd.sampleCount > visibleUiStart.sampleCount,
    "Visible telemetry samplers did not advance.",
  );

  await page.evaluate(
    'document.querySelector(".window-control-close")?.click();',
  );
  await page.waitFor(
    'document.documentElement.dataset.appVisibility === "hidden"',
    "the hidden application state",
  );
  await delay(1_500);

  const hiddenUiStart = await readUiState(page);
  const hiddenProcessStart = summarizeSnapshot(
    await processSnapshot(appPid),
  );
  const hiddenStartedAt = Date.now();
  await delay(3_200);
  const hiddenElapsedMs = Date.now() - hiddenStartedAt;
  const hiddenProcessEnd = summarizeSnapshot(
    await processSnapshot(appPid),
  );
  const hiddenUiEnd = await readUiState(page);

  assert(
    hiddenUiStart.nativeVisibility === "hidden" &&
      hiddenUiEnd.nativeVisibility === "hidden",
    "Close action did not leave the application in the hidden state.",
  );
  assert(
    hiddenUiStart.sampleCount === hiddenUiEnd.sampleCount,
    "Telemetry continued sampling while the window was hidden.",
  );

  const mihomoPids = hiddenProcessStart.processes
    .filter((entry) => entry.name.toLowerCase().includes("mihomo"))
    .map((entry) => entry.id);
  assert(mihomoPids.length === 1, "Expected exactly one managed Mihomo process.");

  audit = {
    timestamp: new Date().toISOString(),
    appPid,
    resources: {
      visible: {
        ...resourceRate(
          visibleProcessStart,
          visibleProcessEnd,
          visibleElapsedMs,
        ),
        processCount: visibleProcessEnd.processCount,
        processNames: visibleProcessEnd.processes.map((entry) => entry.name),
      },
      hidden: {
        ...resourceRate(
          hiddenProcessStart,
          hiddenProcessEnd,
          hiddenElapsedMs,
        ),
        processCount: hiddenProcessEnd.processCount,
        processNames: hiddenProcessEnd.processes.map((entry) => entry.name),
      },
    },
    visibility: {
      beforeClose: visibleUiEnd,
      afterClose: hiddenUiStart,
      hiddenAfterThreeSeconds: hiddenUiEnd,
    },
    processesBeforeExit: hiddenProcessEnd.processes,
    exit: {
      commandAccepted: false,
      mihomoPids,
      appStillAlive: [],
      mihomoStillAlive: [],
    },
  };

  try {
    await page.invoke("request_application_exit");
    audit.exit.commandAccepted = true;
  } catch {
    // app.exit can close the CDP socket before the command response arrives.
  }
} finally {
  client.close();
}

const exitDeadline = Date.now() + 15_000;
let livePids = [appPid];

while (Date.now() < exitDeadline) {
  livePids = await processIdsStillAlive([appPid]);
  if (livePids.length === 0) {
    break;
  }
  await delay(250);
}

const liveMihomoPids = await processIdsStillAlive(audit.exit.mihomoPids);
audit.exit.appStillAlive = livePids;
audit.exit.mihomoStillAlive = liveMihomoPids;
await writeFile(resultPath, `${JSON.stringify(audit, null, 2)}\n`);

assert(livePids.length === 0, "CapybaraProxy did not exit after the controlled exit request.");
assert(
  liveMihomoPids.length === 0,
  "Mihomo was not cleaned up after CapybaraProxy exited.",
);

process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
process.stdout.write(`Lifecycle audit written to ${resultPath}\n`);
