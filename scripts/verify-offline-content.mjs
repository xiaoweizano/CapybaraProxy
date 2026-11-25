// Imports a subscription through the UI, then checks the offline fallback on
// Proxies and Rules without ever starting the Runtime.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createCdpClient,
  createPage,
  delay,
  findAvailablePort,
  terminateProcessTree,
  waitForPageTarget,
} from "./lib/tauri-cdp.mjs";

const exe = "F:/新建文件夹/FlowProxy/flowproxy-desktop.exe";
const fixture = await readFile(
  process.env.FLOWPROXY_SUBSCRIPTION ?? "F:/codex-install/subscriptions/test-sub.yaml",
  "utf8",
);
const port = await findAvailablePort();
const child = spawn(exe, [], {
  cwd: path.dirname(exe),
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: "ignore",
  windowsHide: true,
});

try {
  const target = await waitForPageTarget(port, {
    expectedUrlPrefix: "http://tauri.localhost/",
    timeoutMs: 45_000,
  });
  const client = createCdpClient(target.webSocketDebuggerUrl);
  const page = createPage(client);
  await page.waitFor(
    `document.readyState === "complete" && location.href.startsWith("http://tauri.localhost")`,
    "document",
    45_000,
  );
  await page.evaluate(`
    (() => {
      document.documentElement.dataset.appVisibility = "visible";
      window.dispatchEvent(new CustomEvent("flowproxy:app-visibility", {
        detail: { hidden: false },
      }));
    })()
  `);
  await page.waitFor(`document.querySelector(".app-frame") !== null`, "shell", 30_000);

  await page.evaluate(`document.querySelector('a[href="#/profiles"]')?.click()`);
  await page.waitFor(`document.querySelector(".subscription-tabs") !== null`, "profiles", 20_000);

  // Paste mode
  await page.evaluate(`
    (() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]'))
        .find((n) => /YAML/i.test(n.textContent));
      tab?.click();
    })()
  `);
  await page.waitFor(`document.querySelector("textarea") !== null`, "yaml field", 5_000);

  await page.evaluate(`
    (() => {
      const input = document.querySelector('input[type="text"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "Offline check");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const area = document.querySelector("textarea");
      const areaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      areaSetter.call(area, ${JSON.stringify(fixture)});
      area.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
  await page.evaluate(`
    (() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((n) => /Import subscription|导入订阅/.test(n.textContent));
      button?.click();
    })()
  `);
  await page.waitFor(
    `document.querySelector(".workspace-notice, .workspace-feedback-error") !== null`,
    "import outcome",
    30_000,
  );
  console.log(
    "import:",
    await page.evaluate(
      `document.querySelector(".workspace-notice, .workspace-feedback-error")?.textContent ?? ""`,
    ),
  );

  for (const [route, label] of [
    ["#/proxies", "proxies"],
    ["#/rules", "rules"],
  ]) {
    await page.evaluate(`document.querySelector('a[href="${route}"]')?.click()`);
    await delay(2_000);
    const probe = `JSON.stringify({
      badge: document.querySelector(".workspace-live-badge")?.textContent ?? null,
      notice: document.querySelector(".workspace-feedback")?.textContent ?? null,
      nodes: Array.from(document.querySelectorAll(".proxy-node strong")).map((n) => n.textContent),
      ruleRows: Array.from(document.querySelectorAll(".workspace-table tbody tr")).map((r) => r.textContent.trim()).slice(0, 4),
      disconnected: !!document.querySelector(".workspace-empty-large"),
    })`;
    console.log(label, await page.evaluate(probe));
  }

  client.close();
} finally {
  await terminateProcessTree(child.pid).catch(() => undefined);
}
