// Verifies the i18n switch on the installed build through the real UI.
//
// Navigates to Settings, selects 简体中文, and asserts that the shell and the
// Settings page render Chinese. Switches back to English afterwards so the
// machine is left as it was found.

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
  terminateProcessTree,
  waitForPageTarget,
} from "./lib/tauri-cdp.mjs";

const appExecutable = path.resolve(
  process.env.CAPYBARA_APP_EXECUTABLE ??
    "F:/新建文件夹/CapybaraProxy/capybara-desktop.exe",
);
const artifactDirectory = path.resolve(
  process.env.CAPYBARA_ARTIFACTS ?? "artifacts/screenshots/packaged-acceptance",
);
const evidencePath = path.resolve(
  process.env.CAPYBARA_I18N_EVIDENCE ?? "artifacts/i18n-acceptance.json",
);

const evidence = { startedAt: new Date().toISOString(), steps: [], screenshots: [] };

function record(step, detail = {}) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`[${step}]`, JSON.stringify(detail));
}

main().catch(async (error) => {
  evidence.result = "failed";
  evidence.error = String(error?.stack ?? error);
  throw error;
}).finally(async () => {});

async function main() {
  await mkdir(artifactDirectory, { recursive: true });
  const browserPort = await findAvailablePort();
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
  try {
    const target = await waitForPageTarget(browserPort, {
      expectedUrlPrefix: "http://tauri.localhost/",
      timeoutMs: 45_000,
    });
    client = createCdpClient(target.webSocketDebuggerUrl);
    const page = createPage(client);
    await page.waitFor("document.readyState === 'complete'", "page load", 30_000);

    // The window starts hidden; the shell mirrors that into a data attribute.
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
      "the application shell",
      30_000,
    );

    const initialNav = await page.evaluate(
      `Array.from(document.querySelectorAll(".sidebar-link-label")).map((n) => n.textContent)`,
    );
    record("initial-navigation", { labels: initialNav });
    assert(
      initialNav.includes("Settings"),
      `expected English navigation, got: ${initialNav.join(", ")}`,
    );

    // Settings -> Language -> 简体中文
    await page.evaluate(`document.querySelector('[aria-label="Settings"]').click()`);
    await page.waitFor(
      `document.querySelector(".settings-page") !== null`,
      "the Settings page",
      20_000,
    );

    const switched = await page.evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll(".behavior-option"))
          .find((node) => node.textContent.includes("简体中文"));
        if (!button) {
          return { clicked: false, options: Array.from(
            document.querySelectorAll(".behavior-option strong")).map((n) => n.textContent) };
        }
        button.click();
        return { clicked: true };
      })()
    `);
    record("click-chinese", switched);
    assert(switched.clicked, `language option not found: ${JSON.stringify(switched)}`);

    await delay(1_200);
    const chineseNav = await page.evaluate(
      `Array.from(document.querySelectorAll(".sidebar-link-label")).map((n) => n.textContent)`,
    );
    const documentLang = await page.evaluate(`document.documentElement.lang`);
    record("chinese-navigation", { labels: chineseNav, documentLang });
    await screenshot(client, "settings-chinese");

    assert(
      chineseNav.includes("设置") && chineseNav.includes("概览"),
      `navigation did not switch to Chinese: ${chineseNav.join(", ")}`,
    );
    assert(documentLang === "zh-CN", `html lang not updated: ${documentLang}`);

    // Chinese page titles should also be in place.
    await page.evaluate(`document.querySelector('[aria-label="概览"]').click()`);
    await page.waitFor(
      `document.body.innerText.includes("连接")`,
      "the Chinese overview",
      20_000,
    );
    await screenshot(client, "overview-chinese");
    record("overview-chinese", {
      sample: await page.evaluate(`document.body.innerText.slice(0, 160)`),
    });

    // Restore English so the machine is left as found.
    await page.evaluate(`document.querySelector('[aria-label="设置"]').click()`);
    await page.waitFor(
      `document.querySelector(".settings-page") !== null`,
      "the Settings page again",
      20_000,
    );
    await page.evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll(".behavior-option"))
          .find((node) => node.textContent.includes("English"));
        button?.click();
      })()
    `);
    await delay(1_000);
    const restored = await page.evaluate(
      `Array.from(document.querySelectorAll(".sidebar-link-label")).map((n) => n.textContent)`,
    );
    record("restored-english", { labels: restored });
    assert(restored.includes("Settings"), `did not restore English: ${restored.join(", ")}`);

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

async function screenshot(client, name) {
  const shot = await client.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(artifactDirectory, `${name}.png`);
  if (shot?.data) {
    await writeFile(file, Buffer.from(shot.data, "base64"));
    evidence.screenshots.push(file);
    console.log(`[screenshot] ${file}`);
  }
}