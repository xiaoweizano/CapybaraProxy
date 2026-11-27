// Static locale parity check.
//
// `zh-CN.ts` is typed against the `en` resource shape, so `tsc` already fails on
// a key missing in Chinese. This script catches the other direction — a key left
// behind in Chinese after being removed from English — with a real parse rather
// than a line scan: a wrapped string or a nested object cannot fool it.
//
// Types are stripped with esbuild (already installed for Vite), so the check
// runs in CI without a Rust toolchain or an app binary.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const root = path.resolve(import.meta.dirname, "..");
const locales = path.join(root, "apps/desktop/src/i18n/locales");

/**
 * esbuild is a transitive dependency, so it cannot be imported by name; the
 * resolve below finds whichever copy pnpm installed.
 */
async function loadEsbuild() {
  // pnpm keeps esbuild under its store rather than a flat node_modules, so the
  // resolve is anchored on the directories that do contain it.
  const searchPaths = [
    path.join(root, "apps/desktop"),
    path.join(root, "node_modules/.pnpm"),
  ];
  for (const base of searchPaths) {
    try {
      const resolved = require.resolve("esbuild", { paths: [base] });
      const module = require(resolved);
      if (typeof module.transform === "function") {
        return module;
      }
    } catch {
      // Try the next location.
    }
  }
  throw new Error("esbuild is required to strip TypeScript types for this check.");
}

/** Flattens a locale resource into dotted key paths. */
function flatten(value, prefix = "", keys = new Set()) {
  for (const [key, entry] of Object.entries(value)) {
    const dotted = prefix === "" ? key : `${prefix}.${key}`;
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      flatten(entry, dotted, keys);
    } else {
      keys.add(dotted);
    }
  }
  return keys;
}

async function loadResource(esbuild, fileName, exportName) {
  const source = readFileSync(path.join(locales, fileName), "utf8");
  const { code } = await esbuild.transform(source, {
    loader: "ts",
    format: "esm",
  });
  // The transformed module still has its `import type` line removed, so it can
  // be evaluated through a data URL without touching the filesystem.
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  const value = module[exportName];
  if (typeof value !== "object" || value === null) {
    throw new Error(`${exportName} in ${fileName} did not evaluate to an object.`);
  }
  return value;
}

const esbuild = await loadEsbuild();
const english = flatten(await loadResource(esbuild, "en.ts", "en"));
const chinese = flatten(await loadResource(esbuild, "zh-CN.ts", "zhCN"));

const missingInChinese = [...english].filter((key) => !chinese.has(key));
const extraInChinese = [...chinese].filter((key) => !english.has(key));

if (missingInChinese.length > 0 || extraInChinese.length > 0) {
  if (missingInChinese.length > 0) {
    console.error("Keys missing from zh-CN:");
    for (const key of missingInChinese) {
      console.error(`  - ${key}`);
    }
  }
  if (extraInChinese.length > 0) {
    console.error("Keys present only in zh-CN:");
    for (const key of extraInChinese) {
      console.error(`  - ${key}`);
    }
  }
  process.exit(1);
}

console.log(`Locale keys match: ${english.size} keys in both files.`);
