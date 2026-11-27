/**
 * DNS preset helpers.
 *
 * DNS is a whole top-level block, which the subscription override already
 * supports: the operator's `dns:` block replaces the provider's. This module
 * turns a small form into that block, and reads it back so the form shows what
 * is currently in effect instead of a blank slate.
 */

export type DnsPreset = {
  /** `system` leaves DNS untouched; `custom` writes the block below. */
  mode: "system" | "custom";
  /** Primary and fallback resolvers, in order. */
  nameservers: string[];
  /** Enable Mihomo's fake-ip pool. */
  fakeIp: boolean;
  /** CIDR of the fake-ip pool. */
  fakeIpRange: string;
  /** Hosts that must resolve to their real address. */
  fakeIpFilter: string[];
};

export const DNS_PRESETS: Record<
  "cloudflare" | "aliyun" | "google" | "system",
  { nameservers: string[]; labelKey: string }
> = {
  cloudflare: {
    nameservers: ["1.1.1.1", "1.0.0.1"],
    labelKey: "settings.dnsPresetCloudflare",
  },
  aliyun: {
    nameservers: ["223.5.5.5", "223.6.6.6"],
    labelKey: "settings.dnsPresetAliyun",
  },
  google: {
    nameservers: ["8.8.8.8", "8.8.4.4"],
    labelKey: "settings.dnsPresetGoogle",
  },
  system: { nameservers: [], labelKey: "settings.dnsPresetSystem" },
};

export const DEFAULT_FAKE_IP_RANGE = "198.18.0.1/16";

export const EMPTY_DNS_PRESET: DnsPreset = {
  mode: "system",
  nameservers: [],
  fakeIp: false,
  fakeIpRange: DEFAULT_FAKE_IP_RANGE,
  fakeIpFilter: [],
};

/** True when a string looks like an IPv4 or IPv6 address. */
export function isValidResolver(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") {
    return false;
  }
  // IPv4 with each octet in range.
  const ipv4 = trimmed.split(".");
  if (ipv4.length === 4) {
    return ipv4.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) {
        return false;
      }
      const value = Number(octet);
      return value >= 0 && value <= 255;
    });
  }
  // IPv6: the loose check is enough, the core validates the real syntax.
  return /^[0-9a-f:]+$/i.test(trimmed) && trimmed.includes(":");
}

/** True for a CIDR block such as `198.18.0.1/16`. */
export function isValidCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.trim().split("/");
  if (rest.length > 0 || !address || !prefix) {
    return false;
  }
  const prefixNumber = Number(prefix);
  return (
    isValidResolver(address) &&
    Number.isInteger(prefixNumber) &&
    prefixNumber >= 0 &&
    prefixNumber <= 128
  );
}

/** Renders the preset as the `dns:` block written into the override YAML. */
export function renderDnsBlock(preset: DnsPreset): string | null {
  if (preset.mode === "system") {
    return null;
  }
  const lines = ["dns:", "  enable: true"];
  const resolvers = preset.nameservers
    .map((server) => server.trim())
    .filter((server) => isValidResolver(server));
  lines.push("  nameserver:");
  for (const server of resolvers) {
    lines.push(`    - ${server}`);
  }
  if (preset.fakeIp) {
    lines.push("  enhanced-mode: fake-ip");
    lines.push(`  fake-ip-range: ${preset.fakeIpRange.trim()}`);
    const filters = preset.fakeIpFilter
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
    if (filters.length > 0) {
      lines.push("  fake-ip-filter:");
      for (const entry of filters) {
        lines.push(`    - ${entry}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Pulls the DNS settings back out of an override document.
 *
 * Only the keys this form writes are read; anything else in the block is left
 * to the operator's text, which is why an unparsable block shows the system
 * preset rather than being rewritten.
 */
export function parseDnsBlock(overrideYaml: string | null | undefined): DnsPreset {
  if (!overrideYaml) {
    return EMPTY_DNS_PRESET;
  }
  const lines = overrideYaml.split("\n");
  const block: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (/^dns:\s*(#.*)?$/.test(line)) {
      inside = true;
      continue;
    }
    if (inside) {
      if (line.trim() === "" || line.startsWith(" ") || line.startsWith("\t")) {
        block.push(line);
      } else {
        break;
      }
    }
  }
  if (block.length === 0) {
    return EMPTY_DNS_PRESET;
  }

  const preset: DnsPreset = {
    ...EMPTY_DNS_PRESET,
    mode: "custom",
    nameservers: [],
    fakeIpFilter: [],
  };
  let list: "nameserver" | "fake-ip-filter" | null = null;
  for (const line of block) {
    const item = line.match(/^\s+-\s*(.+)$/);
    if (item) {
      const value = (item[1] ?? "").trim().replace(/^["']|["']$/g, "");
      if (list === "nameserver") {
        preset.nameservers.push(value);
      } else if (list === "fake-ip-filter") {
        preset.fakeIpFilter.push(value);
      }
      continue;
    }
    const key = line.match(/^\s{2}([a-z-]+):\s*(.*)$/);
    if (!key) {
      continue;
    }
    list = null;
    switch (key[1]) {
      case "nameserver":
        list = "nameserver";
        break;
      case "enhanced-mode":
        preset.fakeIp = (key[2] ?? "").trim() === "fake-ip";
        break;
      case "fake-ip-range":
        preset.fakeIpRange = (key[2] ?? "").trim() || DEFAULT_FAKE_IP_RANGE;
        break;
      case "fake-ip-filter":
        list = "fake-ip-filter";
        break;
      default:
        break;
    }
  }
  return preset;
}

/**
 * Merges a rendered `dns:` block into an existing override document.
 *
 * Every other top-level block is preserved: the override form is not the only
 * thing an operator may keep there.
 */
export function applyDnsBlock(
  overrideYaml: string | null | undefined,
  block: string | null,
): string {
  const lines = (overrideYaml ?? "").split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^dns:\s*(#.*)?$/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.trim() === "" || line.startsWith(" ") || line.startsWith("\t")) {
        continue;
      }
      skipping = false;
    }
    kept.push(line);
  }

  const rest = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!block) {
    return rest === "" ? "" : `${rest}\n`;
  }
  return rest === "" ? block : `${rest}\n${block}`;
}
