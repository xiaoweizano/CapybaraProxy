// Prepares the binaries bundled into the desktop installer.
//
// The Mihomo core and the geodata snapshots are large and versioned, so they
// are not committed. This script copies them into `src-tauri/resources/` and
// verifies every checksum, which keeps the bundle reproducible from a machine
// that has the pinned inputs.
//
// Usage:
//   node scripts/prepare-bundle-resources.mjs [--force]

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const resourcesRoot = path.join(projectRoot, "apps", "desktop", "src-tauri", "resources");

const MIHOMO_SOURCE =
  process.env.CAPYBARA_MIHOMO_SOURCE ??
  "F:/codex-install/mihomo/v1.19.33/win-amd64/mihomo-windows-amd64.exe";
const GEODATA_CACHE =
  process.env.CAPYBARA_GEODATA_CACHE ?? "F:/codex-install/geodata/meta-rules-dat";

// SHA-256 of the pinned Mihomo release. Must match LOCKED_MIHOMO_SHA256 in
// crates/mihomo-manager/src/binary.rs.
const MIHOMO_SHA256 =
  "1cde41cfffd3de0aedad63c0a8515e1ce5eea507e8133aed0f637d316c93800a";

// Pinned geodata snapshots. Update together with the manifest below.
const GEODATA_FILES = [
  {
    source: "geosite.dat",
    target: "geodata/geosite.dat",
    expectedSha256:
      "2bdf171e1862b47cc5cd322ee43e5d066d9963025919ebb58dc7891d2b92643e",
  },
  {
    source: "geoip.metadb",
    target: "geodata/geoip.metadb",
    expectedSha256:
      "4236cf8477d12ceb4837eff39a03a65d5d55a72d3cccdc92e2e36d9cdbd686e3",
  },
];

const force = process.argv.includes("--force");

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function copyVerified({ source, target, expectedSha256 }) {
  const destination = path.join(resourcesRoot, target);
  await mkdir(path.dirname(destination), { recursive: true });

  if (!force) {
    const existing = await stat(destination).catch(() => null);
    if (existing) {
      const digest = await sha256(destination);
      if (!expectedSha256 || digest === expectedSha256) {
        console.log(`keep    ${target} (${existing.size} bytes)`);
        return { target, bytes: existing.size, sha256: digest };
      }
    }
  }

  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat) {
    throw new Error(`Missing bundle input: ${source}`);
  }

  const digest = await sha256(source);
  if (expectedSha256 && digest !== expectedSha256) {
    throw new Error(
      `Checksum mismatch for ${source}\n  expected ${expectedSha256}\n  actual   ${digest}`,
    );
  }

  await copyFile(source, destination);
  console.log(`copy    ${target} (${sourceStat.size} bytes)`);
  return { target, bytes: sourceStat.size, sha256: digest };
}

async function main() {
  const entries = [];

  entries.push(
    await copyVerified({
      source: MIHOMO_SOURCE,
      target: "mihomo/mihomo.exe",
      expectedSha256: MIHOMO_SHA256,
    }),
  );

  for (const file of GEODATA_FILES) {
    entries.push(
      await copyVerified({
        source: path.join(GEODATA_CACHE, file.source),
        target: file.target,
        expectedSha256: file.expectedSha256,
      }),
    );
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    mihomo: entries[0],
    geodata: entries.slice(1),
  };
  await writeFile(
    path.join(resourcesRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`\nWrote ${path.join(resourcesRoot, "manifest.json")}`);
}

await main();
