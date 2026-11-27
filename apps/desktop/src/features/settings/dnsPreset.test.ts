import { describe, expect, it } from "vitest";
import {
  EMPTY_DNS_PRESET,
  applyDnsBlock,
  isValidCidr,
  isValidResolver,
  parseDnsBlock,
  renderDnsBlock,
  type DnsPreset,
} from "./dnsPreset";

const custom = (overrides: Partial<DnsPreset> = {}): DnsPreset => ({
  mode: "custom",
  nameservers: ["1.1.1.1", "1.0.0.1"],
  fakeIp: false,
  fakeIpRange: "198.18.0.1/16",
  fakeIpFilter: [],
  ...overrides,
});

describe("dns preset", () => {
  it("validates IPv4, IPv6 and CIDR input", () => {
    expect(isValidResolver("1.1.1.1")).toBe(true);
    expect(isValidResolver("255.255.255.255")).toBe(true);
    expect(isValidResolver("256.1.1.1")).toBe(false);
    expect(isValidResolver("::1")).toBe(true);
    expect(isValidResolver("dns.example.com")).toBe(false);
    expect(isValidCidr("198.18.0.1/16")).toBe(true);
    expect(isValidCidr("198.18.0.1")).toBe(false);
    expect(isValidCidr("198.18.0.1/999")).toBe(false);
  });

  it("renders nothing for the system preset", () => {
    expect(renderDnsBlock(EMPTY_DNS_PRESET)).toBeNull();
  });

  it("renders nameservers and fake-ip options", () => {
    const block = renderDnsBlock(
      custom({ fakeIp: true, fakeIpFilter: ["*.lan"] }),
    );

    expect(block).toContain("dns:");
    expect(block).toContain("  enable: true");
    expect(block).toContain("    - 1.1.1.1");
    expect(block).toContain("  enhanced-mode: fake-ip");
    expect(block).toContain("  fake-ip-range: 198.18.0.1/16");
    expect(block).toContain("    - *.lan");
  });

  it("drops resolvers that are not addresses", () => {
    const block = renderDnsBlock(
      custom({ nameservers: ["1.1.1.1", "not-an-ip"] }),
    );

    expect(block).toContain("1.1.1.1");
    expect(block).not.toContain("not-an-ip");
  });

  it("round-trips through the override document", () => {
    const block = renderDnsBlock(custom({ fakeIp: true })) ?? "";
    const merged = applyDnsBlock("", block);

    const parsed = parseDnsBlock(merged);

    expect(parsed.mode).toBe("custom");
    expect(parsed.nameservers).toEqual(["1.1.1.1", "1.0.0.1"]);
    expect(parsed.fakeIp).toBe(true);
    expect(parsed.fakeIpRange).toBe("198.18.0.1/16");
  });

  it("replaces only the dns block and keeps the rest of the override", () => {
    const existing = "tun:\n  enable: false\ndns:\n  enable: false\n";
    const merged = applyDnsBlock(
      existing,
      renderDnsBlock(custom()),
    );

    // The other block survives untouched; only the old dns body is gone.
    expect(merged).toContain("tun:\n  enable: false");
    expect(merged.match(/^dns:/gm)).toHaveLength(1);
    expect(merged).toContain("    - 1.1.1.1");
  });

  it("removes the dns block when switching back to the system preset", () => {
    const existing = "tun:\n  enable: false\ndns:\n  enable: true\n";
    const merged = applyDnsBlock(existing, null);

    expect(merged).not.toContain("dns:");
    expect(merged).toContain("tun:");
  });

  it("treats a document without a dns block as the system preset", () => {
    expect(parseDnsBlock("tun:\n  enable: false\n")).toEqual(EMPTY_DNS_PRESET);
    expect(parseDnsBlock(null)).toEqual(EMPTY_DNS_PRESET);
  });
});
