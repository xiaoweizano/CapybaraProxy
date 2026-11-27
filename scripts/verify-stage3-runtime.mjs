import { spawn } from "node:child_process";
import { ClientRequest, createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const browserPort = process.env.CAPYBARA_CDP_PORT ?? "9222";
const browserUrl = `http://127.0.0.1:${browserPort}`;
const configRoot =
  process.env.CAPYBARA_CONFIG_ROOT ??
  path.join(
    process.env.APPDATA ??
      (() => {
        throw new Error("APPDATA is unavailable.");
      })(),
    "com.capybara.proxy",
  );
const actionTimeoutMs = 15_000;

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
      // The Tauri WebView is still starting.
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

  async function waitFor(expression, description) {
    const deadline = Date.now() + actionTimeoutMs;

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

async function findConfigFile(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findConfigFile(entryPath);
      if (nested) {
        return nested;
      }
    } else if (entry.name === "config.yaml") {
      return entryPath;
    }
  }

  return null;
}

async function readLoopbackPorts(configFile) {
  const profile = await readFile(configFile, "utf8");
  const api = profile.match(/^external-controller:\s*127\.0\.0\.1:(\d+)$/m);
  const proxy = profile.match(/^mixed-port:\s*(\d+)$/m);

  assert(api, "The active profile has no loopback control API port.");
  assert(proxy, "The active profile has no loopback mixed proxy port.");

  return {
    apiPort: Number(api[1]),
    proxyPort: Number(proxy[1]),
  };
}

async function listeningSocketsForPid(pid) {
  const result = await run("C:/Windows/System32/NETSTAT.EXE", [
    "-ano",
    "-p",
    "tcp",
  ]);
  assert(result.code === 0, `NETSTAT failed: ${result.stderr}`);

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (columns) =>
        columns.length >= 5 &&
        columns[0].toUpperCase() === "TCP" &&
        columns[3].toUpperCase() === "LISTENING" &&
        columns[4] === String(pid),
    )
    .map((columns) => columns[1]);
}

function assertLoopbackListeners(addresses, ports) {
  for (const port of ports) {
    const listeners = addresses.filter((address) =>
      address.endsWith(`:${port}`),
    );
    assert(
      listeners.length > 0,
      `Mihomo is not listening on expected port ${port}.`,
    );
    assert(
      listeners.every((address) => address.startsWith("127.0.0.1:")),
      `Mihomo exposed a non-loopback listener on port ${port}: ${listeners.join(
        ", ",
      )}`,
    );
  }
}

function startHoldingTarget() {
  return new Promise((resolve) => {
    const holder = {
      server: null,
      port: 0,
      release: null,
    };
    holder.server = createServer((request, response) => {
      holder.release = () => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("CapybaraProxy stage 3 active connection");
      };
      if (request.url === "/hold") {
        return;
      }
      holder.release();
    });
    holder.server.listen(0, "127.0.0.1", () => {
      holder.port = holder.server.address().port;
      resolve(holder);
    });
  });
}

function openProxiedRequest(proxyPort, targetPort) {
  return new Promise((resolve, reject) => {
    const request = new ClientRequest({
      host: "127.0.0.1",
      port: proxyPort,
      method: "GET",
      path: `http://127.0.0.1:${targetPort}/hold`,
      headers: {
        Host: `127.0.0.1:${targetPort}`,
      },
    });

    request.setTimeout(actionTimeoutMs, () => {
      request.destroy(new Error("The proxied test request timed out."));
    });
    request.on("error", reject);
    request.on("response", (response) => {
      response.resume();
      response.on("end", () => resolve(request));
    });
    request.end();
  });
}

const pageTarget = await findPageTarget();
const client = createCdpClient(pageTarget.webSocketDebuggerUrl);
const page = createPage(client);
const evidence = {
  releaseUrl: pageTarget.url,
  initialBackend: null,
  startedState: null,
  duplicateStart: null,
  coreInfo: null,
  proxyGroups: 0,
  proxySelection: null,
  delayTest: null,
  rules: 0,
  profiles: 0,
  activeConnections: 0,
  crashState: null,
  restartedPid: null,
  stoppedState: null,
};
let holdingTarget = null;

try {
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await page.waitFor(
    `document.readyState === "complete" &&
      document.querySelector(".app-frame") !== null &&
      typeof window.__TAURI_INTERNALS__?.invoke === "function"`,
    "the CapybaraProxy application shell",
  );

  assert(
    pageTarget.url.startsWith("http://tauri.localhost/"),
    `Expected the embedded production frontend, received ${pageTarget.url}.`,
  );

  const initial = await page.invoke("get_runtime_snapshot");
  assert(initial.ok, `Initial snapshot failed: ${JSON.stringify(initial)}`);
  assert(initial.data.backend === "mihomo", "Release app is not using Mihomo.");
  assert(
    initial.data.state === "stopped" || initial.data.state === "error",
    `Unexpected initial Runtime state: ${initial.data.state}`,
  );
  evidence.initialBackend = initial.data.backend;

  const started = await page.invoke("start_runtime");
  assert(started.ok, `Mihomo start failed: ${JSON.stringify(started)}`);
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "connected")`,
    "the Mihomo Runtime to become connected",
  );
  const startedSnapshot = await page.invoke("get_runtime_snapshot");
  assert(
    startedSnapshot.ok && startedSnapshot.data.state === "connected",
    `Mihomo did not reach connected state: ${JSON.stringify(
      startedSnapshot,
    )}`,
  );
  evidence.startedState = startedSnapshot.data.state;

  const duplicateStart = await page.invoke("start_runtime");
  assert(
    duplicateStart.ok === false &&
      duplicateStart.error.code === "already_running" &&
      duplicateStart.error.retryable === false,
    `Duplicate start returned an unexpected result: ${JSON.stringify(
      duplicateStart,
    )}`,
  );
  evidence.duplicateStart = duplicateStart.error.code;

  const coreInfo = await page.invoke("get_core_info");
  assert(coreInfo.ok, `Core info failed: ${JSON.stringify(coreInfo)}`);
  assert(
    coreInfo.data.backend === "mihomo" &&
      coreInfo.data.version === "v1.19.33" &&
      Number.isInteger(coreInfo.data.pid),
    `Unexpected core info: ${JSON.stringify(coreInfo.data)}`,
  );
  evidence.coreInfo = coreInfo.data;

  const configFile = await findConfigFile(configRoot);
  assert(configFile, `No active Mihomo profile found below ${configRoot}.`);
  const { apiPort, proxyPort } = await readLoopbackPorts(configFile);
  const listeners = await listeningSocketsForPid(coreInfo.data.pid);
  assertLoopbackListeners(listeners, [apiPort, proxyPort]);
  evidence.loopbackListeners = listeners.filter((address) =>
    [apiPort, proxyPort].some((port) => address.endsWith(`:${port}`)),
  );

  const groups = await page.invoke("get_proxy_groups");
  assert(groups.ok, `Proxy groups failed: ${JSON.stringify(groups)}`);
  assert(groups.data.length > 0, "Mihomo returned no proxy groups.");
  assert(
    groups.data[0].nodes.some((node) => node.name === "DIRECT"),
    "The direct proxy node is missing.",
  );
  evidence.proxyGroups = groups.data.length;

  const selection = await page.invoke("select_proxy", {
    group: groups.data[0].name,
    proxy: "DIRECT",
  });
  assert(selection.ok, `Proxy selection failed: ${JSON.stringify(selection)}`);
  evidence.proxySelection = "DIRECT";

  const delayTest = await page.invoke("test_proxy_delay", {
    proxy: "DIRECT",
    timeoutMs: 3_000,
  });
  evidence.delayTest = delayTest.ok
    ? { ok: true, delay_ms: delayTest.data }
    : {
        ok: false,
        code: delayTest.error.code,
        message: delayTest.error.message,
      };

  holdingTarget = await startHoldingTarget();
  const heldResponse = openProxiedRequest(proxyPort, holdingTarget.port);
  await Promise.race([
    delay(1_000).then(() => null),
    heldResponse.then(
      () => null,
      (error) => {
        throw error;
      },
    ),
  ]);

  const connections = await page.invoke("get_connections");
  assert(
    connections.ok,
    `Connection page failed: ${JSON.stringify(connections)}`,
  );
  assert(
    connections.data.connections.length > 0,
    "The live proxy request did not appear in active connections.",
  );
  evidence.activeConnections = connections.data.connections.length;

  const connectionId = connections.data.connections[0].id;
  const closeConnection = await page.invoke("close_connection", {
    connectionId,
  });
  assert(
    closeConnection.ok ||
      closeConnection.error.code === "connection_not_found",
    `Closing the live connection failed: ${JSON.stringify(closeConnection)}`,
  );

  holdingTarget?.release?.();
  await heldResponse.catch(() => undefined);
  await new Promise((resolve) => holdingTarget.server.close(resolve));
  holdingTarget = null;

  const telemetry = await page.invoke("get_telemetry");
  assert(telemetry.ok, `Telemetry failed: ${JSON.stringify(telemetry)}`);
  assert(
    telemetry.data.state === "connected" &&
      telemetry.data.timestamp_ms > 0 &&
      Number.isInteger(telemetry.data.active_connections),
    `Unexpected telemetry payload: ${JSON.stringify(telemetry.data)}`,
  );

  const rules = await page.invoke("get_rules");
  assert(rules.ok, `Rules failed: ${JSON.stringify(rules)}`);
  assert(
    rules.data.some((rule) => rule.rule_type.toLowerCase() === "match"),
    "The MATCH rule is missing from the live rule table.",
  );
  evidence.rules = rules.data.length;

  const profiles = await page.invoke("get_profiles");
  assert(profiles.ok, `Profiles failed: ${JSON.stringify(profiles)}`);
  assert(
    profiles.data.some(
      (profile) => profile.name === "CapybaraProxy Direct" && profile.active,
    ),
    "The active CapybaraProxy Direct profile is missing.",
  );
  evidence.profiles = profiles.data.length;

  process.kill(coreInfo.data.pid, "SIGKILL");
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "error")`,
    "crash detection",
  );
  const crashed = await page.invoke("get_runtime_snapshot");
  assert(
    crashed.ok &&
      crashed.data.state === "error" &&
      crashed.data.last_error?.code === "core_unavailable",
    `Crash was not reported correctly: ${JSON.stringify(crashed)}`,
  );
  evidence.crashState = crashed.data.state;

  const recovered = await page.invoke("start_runtime");
  assert(recovered.ok, `Recovery start failed: ${JSON.stringify(recovered)}`);
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "connected")`,
    "the recovered Mihomo Runtime to become connected",
  );
  const recoveredInfo = await page.invoke("get_core_info");
  assert(
    recoveredInfo.ok &&
      Number.isInteger(recoveredInfo.data.pid) &&
      recoveredInfo.data.pid !== coreInfo.data.pid,
    `Recovered Mihomo PID is invalid: ${JSON.stringify(recoveredInfo)}`,
  );
  evidence.restartedPid = recoveredInfo.data.pid;

  const restarted = await page.invoke("restart_runtime");
  assert(restarted.ok, `Restart failed: ${JSON.stringify(restarted)}`);
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "connected")`,
    "the restarted Mihomo Runtime to become connected",
  );

  const stopped = await page.invoke("stop_runtime");
  assert(
    stopped.ok && stopped.data.state === "stopped",
    `Stop failed: ${JSON.stringify(stopped)}`,
  );
  evidence.stoppedState = stopped.data.state;

  const stoppedCoreInfo = await page.invoke("get_core_info");
  assert(
    stoppedCoreInfo.ok === false,
    "Core info remained available after stopping Mihomo.",
  );

  const remaining = await run("C:/Windows/System32/tasklist.exe", [
    "/FI",
    "IMAGENAME eq mihomo-windows-amd64.exe",
    "/FO",
    "CSV",
    "/NH",
  ]);
  assert(
    !remaining.stdout.includes("mihomo-windows-amd64.exe"),
    `A Mihomo process remains after stop: ${remaining.stdout}`,
  );

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  holdingTarget?.release?.();
  if (holdingTarget) {
    await new Promise((resolve) => holdingTarget.server.close(resolve));
  }
  client.close();
}
