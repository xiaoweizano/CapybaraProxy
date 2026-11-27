
/**
 * Merges a rendered top-level block into an existing override document.
 *
 * Every other block is preserved: the override form is not the only thing an
 * operator may keep there. `key` is the block name (`dns`, `tun`); a `null`
 * block removes it.
 */
export function applyOverrideBlock(
  overrideYaml: string | null | undefined,
  key: string,
  block: string | null,
): string {
  const blockPattern = new RegExp(`^${key}:\\s*(#.*)?$`);
  const lines = (overrideYaml ?? "").split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (blockPattern.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      // A blank line or an indented line still belongs to the block.
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

/** The DNS-specific wrapper, kept so call sites read naturally. */
export function applyDnsBlock(
  overrideYaml: string | null | undefined,
  block: string | null,
): string {
  return applyOverrideBlock(overrideYaml, "dns", block);
}
