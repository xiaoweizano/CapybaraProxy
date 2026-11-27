import { describe, expect, it } from "vitest";
import type { RuleItem } from "../../platform/runtime";
import { evaluateRule, matchRules } from "./ruleMatcher";

const rule = (index: number, type: string, payload: string): RuleItem => ({
  index,
  rule_type: type,
  payload,
  proxy: `TARGET-${index}`,
});

describe("rule matcher", () => {
  it("matches domain rules by exact name, suffix and keyword", () => {
    expect(evaluateRule(rule(0, "DOMAIN", "example.com"), "example.com")).toBe(
      true,
    );
    expect(evaluateRule(rule(0, "DOMAIN", "example.com"), "a.example.com")).toBe(
      false,
    );
    expect(
      evaluateRule(rule(0, "DOMAIN-SUFFIX", "example.com"), "a.example.com"),
    ).toBe(true);
    expect(
      evaluateRule(rule(0, "DOMAIN-SUFFIX", "example.com"), "notexample.com"),
    ).toBe(false);
    expect(
      evaluateRule(rule(0, "DOMAIN-KEYWORD", "examp"), "api.example.com"),
    ).toBe(true);
  });

  it("matches IPv4 CIDR blocks and reports malformed ones as unknown", () => {
    expect(evaluateRule(rule(0, "IP-CIDR", "10.0.0.0/8"), "10.1.2.3")).toBe(
      true,
    );
    expect(evaluateRule(rule(0, "IP-CIDR", "10.0.0.0/8"), "11.1.2.3")).toBe(
      false,
    );
    expect(evaluateRule(rule(0, "IP-CIDR", "10.0.0.0/99"), "10.1.2.3")).toBe(
      undefined,
    );
    // A host name cannot match an IP rule, and that is a definite "no".
    expect(evaluateRule(rule(0, "IP-CIDR", "10.0.0.0/8"), "example.com")).toBe(
      false,
    );
  });

  it("treats rules needing runtime data as unknown rather than absent", () => {
    expect(evaluateRule(rule(0, "GEOIP", "CN"), "example.com")).toBe(undefined);
    expect(evaluateRule(rule(0, "RULE-SET", "cn"), "example.com")).toBe(
      undefined,
    );
    expect(
      evaluateRule(rule(0, "PROCESS-NAME", "chrome.exe"), "example.com"),
    ).toBe(undefined);
  });

  it("stops at the first match and reports what it skipped on the way", () => {
    const rules = [
      rule(0, "GEOIP", "CN"),
      rule(1, "DOMAIN-SUFFIX", "example.com"),
      rule(2, "MATCH", ""),
    ];

    const verdict = matchRules(rules, "api.example.com");

    expect(verdict.matched?.index).toBe(1);
    expect(verdict.matched?.proxy).toBe("TARGET-1");
    expect(verdict.skipped.map((entry) => entry.index)).toEqual([0]);
    expect(verdict.evaluated).toBe(1);
  });

  it("falls through to MATCH when nothing else decides the route", () => {
    const rules = [rule(0, "DOMAIN", "other.com"), rule(1, "MATCH", "")];

    const verdict = matchRules(rules, "example.com");

    expect(verdict.matched?.index).toBe(1);
    expect(verdict.evaluated).toBe(2);
  });

  it("returns nothing for an empty target", () => {
    expect(matchRules([rule(0, "MATCH", "")], "   ").matched).toBeNull();
  });

  it("strips brackets from an IPv6 literal", () => {
    const rules = [rule(0, "MATCH", "")];

    const verdict = matchRules(rules, "[::1]");

    expect(verdict.matched?.index).toBe(0);
  });
});
