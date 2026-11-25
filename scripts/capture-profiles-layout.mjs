// Captures the subscription import screen so the layout can be inspected.
//
// Drives the installed build through its own UI, then screenshots the Profiles
// page in both languages.

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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

const appExecutable = path.resolve(
  process.env.FLOWPROXY_APP_EXECUTABLE ??
    "F:/新建文件夹/FlowProxy/flowproxy-desktop.exe",
);
const outputDirectory = path.resolve(
  process.env.FLOWPROXY_SCREENSHOT_DIR ?? "artifacts/screenshots/profiles-layout",
);
const browserPort = await findAvailablePort();

await mkdir(outputDirectory, { recursive: true });

const child = spawn(appExecutable, [], {
  cwd: path.dirname(appExecutable),
  env: {
    ...process.env,
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

let client = null;
let windowWidth = 1280;
let windowHeight = 820;
try {
  const target = await waitForPageTarget(browserPort, {
    expectedUrlPrefix: "http://tauri.localhost/",
    timeoutMs: 45_000,
  });
  client = createCdpClient(target.webSocketDebuggerUrl);
  const page = createPage(client);
  // On a cold start the WebView briefly sits on `about:blank` before Tauri
  // navigates to the bundled assets. Wait for the real document.
  await page.waitFor(
    `document.readyState === "complete" && location.href.startsWith("http://tauri.localhost")`,
    "the Tauri document",
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
  await page.waitFor(
    `document.querySelector(".app-frame") !== null`,
    "the application shell",
    30_000,
  );

  // The shell may already be in Chinese from a previous run; find the Settings
  // link by href instead of its localized label.
  const openSettings = `
    (() => {
      const link = document.querySelector('a[href="#/settings"]');
      link?.click();
      return !!link;
    })()
  `;
  await page.evaluate(openSettings);
  await page.waitFor(
    `document.querySelector(".settings-page") !== null`,
    "Settings",
    20_000,
  );
  // Make sure we start from English.
  await page.evaluate(`
    (() => {
      const node = Array.from(document.querySelectorAll(".behavior-option"))
        .find((n) => n.textContent.includes("English"));
      node?.click();
    })()
  `);
  await delay(900);

  await page.evaluate(`document.querySelector('a[href="#/profiles"]')?.click()`);
  await page.waitFor(
    `document.querySelector(".subscription-tabs") !== null ||
     document.querySelector(".profile-list") !== null`,
    "the Profiles page",
    20_000,
  );
  const dims = JSON.parse(
    await page.evaluate(
      `JSON.stringify({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight })`,
    ),
  );
  windowWidth = dims.w;
  windowHeight = dims.h;
  console.log(`window ${windowWidth}x${windowHeight}`);
  // Tauri's WebView reports a devicePixelRatio the compositor applies on top of
  // the window size, so a raw clip lands halfway across the page. Pinning the
  // metrics to 1:1 makes the clip coordinates exact.
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: windowWidth,
    height: windowHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const buildInfo = await page.evaluate(
    `JSON.stringify({
      script: Array.from(document.querySelectorAll("script")).map((s) => s.src),
      hasForm: !!document.querySelector(".subscription-form"),
      fieldCount: document.querySelectorAll(".subscription-field").length,
    })`,
  );
  console.log(`build: ${buildInfo}`);
  await delay(700);
  await screenshot(client, "profiles-english");

  // Switch to the YAML tab so the textarea is visible.
  await page.evaluate(`
    (() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]'))
        .find((node) => /YAML/i.test(node.textContent));
      tab?.click();
    })()
  `);
  await delay(400);
  await screenshot(client, "profiles-yaml-english");

  // Chinese
  await page.evaluate(`document.querySelector('a[href="#/settings"]')?.click()`);
  await page.waitFor(`document.querySelector(".settings-page") !== null`, "Settings", 20_000);
  await page.evaluate(`
    (() => {
      const node = Array.from(document.querySelectorAll(".behavior-option"))
        .find((n) => n.textContent.includes("简体中文"));
      node?.click();
    })()
  `);
  await delay(900);
  await page.evaluate(`document.querySelector('a[href="#/profiles"]')?.click()`);
  await page.waitFor(
    `document.querySelector(".subscription-tabs") !== null ||
     document.querySelector(".profile-list") !== null`,
    "the Chinese Profiles page",
    20_000,
  );
  await delay(700);
  await screenshot(client, "profiles-chinese");

  // Restore English.
  await page.evaluate(`document.querySelector('a[href="#/settings"]')?.click()`);
  await page.waitFor(`document.querySelector(".settings-page") !== null`, "Settings", 20_000);
  await page.evaluate(`
    (() => {
      const node = Array.from(document.querySelectorAll(".behavior-option"))
        .find((n) => n.textContent.includes("English"));
      node?.click();
    })()
  `);
  await delay(800);

  console.log(`Screenshots written to ${outputDirectory}`);
} finally {
  client?.close();
  await terminateProcessTree(child.pid).catch(() => undefined);
}

async function screenshot(client, name) {
  // The WebView can be scrolled horizontally; captureScreenshot clips against
  // the scroll offset, which sliced the sidebar out of earlier captures.
  const scroll = await client.send("Runtime.evaluate", {
    expression: "JSON.stringify({ x: scrollX, y: scrollY })",
    returnByValue: true,
  });
  const { x, y } = JSON.parse(scroll.result.value);
  if (x !== 0 || y !== 0) {
    await client.send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
    await delay(150);
  }

  const shot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
    clip: { x: 0, y: 0, width: windowWidth, height: windowHeight, scale: 1 },
  });
  const file = path.join(outputDirectory, `${name}.png`);
  if (shot?.data) {
    await writeFile(file, Buffer.from(shot.data, "base64"));
    console.log(`[screenshot] ${file}`);
  }
}