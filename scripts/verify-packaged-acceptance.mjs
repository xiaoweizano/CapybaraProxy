// End-to-end acceptance for the packaged build.
//
// Release builds do not expose `__TAURI_INTERNALS__`, so this script drives
// the real UI the way an operator would: navigate to Profiles, paste a
// subscription, import it, then start the Runtime from the Overview page and
// read the resulting state off the DOM.
//
// Environment:
//   CAPYBARA_APP_EXECUTABLE  installed capybara-desktop.exe
//   CAPYBARA_SUBSCRIPTION    path to a subscription YAML fixture
//   CAPYBARA_EVIDENCE        output JSON path
//   CAPYBARA_ARTIFACTS       directory for screenshots

import { spawn, execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  assert,
  createCdpClient,
  createPage,
  delay,
  findAvailablePort,
  terminateProcessTree,
  waitForPageTarget,
} from "./lib/tauri-cdp.mjs";

const execFileAsync = promisify(execFile);

const appExecutable = path.resolve(
  process.env.CAPYBARA_APP_EXECUTABLE ??
    "F:/新建文件夹/CapybaraProxy/capybara-desktop.exe",
);
const subscriptionPath = path.resolve(
  process.env.CAPYBARA_SUBSCRIPTION ??
    "F:/codex-install/subscriptions/test-sub.yaml",
);
const evidencePath = path.resolve(
  process.env.CAPYBARA_EVIDENCE ?? "artifacts/stage6-packaged-acceptance.json",
);
const artifactDirectory = path.resolve(
  process.env.CAPYBARA_ARTIFACTS ?? "artifacts/screenshots/packaged-acceptance",
);
const pageUrlPrefix = "http://tauri.localhost/";

const evidence = {
  startedAt: new Date().toISOString(),
  appExecutable,
  subscription: subscriptionPath,
  steps: [],
  screenshots: [],
  result: "running",
};

function record(step, detail = {}) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`[${step}]`, JSON.stringify(detail));
}

async function main() {
  const subscriptionYaml = await readFile(subscriptionPath, "utf8");
  record("subscription-loaded", { bytes: subscriptionYaml.length });
  await mkdir(artifactDirectory, { recursive: true });

  const browserPort = await findAvailablePort();
  // CAPYBARA_MIHOMO_PATH is deliberately cleared: the bundle must locate the
  // core it ships.
  const child = spawn(appExecutable, [], {
    cwd: path.dirname(appExecutable),
    env: {
      ...process.env,
      CAPYBARA_MIHOMO_PATH: "",
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
  evidence.appPid = child.pid;

  let client = null;
  try {
    const target = await waitForPageTarget(browserPort, {
      expectedUrlPrefix: pageUrlPrefix,
      timeoutMs: 45_000,
    });
    client = createCdpClient(target.webSocketDebuggerUrl);
    const page = createPage(client);
    await page.waitFor("document.readyState === 'complete'", "page load", 30_000);
    record("app-ready", { browserPort });

    // The window starts hidden (`visible: false` in tauri.conf.json) and the
    // shell mirrors that into `data-app-visibility`, which pauses animations
    // and hides the body. Reveal the window the way the tray does. If the
    // native reveal does not reach the renderer in time, set the flag directly:
    // this is exactly what the native `app-visibility` event would do.
    await showMainWindow();
    await delay(1_500);
    const shellVisible = await page
      .waitFor(
        `document.documentElement.dataset.appVisibility === "visible" &&
         document.querySelector(".app-frame") !== null`,
        "the application shell",
        10_000,
      )
      .then(() => true)
      .catch(() => false);
    if (!shellVisible) {
      await page.evaluate(`
        (() => {
          document.documentElement.dataset.appVisibility = "visible";
          window.dispatchEvent(new CustomEvent("capybara:app-visibility", {
            detail: { hidden: false },
          }));
        })()
      `);
      await page.waitFor(
        `document.querySelector(".app-frame") !== null`,
        "the application shell after forcing visibility",
        20_000,
      );
      record("visibility-forced", {});
    }
    record("shell-mounted", {
      visibility: await page.evaluate(
        `document.documentElement.dataset.appVisibility`,
      ),
    });

    await screenshot(page, "overview-initial", client);

    await page.evaluate(`document.querySelector('[aria-label="Profiles"]').click()`);
    await page.waitFor(
      `document.querySelector(".profile-list, .workspace-empty") !== null`,
      "the Profiles workspace",
      20_000,
    );
    const initialProfiles = await page.evaluate(
      `Array.from(document.querySelectorAll(".profile-card strong")).map((node) => node.textContent)`,
    );
    record("profiles-before-import", { profiles: initialProfiles });
    await screenshot(page, "profiles-before-import", client);

    // A previous run may have left a subscription behind; the import form is
    // hidden while one is active, so clear it first.
    if (initialProfiles.includes("Acceptance subscription")) {
      await page.evaluate(`
        (() => {
          const button = document.querySelector(
            'button[aria-label="Remove subscription"]');
          button.click();
        })()
      `);
      await page.waitFor(
        `document.querySelector('[role="tab"]') !== null`,
        "the subscription form after clearing",
        20_000,
      );
      record("cleared-previous-subscription");
    }

    // Switch to the YAML tab and fill the form through real DOM events.
    await page.evaluate(`
      (() => {
        const tab = Array.from(document.querySelectorAll('[role="tab"]'))
          .find((node) => node.textContent.includes("Paste YAML"));
        tab.click();
      })()
    `);
    await page.waitFor(
      `document.querySelector('textarea') !== null`,
      "the YAML field",
      5_000,
    );

    await setReactInputValue(
      page,
      'input[type="text"]',
      "Acceptance subscription",
    );
    await setReactTextareaValue(page, "textarea", subscriptionYaml);
    await screenshot(page, "profiles-form-filled", client);

    await page.evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll("button"))
          .find((node) => node.textContent.trim() === "Import subscription");
        button.click();
      })()
    `);

    await page.waitFor(
      `document.querySelector(".workspace-notice, .workspace-feedback-error") !== null`,
      "the import outcome",
      30_000,
    );
    const importOutcome = await page.evaluate(`
      (() => {
        const notice = document.querySelector(".workspace-notice");
        const error = document.querySelector(".workspace-feedback-error");
        return {
          notice: notice ? notice.textContent : null,
          error: error ? error.textContent : null,
          profiles: Array.from(document.querySelectorAll(".profile-card strong"))
            .map((node) => node.textContent),
        };
      })()
    `);
    record("import-subscription", importOutcome);
    await screenshot(page, "profiles-after-import", client);
    assert(
      !importOutcome.error,
      `the import was rejected: ${importOutcome.error}`,
    );
    assert(
      importOutcome.profiles.includes("Acceptance subscription"),
      `imported profile missing: ${JSON.stringify(importOutcome.profiles)}`,
    );

    // Start the Runtime from the Overview page.
    await page.evaluate(`document.querySelector('[aria-label="Overview"]').click()`);
    await page.waitFor(
      `document.querySelector(".connection-hero") !== null`,
      "the Overview hero",
      20_000,
    );
    const startClicked = await page.evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll("button"))
          .find((node) => /^(Connect|Start)\\b/.test(node.textContent.trim()));
        if (!button) {
          return { clicked: false, buttons: Array.from(document.querySelectorAll("button"))
            .map((node) => node.textContent.trim()).filter(Boolean).slice(0, 20) };
        }
        button.click();
        return { clicked: true, label: button.textContent.trim() };
      })()
    `);
    record("start-runtime-click", startClicked);
    assert(startClicked.clicked, `no start control found: ${JSON.stringify(startClicked)}`);

    let connected = false;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(`
        (() => {
          const badge = document.querySelector(".connection-hero, .status-pill, .runtime-state");
          const text = document.body.innerText;
          return {
            hasConnected: text.includes("Connected"),
            hasError: text.includes("Runtime error") || text.includes("Core unavailable"),
            hero: badge ? badge.innerText.slice(0, 200) : null,
          };
        })()
      `);
      if (state.hasConnected) {
        connected = true;
        record("runtime-connected", state);
        break;
      }
      if (state.hasError) {
        record("runtime-error", state);
        break;
      }
      await delay(1_000);
    }
    await screenshot(page, "overview-after-start", client);
    assert(connected, "the Runtime did not report Connected");

    // The imported nodes should now be listed under Proxies.
    await page.evaluate(`document.querySelector('[aria-label="Proxies"]').click()`);
    await page.waitFor(
      `document.querySelector(".workspace-panel") !== null`,
      "the Proxies workspace",
      20_000,
    );
    await delay(1_500);
    const proxies = await page.evaluate(`
      (() => ({
        text: document.body.innerText,
        cards: Array.from(document.querySelectorAll(".proxy-row strong, .proxy-card strong"))
          .map((node) => node.textContent),
      }))()
    `);
    record("proxy-groups", {
      hasImportedNode: proxies.text.includes("Local Test"),
      cards: proxies.cards.slice(0, 10),
    });
    await screenshot(page, "proxies-live", client);
    assert(
      proxies.text.includes("Local Test"),
      "the imported node is missing from the live Proxies page",
    );

    // Prove the mixed listener is live and that the core is the one answering.
    // This machine currently has no outbound network (DNS and raw IP both time
    // out), so the check asserts the proxy handshake itself: a well-formed HTTP
    // response comes back from the mixed-port listener and the failure, if any,
    // is a proxy-level status rather than a connection refusal.
    const proxyPort = await readMixedPort();
    if (proxyPort === null) {
      record("proxy-port-missing", {});
      throw new Error("the active config has no mixed-port");
    }
    const probe = await probeThroughProxy(proxyPort);
    record("mixed-listener-probe", { proxyPort, ...probe });
    assert(
      probe.responded,
      `the mixed listener did not answer: ${JSON.stringify(probe)}`,
    );
    if (!probe.ok) {
      record("outbound-unavailable", {
        note: "the proxy answered, but this host has no outbound network",
        status: probe.status,
      });
    }

    evidence.result = "passed";
  } catch (error) {
    evidence.result = "failed";
    evidence.error = String(error?.stack ?? error);
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    client?.close();
    await terminateProcessTree(child.pid).catch(() => undefined);
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`\nEvidence: ${evidencePath}`);
  }
}

/** Reads the mixed listener port out of the live Mihomo config. */
async function readMixedPort() {
  const configPath = path.join(
    process.env.APPDATA ?? "",
    "com.capybara.proxy",
    "mihomo",
    "config.yaml",
  );
  try {
    const text = await readFile(configPath, "utf8");
    const match = /^mixed-port:\s*(\d+)\s*$/m.exec(text);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Issues an HTTP request through the mixed listener. */
async function probeThroughProxy(port) {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(15_000);
    socket.on("timeout", () => finish({ responded: false, reason: "timeout" }));
    socket.on("error", (error) =>
      finish({ responded: false, reason: String(error) }),
    );
    socket.on("connect", () => {
      // Plain HTTP through the proxy so no TLS is involved in the check.
      socket.write(
        "GET http://www.gstatic.com/generate_204 HTTP/1.1\r\n" +
          "Host: www.gstatic.com\r\n" +
          "Proxy-Connection: close\r\n" +
          "Connection: close\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
      if (response.includes("\r\n\r\n")) {
        const statusLine = response.split("\r\n")[0];
        const status = Number(statusLine.split(" ")[1]);
        finish({
          responded: true,
          ok: status >= 200 && status < 400,
          status,
          statusLine,
        });
      }
    });
    socket.on("close", () =>
      finish({
        responded: false,
        ok: false,
        reason: "closed before a response",
        response: response.slice(0, 200),
      }),
    );
  });
}

async function screenshot(page, name, client) {
  const shot = await client.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(artifactDirectory, `${name}.png`);
  if (shot?.data) {
    await writeFile(file, Buffer.from(shot.data, "base64"));
    evidence.screenshots.push(file);
    console.log(`[screenshot] ${file}`);
  }
}

/** Reveals the main window the same way the tray menu does. */
async function showMainWindow() {
  const script = `
    $signature = '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);';
    Add-Type -MemberDefinition $signature -Name Win32 -Namespace CapybaraProxy;
    Get-Process capybara-desktop -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.MainWindowHandle -ne 0) {
        [CapybaraProxy.Win32]::ShowWindow($_.MainWindowHandle, 5) | Out-Null
      }
    }`;
  await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  await delay(1_500);
}

/** Sets an input's value so React's onChange handler runs. */
async function setReactInputValue(page, selector, value) {
  await page.evaluate(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
}

async function setReactTextareaValue(page, selector, value) {
  await page.evaluate(`
    (() => {
      const area = document.querySelector(${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, "value").set;
      setter.call(area, ${JSON.stringify(value)});
      area.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
}

await main();
