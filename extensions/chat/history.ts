import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { HistoryEntry } from "./types";

export function loadHistory(path: string, maxEntries: number): HistoryEntry[] {
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    return lines
      .map((l) => JSON.parse(l) as HistoryEntry)
      .slice(-maxEntries);
  } catch {
    return [];
  }
}

export function appendHistory(
  path: string,
  entry: HistoryEntry,
  maxEntries: number
): void {
  try {
    const entries = loadHistory(path, maxEntries);
    entries.push(entry);
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch {
    // non-fatal
  }
}
