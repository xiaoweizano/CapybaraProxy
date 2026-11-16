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
const configRoot = path.join(
  process.env.APPDATA ??
    (() => {
      throw new Error("APPDATA is unavailable.");
    })(),
  "com.flowproxy.desktop",
);
const settingsPath = path.join(configRoot, "settings.json");
const outputDirectory = path.resolve("artifacts/screenshots");
const pageUrlPrefix = "http://tauri.localhost/";
const themes = [
  {
    id: "cyber_flow",
    name: "stage4-settings-a.png",
    integrationName: "stage4-settings-a-integration.png",
  },
  {
    id: "warm_flow",
    name: "stage4-settings-c.png",
    integrationName: "stage4-settings-c-integration.png",
  },
];

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

async function invokeOk(page, command, args, action) {
  const result = await page.invoke(command, args);
  assert(
    result?.ok,
    `FlowProxy could not ${action}: ${JSON.stringify(result)}`,
  );
  return result.data;
}

async function waitForSettingsPage(page, theme) {
  await page.waitFor(
    `document.readyState === "complete" &&
      document.querySelector(".settings-grid") !== null &&
      document.documentElement.dataset.theme === ${JSON.stringify(theme)}`,
    `the ${theme} Settings page`,
  );
  await page.waitFor(
    `document.body.innerText.includes("System proxy") &&
      document.body.innerText.includes("Launch at login") &&
      document.body.innerText.includes("TUN interface") &&
      document.body.innerText.includes("Detection only")`,
    "the system integration Settings content",
  );
  await page.evaluate("document.fonts.ready");
  await delay(350);
}

async function inspectLayout(page, theme) {
  return page.evaluate(`(() => {
    const pageViewport = document.querySelector(".page-viewport");
    const settingsGrid = document.querySelector(".settings-grid");
    const integration = [...document.querySelectorAll(".settings-panel")].find(
      (panel) =>
        panel.textContent?.includes("Launch at login") &&
        panel.textContent?.includes("TUN interface"),
    );
    const integrationRect = integration?.getBoundingClientRect();
    return {
      theme: document.documentElement.dataset.theme,
      textLength: document.body.innerText.trim().length,
      hasSettingsGrid: settingsGrid !== null,
      hasIntegration: integration !== undefined,
      hasTunDetectionOnly: document.body.innerText.includes("Detection only"),
      horizontalOverflow: {
        document:
          document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
        pageViewport: pageViewport
          ? pageViewport.scrollWidth - pageViewport.clientWidth
          : null,
      },
      integrationWithinViewport:
        !integrationRect ||
        (integrationRect.width > 0 &&
          integrationRect.height > 0 &&
          integrationRect.left >= -1 &&
          integrationRect.right <= window.innerWidth + 1 &&
          integrationRect.top < window.innerHeight &&
          integrationRect.bottom > 0),
      integrationFullyWithinViewport:
        !integrationRect ||
        (integrationRect.width > 0 &&
          integrationRect.height > 0 &&
          integrationRect.left >= -1 &&
          integrationRect.right <= window.innerWidth + 1 &&
          integrationRect.top >= -1 &&
          integrationRect.bottom <= window.innerHeight + 1),
    };
  })()`);
}

async function captureScreenshot(client, outputPath) {
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const image = Buffer.from(data, "base64");
  assert(image.length > 50_000, `The screenshot ${outputPath} was unexpectedly small.`);
  await writeFile(outputPath, image);
  return image.length;
}

async function scrollIntegrationIntoView(page) {
  await page.evaluate(`(() => {
    const integration = [...document.querySelectorAll(".settings-panel")].find(
      (panel) =>
        panel.textContent?.includes("Launch at login") &&
        panel.textContent?.includes("TUN interface"),
    );
    integration?.scrollIntoView({ block: "center", inline: "nearest" });
  })()`);
  await delay(350);
}

async function saveTheme(page, theme) {
  const currentSettings = await invokeOk(
    page,
    "get_settings",
    undefined,
    "read desktop settings",
  );
  await invokeOk(
    page,
    "save_settings",
    {
      settings: {
        ...currentSettings,
        theme,
      },
    },
    `save the ${theme} theme`,
  );

  try {
    await page.evaluate("location.reload()");
  } catch {
    // Reloading destroys the current execution context before it can respond.
  }
  await delay(800);
  await page.waitFor(
    `document.readyState === "complete" &&
      typeof window.__TAURI_INTERNALS__?.invoke === "function"`,
    "FlowProxy to reload",
    30_000,
  );
  await page.evaluate('location.hash = "/settings";');
  await waitForSettingsPage(page, theme);
}

const existingPid = await findFlowProxyPid(appExecutable);
assert(
  existingPid === null,
  `Stop FlowProxy process ${existingPid} before capturing stage 4 screenshots.`,
);

await mkdir(outputDirectory, { recursive: true });
await mkdir(configRoot, { recursive: true });

const initialSettings = await readOptionalFile(settingsPath);
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
const appPid = child.pid;
let client = null;
let page = null;
const evidence = {
  timestamp: new Date().toISOString(),
  runtimeHost: "tauri-webview2",
  appExecutable,
  appPid,
  screenshots: [],
};
let exited = false;

try {
  assert(
    Number.isInteger(appPid) && appPid > 0,
    "FlowProxy did not return a process identifier.",
  );
  const target = await waitForPageTarget(browserPort, {
    expectedUrlPrefix: pageUrlPrefix,
    timeoutMs: 30_000,
  });
  assert(
    target.url.startsWith(pageUrlPrefix),
    `Expected the production Tauri frontend, received ${target.url}.`,
  );
  client = createCdpClient(target.webSocketDebuggerUrl);
  page = createPage(client);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await page.waitFor(
    `document.readyState === "complete" &&
      document.querySelector(".app-frame") !== null &&
      typeof window.__TAURI_INTERNALS__?.invoke === "function"`,
    "the FlowProxy application shell",
  );
  await client.send("Page.bringToFront");

  for (const theme of themes) {
    await saveTheme(page, theme.id);
    const layout = await inspectLayout(page, theme.id);
    assert(
      layout.theme === theme.id,
      `Expected theme ${theme.id}, received ${layout.theme}.`,
    );
    assert(
      layout.hasSettingsGrid &&
        layout.hasIntegration &&
        layout.hasTunDetectionOnly &&
        layout.textLength > 400,
      `The Settings page content was incomplete for ${theme.id}: ${JSON.stringify(
        layout,
      )}`,
    );
    assert(
      layout.horizontalOverflow.document <= 1 &&
        layout.horizontalOverflow.body <= 1 &&
        (layout.horizontalOverflow.pageViewport ?? 0) <= 1 &&
        layout.integrationWithinViewport,
      `The Settings page overflowed horizontally for ${theme.id}: ${JSON.stringify(
        layout,
      )}`,
    );

    const outputPath = path.join(outputDirectory, theme.name);
    const bytes = await captureScreenshot(client, outputPath);
    evidence.screenshots.push({
      theme: theme.id,
      view: "settings-top",
      path: outputPath,
      bytes,
      viewport: await page.evaluate(`({
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      })`),
      layout,
    });

    await scrollIntegrationIntoView(page);
    const integrationLayout = await inspectLayout(page, theme.id);
    assert(
      integrationLayout.integrationFullyWithinViewport,
      `The Integration panel was not fully visible for ${theme.id}: ${JSON.stringify(
        integrationLayout,
      )}`,
    );

    const integrationOutputPath = path.join(
      outputDirectory,
      theme.integrationName,
    );
    const integrationBytes = await captureScreenshot(
      client,
      integrationOutputPath,
    );
    evidence.screenshots.push({
      theme: theme.id,
      view: "settings-integration",
      path: integrationOutputPath,
      bytes: integrationBytes,
      viewport: await page.evaluate(`({
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      })`),
      layout: integrationLayout,
    });
  }

  evidence.settingsRestored = initialSettings.exists;
  evidence.status = "passed";
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  if (page) {
    try {
      await page.invoke("request_application_exit");
    } catch {
      // app.exit can close the CDP connection before it returns a response.
    }
  }
  client?.close();

  exited = await waitForProcessExit(appPid, 15_000);
  if (!exited) {
    await terminateProcessTree(appPid).catch(() => undefined);
    child.kill();
  }

  await restoreOptionalFile(settingsPath, initialSettings);
}

if (!exited) {
  throw new Error("FlowProxy did not exit after screenshot capture.");
}
