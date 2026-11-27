import type { RuleItem } from "../../platform/runtime";

/**
 * A best-effort evaluation of the rule table for one target.
 *
 * Mihomo's matching is authoritative and includes inputs this page cannot see
 * (the resolved IP, the process name, rule-set contents fetched at runtime).
 * This module evaluates only the rules whose match is a pure function of the
 * target string, and reports the rules it had to skip so the operator knows the
 * verdict is a lower bound rather than a promise.
 */

export type RuleTarget = {
  /** Host name or IP address the operator typed. */
  value: string;
};

export type RuleVerdict = {
  /** The rule that would decide the route, when one could be evaluated. */
  matched: RuleItem | null;
  /**
   * Rules skipped before the match because they need data this page lacks.
   * The real core may have matched one of them first.
   */
  skipped: RuleItem[];
  /** Rules that were evaluated and did not match. */
  evaluated: number;
};

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+:[0-9a-f:]*$/i;

function isIp(value: string): boolean {
  return IPV4.test(value) || IPV6.test(value);
}

function parseIpv4(value: string): number[] | null {
  if (!IPV4.test(value)) {
    return null;
  }
  const parts = value.split(".").map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

/** True when `target` falls inside `cidr` (`a.b.c.d/n`). */
function inIpv4Cidr(target: string, cidr: string): boolean | null {
  const [address, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  const base = parseIpv4(address ?? "");
  const candidate = parseIpv4(target);
  if (base === null || candidate === null || !Number.isInteger(prefix)) {
    return null;
  }
  if (prefix < 0 || prefix > 32) {
    return null;
  }
  let mask = 0;
  for (let index = 0; index < 4; index += 1) {
    mask = (mask << 8) | (base[index] ?? 0);
  }
  let value = 0;
  for (let index = 0; index < 4; index += 1) {
    value = (value << 8) | (candidate[index] ?? 0);
  }
  const shift = 32 - prefix;
  // `>>> 0` keeps the arithmetic unsigned, which is what the octet packing
  // above produces above 2^31.
  return (mask >>> shift) === (value >>> shift);
}

/**
 * Evaluates one rule against a target.
 *
 * Returns `undefined` when the rule needs data this page does not have, which
 * is different from `false` (evaluated, no match).
 */
export function evaluateRule(
  rule: RuleItem,
  target: string,
): boolean | undefined {
  const type = rule.rule_type.toUpperCase();
  const payload = rule.payload.trim();
  const host = target.toLowerCase();
  const payloadLower = payload.toLowerCase();

  switch (type) {
    case "DOMAIN":
      return host === payloadLower;
    case "DOMAIN-SUFFIX":
      return host === payloadLower || host.endsWith(`.${payloadLower}`);
    case "DOMAIN-KEYWORD":
      return payloadLower !== "" && host.includes(payloadLower);
    case "DOMAIN-REGEX":
      try {
        return new RegExp(payload, "i").test(host);
      } catch {
        return undefined;
      }
    case "IP-CIDR":
    case "IP-CIDR6":
      return isIp(host) ? (inIpv4Cidr(host, payload) ?? undefined) : false;
    case "DST-PORT":
    case "SRC-PORT":
      // A bare host has no port; answer "no match" rather than "unknown" so a
      // port rule does not hide the rule that actually decides the route.
      return false;
    case "MATCH":
      return true;
    // Everything below needs data the page does not have: the resolved address
    // for a domain target, rule-set contents, or the OS process.
    case "GEOIP":
    case "GEOSITE":
    case "SRC-GEOIP":
    case "IP-ASN":
    case "SRC-IP-ASN":
    case "RULE-SET":
    case "AND":
    case "OR":
    case "NOT":
    case "SUB-RULE":
    case "PROCESS-NAME":
    case "PROCESS-PATH":
    case "PROCESS-NAME-REGEX":
    case "PROCESS-PATH-REGEX":
    case "NETWORK":
    case "SRC-IP-CIDR":
    case "IN-PORT":
    case "IN-TYPE":
    case "IN-USER":
    case "IN-NAME":
    case "UID":
      return undefined;
    default:
      return undefined;
  }
}

/** Walks the table in order, the way the core does, and stops at the match. */
export function matchRules(rules: RuleItem[], target: string): RuleVerdict {
  const trimmed = target.trim();
  const verdict: RuleVerdict = { matched: null, skipped: [], evaluated: 0 };
  if (trimmed === "") {
    return verdict;
  }

  const host = trimmed.replace(/^\[|\]$/g, "");
  for (const rule of rules) {
    const result = evaluateRule(rule, host);
    if (result === undefined) {
      verdict.skipped.push(rule);
      continue;
    }
    verdict.evaluated += 1;
    if (result) {
      verdict.matched = rule;
      return verdict;
    }
  }
  return verdict;
}

/** Rule types this page can evaluate, for the UI hint. */
export const EVALUATED_RULE_TYPES = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-REGEX",
  "IP-CIDR",
  "IP-CIDR6",
  "MATCH",
];
