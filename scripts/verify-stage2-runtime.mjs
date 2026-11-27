import process from "node:process";

const browserPort = process.env.CAPYBARA_CDP_PORT ?? "9333";
const browserUrl = `http://127.0.0.1:${browserPort}`;
const actionTimeoutMs = 15_000;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
          return page.webSocketDebuggerUrl;
        }
      }
    } catch {
      // The desktop WebView is still starting.
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

  async function clickButtonByText(text) {
    const result = await evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent.trim() === ${JSON.stringify(text)}
      );
      if (!button) return "missing";
      if (button.disabled) return "disabled";
      button.click();
      return "clicked";
    })()`);

    if (result !== "clicked") {
      throw new Error(`Could not click "${text}": ${result}.`);
    }
  }

  async function clickButtonByLabel(label) {
    const result = await evaluate(`(() => {
      const button = document.querySelector(
        ${JSON.stringify(`button[aria-label="${label}"]`)}
      );
      if (!button) return "missing";
      if (button.disabled) return "disabled";
      button.click();
      return "clicked";
    })()`);

    if (result !== "clicked") {
      throw new Error(`Could not click "${label}": ${result}.`);
    }
  }

  async function waitForRuntimeState(label) {
    await waitFor(
      `document.querySelector(".runtime-state-copy strong")?.textContent.trim() === ${JSON.stringify(label)}`,
      `Runtime state ${label}`,
    );
  }

  async function runtimeSequence() {
    return evaluate(`(() => {
      const text = document.querySelector(".runtime-state-copy small")?.textContent ?? "";
      const match = text.match(/Sequence (\\d+)/);
      return match ? Number(match[1]) : null;
    })()`);
  }

  return {
    evaluate,
    waitFor,
    clickButtonByText,
    clickButtonByLabel,
    waitForRuntimeState,
    runtimeSequence,
  };
}

const webSocketUrl = await findPageTarget();
const client = createCdpClient(webSocketUrl);
const page = createPage(client);

try {
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await page.waitFor(
    `document.readyState === "complete" &&
      document.querySelector(".app-frame") !== null &&
      document.querySelector('nav[aria-label="Primary navigation"]') !== null`,
    "the CapybaraProxy application shell",
  );
  await page.evaluate(`location.hash = "#/settings"; true`);
  await page.waitFor(
    `document.querySelector("#runtime-demo-title") !== null`,
    "the Settings page",
  );
  await page.waitFor(
    `document.body.innerText.toLowerCase().includes("desktop settings")`,
    "the native settings source",
  );
  await page.waitForRuntimeState("Stopped");

  await page.clickButtonByText("Start");
  await page.waitForRuntimeState("Running (not connected)");
  const sequenceAfterStart = await page.runtimeSequence();

  const duplicateStart = await page.evaluate(
    `window.__TAURI_INTERNALS__.invoke("start_runtime")`,
  );
  if (
    duplicateStart?.ok !== false ||
    duplicateStart?.error?.code !== "already_running" ||
    duplicateStart?.error?.retryable !== false
  ) {
    throw new Error(
      `Duplicate start did not return the typed error: ${JSON.stringify(duplicateStart)}`,
    );
  }

  await page.clickButtonByText("Restart");
  await page.waitForRuntimeState("Running (not connected)");
  const sequenceAfterRestart = await page.runtimeSequence();
  if (
    !Number.isInteger(sequenceAfterStart) ||
    !Number.isInteger(sequenceAfterRestart) ||
    sequenceAfterRestart <= sequenceAfterStart
  ) {
    throw new Error("Runtime sequence did not advance after Restart.");
  }

  await page.clickButtonByText("Simulate crash");
  await page.waitForRuntimeState("Error");
  const crashMessage = await page.evaluate(
    `document.querySelector(".runtime-log-list li[data-level='error'] span")?.textContent?.trim() ?? ""`,
  );
  if (!crashMessage.includes("simulated an unexpected core exit")) {
    throw new Error(`Simulated crash log was not visible: ${crashMessage}`);
  }

  await page.clickButtonByText("Start");
  await page.waitForRuntimeState("Running (not connected)");
  await page.clickButtonByText("Stop");
  await page.waitForRuntimeState("Stopped");

  await page.clickButtonByLabel("Use Warm Flow theme");
  await page.waitFor(
    `document.documentElement.dataset.theme === "warm_flow" &&
      document.querySelector('button[aria-label="Use Warm Flow theme"]')?.getAttribute("aria-pressed") === "true"`,
    "the Warm Flow theme update",
  );

  await client.send("Page.reload", { ignoreCache: true });
  await page.waitFor(
    `document.readyState === "complete" &&
      document.body.innerText.toLowerCase().includes("desktop settings")`,
    "the reloaded native settings",
  );
  await page.waitFor(
    `document.documentElement.dataset.theme === "warm_flow"`,
    "Warm Flow after page reload",
  );

  await page.clickButtonByLabel("Use Cyber Flow theme");
  await page.waitFor(
    `document.documentElement.dataset.theme === "cyber_flow"`,
    "the restored Cyber Flow theme",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        duplicateStart: duplicateStart.error.code,
        sequenceAfterStart,
        sequenceAfterRestart,
        crashMessage,
        themePersistedAcrossReload: true,
        finalRuntimeState: "Stopped",
        finalTheme: "cyber_flow",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  client.close();
}
