import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  assert,
  createCdpClient,
  createPage,
  delay,
  findAvailablePort,
  findCapybaraProxyPid,
  runPowerShell,
  terminateProcessTree,
  waitForPageTarget,
  waitForProcessExit,
} from "./lib/tauri-cdp.mjs";

const appExecutable = path.resolve(
  process.env.CAPYBARA_APP_EXECUTABLE ??
    "F:/codex-install/cargo-target/release/capybara-desktop.exe",
);
const mihomoExecutable = path.resolve(
  process.env.CAPYBARA_MIHOMO_PATH ??
    "F:/codex-install/mihomo/v1.19.33/win-amd64/mihomo-windows-amd64.exe",
);
const outputDirectory = path.resolve(
  process.env.CAPYBARA_SCREENSHOT_DIR ??
    "artifacts/screenshots/stage6",
);
const evidencePath = path.resolve(
  process.env.CAPYBARA_STAGE6_CAPTURE_EVIDENCE ??
    "artifacts/stage6-visual-evidence.json",
);
const pageUrlPrefix = "http://tauri.localhost/";
const themes = ["cyber_flow", "warm_flow"];
const viewports = [
  { name: "standard", width: 1280, height: 820 },
  { name: "narrow", width: 900, height: 820 },
  { name: "minimum", width: 820, height: 680 },
];
const pages = [
  {
    route: "/",
    name: "overview",
    ready: ".overview-page .connection-hero",
    required: [
      ".connection-hero",
      ".overview-middle-grid",
      ".overview-bottom-grid",
    ],
    text: ["Download", "Upload", "Latency", "Active Connections"],
  },
  {
    route: "/proxies",
    name: "proxies",
    ready: ".workspace-page",
    required: [".workspace-page", ".page-heading"],
    text: ["Proxies", "Proxy control"],
  },
  {
    route: "/rules",
    name: "rules",
    ready: ".workspace-page",
    required: [".workspace-page", ".page-heading"],
    text: ["Rules", "Routing"],
  },
  {
    route: "/connections",
    name: "connections",
    ready: ".workspace-page",
    required: [".workspace-page", ".page-heading"],
    text: ["Connections", "Live traffic"],
  },
  {
    route: "/profiles",
    name: "profiles",
    ready: ".workspace-page",
    required: [".workspace-page", ".page-heading"],
    text: ["Profiles", "Configuration"],
  },
  {
    route: "/logs",
    name: "logs",
    ready: ".workspace-page",
    required: [".workspace-page", ".page-heading"],
    text: ["Logs", "Runtime events"],
  },
  {
    route: "/settings",
    name: "settings",
    ready: ".settings-page",
    required: [".settings-page", ".settings-grid"],
    text: ["Settings", "Theme"],
  },
];

async function invokeOk(page, command, args, action) {
  const result = await page.invoke(command, args);
  assert(
    result?.ok,
    `CapybaraProxy could not ${action}: ${JSON.stringify(result)}`,
  );
  return result.data;
}

async function resizeNativeWindow(pid, width, height) {
  const output = await runPowerShell(`
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;

    public static class CapybaraProxyStage6Window {
      [StructLayout(LayoutKind.Sequential)]
      public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
      }

      [DllImport("user32.dll", SetLastError = true)]
      public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int X,
        int Y,
        int cx,
        int cy,
        uint uFlags
      );

      [DllImport("user32.dll")]
      public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    }
"@;

    $process = Get-Process -Id ${pid} -ErrorAction Stop;
    $process.Refresh();
    $handle = $process.MainWindowHandle;
    if ($handle -eq [IntPtr]::Zero) {
      throw "CapybaraProxy has no visible main window handle."
    }

    $flags = 0x0002 -bor 0x0004 -bor 0x0010;
    if (
      -not [CapybaraProxyStage6Window]::SetWindowPos(
        $handle,
        [IntPtr]::Zero,
        0,
        0,
        ${width},
        ${height},
        $flags
      )
    ) {
      throw "SetWindowPos failed for the CapybaraProxy main window."
    }

    Start-Sleep -Milliseconds 300;
    $rect = New-Object CapybaraProxyStage6Window+RECT;
    [void][CapybaraProxyStage6Window]::GetWindowRect($handle, [ref]$rect);
    [ordered]@{
      handle = $handle.ToInt64()
      width = $rect.Right - $rect.Left
      height = $rect.Bottom - $rect.Top
    } | ConvertTo-Json -Compress
  `);

  return JSON.parse(output);
}

async function resizeWebView(page, pid, width, height) {
  let outerWidth = width;
  let outerHeight = height;
  let nativeSize = null;
  const trace = [];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    nativeSize = await resizeNativeWindow(pid, outerWidth, outerHeight);
    await delay(250);
    const viewport = await page.evaluate(`({
      width: window.innerWidth,
      height: window.innerHeight
    })`);
    trace.push({ attempt, outerWidth, outerHeight, nativeSize, viewport });

    if (viewport.width === width && viewport.height === height) {
      return { nativeSize, viewport, trace };
    }

    outerWidth += width - viewport.width;
    outerHeight += height - viewport.height;
  }

  throw new Error(
    `Could not size the WebView to ${width}x${height}: ${JSON.stringify(
      trace,
    )}`,
  );
}

async function saveTheme(page, theme) {
  const settings = await invokeOk(
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
        ...settings,
        theme,
      },
    },
    `save the ${theme} theme`,
  );

  try {
    await page.evaluate("location.reload()");
  } catch {
    // Reloading invalidates the current JavaScript execution context.
  }
  await delay(900);
  await page.waitFor(
    `document.readyState === "complete" &&
      document.querySelector(".app-frame") !== null &&
      document.documentElement.dataset.theme === ${JSON.stringify(theme)}`,
    `the ${theme} application shell`,
    30_000,
  );
}

async function inspectLayout(page, pageDefinition) {
  return page.evaluate(`(() => {
    const pageViewport = document.querySelector(".page-viewport");
    const required = ${JSON.stringify(pageDefinition.required)}.map((selector) => {
      const elements = [...document.querySelectorAll(selector)];
      return {
        selector,
        count: elements.length,
        rects: elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
      };
    });
    const text = document.body.textContent ?? "";
    const textChecks = ${JSON.stringify(pageDefinition.text)}.map((value) => ({
      value,
      found: text.includes(value),
    }));
    const invalidRects = required.flatMap(({ selector, rects }) =>
      rects
        .filter(
          (rect) =>
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.left < -1 ||
            rect.right > window.innerWidth + 1,
        )
        .map((rect) => ({ selector, rect })),
    );

    return {
      theme: document.documentElement.dataset.theme,
      route: location.hash || "#/",
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      textLength: text.trim().length,
      required,
      textChecks,
      invalidRects,
      overflow: {
        document: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
        pageViewport: pageViewport
          ? pageViewport.scrollWidth - pageViewport.clientWidth
          : null,
      },
    };
  })()`);
}

async function captureScreenshot(client, page, theme, viewport, view) {
  const fileName = `${view.name}-${theme}-${viewport.width}x${viewport.height}.png`;
  const outputPath = path.join(outputDirectory, fileName);
  await page.waitFor(
    `document.readyState === "complete" &&
      location.hash === ${JSON.stringify(`#${view.route}`)} &&
      document.querySelector(${JSON.stringify(view.ready)}) !== null`,
    `${theme} ${view.name} at ${viewport.width}x${viewport.height}`,
    30_000,
  );
  await page.evaluate("document.fonts.ready");
  await delay(500);

  const layout = await inspectLayout(page, view);
  assert(
    layout.theme === theme,
    `Expected ${theme}, received ${layout.theme} for ${view.name}.`,
  );
  assert(
    layout.textLength > 100 &&
      layout.required.every(({ count }) => count > 0) &&
      layout.textChecks.every(({ found }) => found),
    `The ${theme} ${view.name} page was incomplete: ${JSON.stringify(layout)}`,
  );
  assert(
    layout.invalidRects.length === 0 &&
      layout.overflow.document <= 1 &&
      layout.overflow.body <= 1 &&
      (layout.overflow.pageViewport ?? 0) <= 1,
    `The ${theme} ${view.name} page overflowed at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`,
  );

  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const image = Buffer.from(data, "base64");
  assert(
    image.length > 20_000,
    `The ${theme} ${view.name} screenshot was unexpectedly small.`,
  );
  await writeFile(outputPath, image);

  return {
    theme,
    view: view.name,
    route: view.route,
    viewport,
    path: outputPath,
    bytes: image.length,
    layout,
  };
}

const existingPid = await findCapybaraProxyPid(appExecutable);
assert(
  existingPid === null,
  `Stop CapybaraProxy process ${existingPid} before capturing Stage 6 screenshots.`,
);

await mkdir(outputDirectory, { recursive: true });
await mkdir(path.dirname(evidencePath), { recursive: true });

const browserPort = await findAvailablePort();
const startedAt = Date.now();
const child = spawn(appExecutable, [], {
  cwd: path.dirname(appExecutable),
  env: {
    ...process.env,
    CAPYBARA_MIHOMO_PATH: mihomoExecutable,
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
let currentStep = "launching CapybaraProxy";
const evidence = {
  timestamp: new Date().toISOString(),
  runtimeHost: "tauri-webview2",
  appExecutable,
  mihomoExecutable,
  appPid,
  browserPort,
  startup: null,
  runtime: null,
  screenshots: [],
  status: "started",
  currentStep,
};

try {
  assert(
    Number.isInteger(appPid) && appPid > 0,
    "CapybaraProxy did not return a process identifier.",
  );
  const target = await waitForPageTarget(browserPort, {
    expectedUrlPrefix: pageUrlPrefix,
    timeoutMs: 30_000,
  });
  client = createCdpClient(target.webSocketDebuggerUrl);
  page = createPage(client);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await page.waitFor(
    `document.readyState === "complete" &&
      document.querySelector(".app-frame") !== null &&
      typeof window.__TAURI_INTERNALS__?.invoke === "function"`,
    "the CapybaraProxy application shell",
    30_000,
  );
  evidence.startup = {
    interactiveMs: Date.now() - startedAt,
    targetUrl: target.url,
  };

  currentStep = "reading initial settings";
  const initialSettings = await invokeOk(
    page,
    "get_settings",
    undefined,
    "read initial desktop settings",
  );
  evidence.settings = initialSettings;

  currentStep = "starting Mihomo Runtime";
  await invokeOk(page, "start_runtime", undefined, "start Mihomo");
  runtimeStarted = true;
  await page.waitFor(
    `window.__TAURI_INTERNALS__
      .invoke("get_runtime_snapshot")
      .then((result) => result.ok && result.data.state === "connected")`,
    "the connected Mihomo Runtime",
    30_000,
  );
  evidence.runtime = await invokeOk(
    page,
    "get_runtime_snapshot",
    undefined,
    "read the connected Runtime",
  );

  for (const theme of themes) {
    currentStep = `applying ${theme} theme`;
    await saveTheme(page, theme);

    for (const viewport of viewports) {
      currentStep = `${theme} ${viewport.name} native window resize`;
      const windowSize = await resizeWebView(
        page,
        appPid,
        viewport.width,
        viewport.height,
      );
      assert(
        windowSize.viewport.width === viewport.width &&
          windowSize.viewport.height === viewport.height,
        `CapybaraProxy viewport did not reach ${viewport.width}x${viewport.height}: ${JSON.stringify(
          windowSize,
        )}`,
      );

      for (const view of pages) {
        currentStep = `${theme} ${viewport.name} ${view.name}`;
        await page.evaluate(
          `location.hash = ${JSON.stringify(`#${view.route}`)};`,
        );
        const screenshot = await captureScreenshot(
          client,
          page,
          theme,
          viewport,
          view,
        );
        evidence.screenshots.push(screenshot);
        process.stdout.write(`${screenshot.path}\n`);
      }
    }
  }

  evidence.status = "passed";
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  evidence.status = "failed";
  evidence.currentStep = currentStep;
  evidence.error = error instanceof Error ? error.message : String(error);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  throw error;
} finally {
  if (page && runtimeStarted) {
    try {
      await Promise.race([page.invoke("stop_runtime"), delay(5_000)]);
    } catch {
      // Continue to the controlled application exit.
    }
  }
  if (page) {
    try {
      await Promise.race([
        page.invoke("request_application_exit"),
        delay(5_000),
      ]);
    } catch {
      // app.exit may close the CDP connection before it responds.
    }
  }
  client?.close();

  const exited = await waitForProcessExit(appPid, 15_000);
  if (!exited) {
    await terminateProcessTree(appPid).catch(() => undefined);
    child.kill();
    throw new Error("CapybaraProxy did not exit after Stage 6 screenshot capture.");
  }
}
