import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

type Dict = Record<string, unknown>;

function flatten(value: Dict, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? flatten(child as Dict, path)
      : [path];
  });
}

describe("locale resources", () => {
  it("shares one key set across every language", () => {
    const englishKeys = flatten(en as unknown as Dict).sort();
    const chineseKeys = flatten(zhCN as unknown as Dict).sort();

    expect(chineseKeys).toEqual(englishKeys);
  });

  it("leaves no empty translation behind", () => {
    for (const [language, dictionary] of [
      ["en", en],
      ["zh-CN", zhCN],
    ] as const) {
      for (const key of flatten(dictionary as unknown as Dict)) {
        const value = key
          .split(".")
          .reduce<unknown>(
            (node, part) => (node as Dict | undefined)?.[part],
            dictionary,
          );
        expect(typeof value, `${language}.${key}`).toBe("string");
        expect((value as string).trim(), `${language}.${key}`).not.toBe("");
      }
    }
  });

  it("keeps interpolation placeholders identical across languages", () => {
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? "").sort();

    const walk = (dictionary: Dict, prefix = ""): Array<[string, string]> =>
      Object.entries(dictionary).flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return typeof child === "object" && child !== null
          ? walk(child as Dict, path)
          : ([[path, child as string]] as Array<[string, string]>);
      });

    const chineseByKey = new Map(walk(zhCN as unknown as Dict));
    for (const [key, englishValue] of walk(en as unknown as Dict)) {
      expect(placeholders(chineseByKey.get(key) ?? ""), key).toEqual(
        placeholders(englishValue),
      );
    }
  });
});