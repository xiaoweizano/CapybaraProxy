import type { ConnectionSummary } from "../../platform/runtime";

/**
 * Aggregates live connections by host and by rule so the page can answer
 * "what is actually eating the bandwidth", which a per-row list cannot.
 *
 * Only the live table is used: this is a snapshot of right now, not a
 * historical record, and it should say so when it is shown.
 */

export type AttributionRow = {
  key: string;
  /** Bytes moved through this host or rule, both directions. */
  bytes: number;
  upload: number;
  download: number;
  connections: number;
};

export type Attribution = {
  total: AttributionRow;
  byHost: AttributionRow[];
  byRule: AttributionRow[];
};

function emptyRow(key: string): AttributionRow {
  return { key, bytes: 0, upload: 0, download: 0, connections: 0 };
}

function accumulate(row: AttributionRow, connection: ConnectionSummary): void {
  row.upload += connection.upload_bytes;
  row.download += connection.download_bytes;
  row.bytes += connection.upload_bytes + connection.download_bytes;
  row.connections += 1;
}

function sortRows(rows: AttributionRow[], limit: number): AttributionRow[] {
  return [...rows]
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, limit);
}

/**
 * Builds the attribution view.
 *
 * A connection without a host falls back to its destination IP so an IP-only
 * session still lands in a bucket instead of "unknown".
 */
export function attributeConnections(
  connections: readonly ConnectionSummary[],
  limit = 8,
): Attribution {
  const total = emptyRow("total");
  const hosts = new Map<string, AttributionRow>();
  const rules = new Map<string, AttributionRow>();

  for (const connection of connections) {
    accumulate(total, connection);

    const hostKey = connection.host || connection.destination_ip || "—";
    const hostRow = hosts.get(hostKey) ?? emptyRow(hostKey);
    accumulate(hostRow, connection);
    hosts.set(hostKey, hostRow);

    const ruleKey = connection.rule || "—";
    const ruleRow = rules.get(ruleKey) ?? emptyRow(ruleKey);
    accumulate(ruleRow, connection);
    rules.set(ruleKey, ruleRow);
  }

  return {
    total,
    byHost: sortRows([...hosts.values()], limit),
    byRule: sortRows([...rules.values()], limit),
  };
}

/** Share of the total, as a 0–100 number for a progress bar. */
export function shareOf(row: AttributionRow, total: AttributionRow): number {
  return total.bytes === 0 ? 0 : Math.round((row.bytes / total.bytes) * 100);
}
