import { spawn } from "node:child_process";
import { createServer } from "node:net";

export const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : null;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  assert(Number.isInteger(port) && port > 0, "Could not allocate a CDP port.");
  return port;
}

export async function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
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

export async function runPowerShell(script) {
  const result = await run("C:/Program Files/PowerShell/7/pwsh.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  assert(
    result.code === 0,
    `PowerShell failed: ${result.stderr || result.stdout}`,
  );
  return result.stdout.trim();
}

export async function waitForPageTarget(
  browserPort,
  { expectedUrlPrefix = null, timeoutMs = 30_000 } = {},
) {
  const browserUrl = `http://127.0.0.1:${browserPort}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${browserUrl}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const pages = targets.filter(
          (target) =>
            target.type === "page" &&
            typeof target.webSocketDebuggerUrl === "string",
        );
        const page = expectedUrlPrefix
          ? pages.find((target) => target.url.startsWith(expectedUrlPrefix))
          : pages[0];
        if (page) {
          return page;
        }
      }
    } catch {
      // WebView2 is still starting.
    }

    await delay(250);
  }

  throw new Error("CapybaraProxy WebView2 CDP endpoint did not become available.");
}

export function createCdpClient(webSocketUrl) {
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

export function createPage(client) {
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

  async function waitFor(expression, description, timeoutMs = 20_000) {
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

export async function processIdsStillAlive(ids) {
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

export async function waitForProcessExit(pid, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await processIdsStillAlive([pid])).length === 0) {
      return true;
    }
    await delay(250);
  }
  return false;
}

export async function findCapybaraProxyPid(executable) {
  const normalizedExecutable = executable.toLowerCase().replaceAll("'", "''");
  const output = await runPowerShell(`
    $target = '${normalizedExecutable}';
    Get-CimInstance Win32_Process -Filter "Name = 'capybara-desktop.exe'" |
      Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.ToLowerInvariant() -eq $target
      } |
      Select-Object -First 1 -ExpandProperty ProcessId
  `);
  const pid = Number(output);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export async function terminateProcessTree(rootPid) {
  if (!rootPid) {
    return;
  }

  await runPowerShell(`
    $rootPid = ${rootPid};
    $processes = Get-CimInstance Win32_Process |
      Select-Object ProcessId, ParentProcessId;
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
    $ids |
      Where-Object { $_ -ne $PID } |
      ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
  `);
}
