import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const edgePath =
  process.env.EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browserPort = process.env.FLOWPROXY_CDP_PORT ?? "9222";
const browserUrl = `http://127.0.0.1:${browserPort}`;
const pageUrl = process.env.FLOWPROXY_URL ?? "http://127.0.0.1:4173/";
const attachToExistingPage = process.env.FLOWPROXY_ATTACH_CDP === "1";
const screenshotPrefix = process.env.FLOWPROXY_SCREENSHOT_PREFIX ?? "";
const outputDirectory = path.resolve("artifacts/screenshots");
const profileDirectory = path.resolve(
  process.env.FLOWPROXY_EDGE_PROFILE ??
    "F:/codex-install/flowproxy-edge-profile",
);

const screenshots = [
  {
    route: "/",
    theme: "cyber_flow",
    width: 1280,
    height: 820,
    name: "overview-a.png",
  },
  {
    route: "/",
    theme: "warm_flow",
    width: 1280,
    height: 820,
    name: "overview-c.png",
  },
  {
    route: "/",
    theme: "cyber_flow",
    width: 900,
    height: 820,
    name: "overview-a-narrow.png",
  },
  {
    route: "/",
    theme: "warm_flow",
    width: 900,
    height: 820,
    name: "overview-c-narrow.png",
  },
  {
    route: "/",
    theme: "cyber_flow",
    width: 820,
    height: 680,
    name: "overview-a-minimum.png",
  },
  {
    route: "/",
    theme: "warm_flow",
    width: 820,
    height: 680,
    name: "overview-c-minimum.png",
  },
  {
    route: "/settings",
    theme: "cyber_flow",
    width: 1280,
    height: 820,
    name: "settings-a.png",
  },
  {
    route: "/settings",
    theme: "warm_flow",
    width: 1280,
    height: 820,
    name: "settings-c.png",
  },
  {
    route: "/settings",
    theme: "cyber_flow",
    width: 900,
    height: 820,
    name: "settings-a-narrow.png",
  },
  {
    route: "/settings",
    theme: "warm_flow",
    width: 900,
    height: 820,
    name: "settings-c-narrow.png",
  },
  {
    route: "/settings",
    theme: "cyber_flow",
    width: 820,
    height: 680,
    name: "settings-a-minimum.png",
  },
  {
    route: "/settings",
    theme: "warm_flow",
    width: 820,
    height: 680,
    name: "settings-c-minimum.png",
  },
  ...["proxies", "rules", "connections", "profiles", "logs"].flatMap(
    (route) => [
      {
        route: `/${route}`,
        theme: "cyber_flow",
        width: 1280,
        height: 820,
        name: `${route}-a.png`,
      },
      {
        route: `/${route}`,
        theme: "warm_flow",
        width: 1280,
        height: 820,
        name: `${route}-c.png`,
      },
    ],
  ),
];

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${browserUrl}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page?.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Edge is still starting.
    }

    await delay(250);
  }

  throw new Error("Edge DevTools endpoint did not become available.");
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
    socket.onerror = () => reject(new Error("Could not connect to Edge CDP."));
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

async function captureScreenshot(client, screenshot) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: screenshot.width,
    height: screenshot.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  if (attachToExistingPage) {
    await client.send("Runtime.evaluate", {
      expression: `location.hash = ${JSON.stringify(screenshot.route)};`,
    });
    await delay(900);
  } else {
    await client.send("Page.navigate", {
      url: `${pageUrl}#${screenshot.route}`,
    });
    await delay(900);
  }

  await client.send("Runtime.evaluate", {
    expression: `(async () => {
      const theme = ${JSON.stringify(screenshot.theme)};
      const nativeBridge = window.__TAURI_INTERNALS__;

      if (typeof nativeBridge?.invoke === "function") {
        const result = await nativeBridge.invoke("save_settings", {
          settings: {
            version: 1,
            theme,
            close_behavior: "hide_to_tray",
          },
        });

        if (!result?.ok) {
          throw new Error(
            result?.error?.message ?? "Native settings could not be saved.",
          );
        }
      } else {
        localStorage.setItem("flowproxy.theme", theme);
      }

      location.reload();
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  await delay(1400);
  await client.send("Runtime.evaluate", {
    expression: "document.fonts.ready",
    awaitPromise: true,
  });
  await delay(300);

  const selector =
    screenshot.route === "/settings"
      ? ".settings-section, .settings-section-nav"
      : screenshot.route === "/"
        ? ".connection-hero, .overview-middle-grid, .overview-bottom-grid"
        : ".workspace-page, .workspace-panel";
  const layoutResult = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const viewport = document.querySelector(".page-viewport");
      const elements = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const measurements = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
      const pageViewport = document.querySelector(".page-viewport");
      const overflow = {
        document:
          document.documentElement.scrollWidth - window.innerWidth,
        viewport: viewport
          ? viewport.scrollWidth - viewport.clientWidth
          : null,
        pageViewport: pageViewport
          ? pageViewport.scrollWidth - pageViewport.clientWidth
          : null,
      };
      const invalid = measurements.filter(
        ({ width, height, left, right }) =>
          width <= 0 ||
          height <= 0 ||
          left < -1 ||
          right > window.innerWidth + 1,
      );

      return {
        measurements,
        overflow,
        invalid,
        textLength: document.body.innerText.trim().length,
      };
    })()`,
    returnByValue: true,
  });
  if (layoutResult.exceptionDetails) {
    throw new Error(
      `Layout evaluation failed for ${screenshot.name}: ${JSON.stringify(
        layoutResult.exceptionDetails,
      )}`,
    );
  }
  const layout = layoutResult.result.value;

  if (
    !layout ||
    layout.textLength === 0 ||
    layout.invalid.length > 0 ||
    layout.overflow.document > 1 ||
    (layout.overflow.viewport ?? 0) > 1 ||
    (layout.overflow.pageViewport ?? 0) > 1
  ) {
    throw new Error(
      `Layout verification failed for ${screenshot.name}: ${JSON.stringify(layout)}`,
    );
  }

  if (process.env.FLOWPROXY_LAYOUT_DEBUG === "1") {
    process.stdout.write(`${JSON.stringify(layout)}\n`);
  }

  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const outputPath = path.join(
    outputDirectory,
    `${screenshotPrefix}${screenshot.name}`,
  );
  await writeFile(outputPath, Buffer.from(data, "base64"));
  process.stdout.write(`${outputPath}\n`);
}

await mkdir(outputDirectory, { recursive: true });

const edge = attachToExistingPage
  ? undefined
  : spawn(
      edgePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        `--remote-debugging-port=${browserPort}`,
        `--user-data-dir=${profileDirectory}`,
        "about:blank",
      ],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );

try {
  const webSocketUrl = await waitForDebugger();
  const client = createCdpClient(webSocketUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  for (const screenshot of screenshots) {
    await captureScreenshot(client, screenshot);
  }

  if (!attachToExistingPage) {
    await client.send("Browser.close").catch(() => undefined);
  }
  client.close();
} finally {
  edge?.kill();
}
