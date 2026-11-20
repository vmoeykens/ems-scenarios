// Scenario library = bundled scenarios + session-only imports (held in memory, gone on reload).
import { bundledScenarios } from "./bundled.ts";
import { normalize, type NormalizedScenario } from "./normalize.ts";
import type { Scenario } from "./types.ts";
import { validateScenario, type ValidationResult } from "../validate/index.ts";

export interface LibraryEntry {
  /** route key: bundled file stem, or "import-N-<stem>" */
  key: string;
  file: string;
  source: "bundled" | "import";
  raw: string;
  scenario: Scenario;
  result: ValidationResult;
  norm: NormalizedScenario | null;
  hashCache?: string;
}

export const CATEGORY_ORDER = ["Medical", "Trauma", "Cardiac", "Cardiac arrest"];

export function categoryOf(sc: Scenario): string {
  const c = (sc.category ?? "").trim();
  if (c) return c;
  const p = (sc.id ?? "").split("-")[0];
  return { MED: "Medical", TRA: "Trauma", CARD: "Cardiac", ARR: "Cardiac arrest", PED: "Pediatric", OB: "OB", ENV: "Environmental" }[p] ?? "Other";
}

const stem = (f: string) => f.replace(/\.json$/i, "");

function entry(key: string, file: string, source: LibraryEntry["source"], raw: string, scenario: Scenario, result: ValidationResult): LibraryEntry {
  let norm: NormalizedScenario | null = null;
  if (result.ok) norm = normalize(scenario);
  return { key, file, source, raw, scenario, result, norm };
}

let bundled: LibraryEntry[] | null = null;
export function bundledEntries(): LibraryEntry[] {
  bundled ??= bundledScenarios().map((b) => entry(stem(b.file), b.file, "bundled", b.raw, b.scenario, b.result));
  return bundled;
}

// ---- session imports (useSyncExternalStore-friendly) ----
let imports: LibraryEntry[] = [];
const subs = new Set<() => void>();
export const subscribeLibrary = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
export const importedEntries = () => imports;

export type ImportOutcome = { ok: true; entry: LibraryEntry } | { ok: false; file: string; errors: string[] };

export function importScenarioText(file: string, raw: string): ImportOutcome {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, file, errors: [`invalid JSON: ${(e as Error).message}`] };
  }
  const result = validateScenario(data);
  if (!result.ok) return { ok: false, file, errors: result.errors };
  const e = entry(`import-${imports.length + 1}-${stem(file).replace(/[^A-Za-z0-9_-]+/g, "_")}`, file, "import", raw, data as Scenario, result);
  imports = [...imports, e];
  subs.forEach((cb) => cb());
  return { ok: true, entry: e };
}

/** Re-register an imported scenario restored from the autosave (resume after reload). */
export function restoreImported(key: string, file: string, raw: string): LibraryEntry | null {
  const existing = imports.find((e) => e.key === key);
  if (existing) return existing;
  try {
    const data = JSON.parse(raw) as Scenario;
    const result = validateScenario(data);
    if (!result.ok) return null;
    const e = entry(key, file, "import", raw, data, result);
    imports = [...imports, e];
    subs.forEach((cb) => cb());
    return e;
  } catch {
    return null;
  }
}

export function findEntry(key: string): LibraryEntry | undefined {
  return bundledEntries().find((e) => e.key === key) ?? imports.find((e) => e.key === key);
}

/** Bundled entry for a run record (Runs screen): match id, prefer the same hash. */
export async function findForRun(scenarioId: string, hash: string): Promise<{ entry: LibraryEntry | undefined; sameHash: boolean }> {
  const all = [...bundledEntries(), ...imports].filter((e) => e.scenario.id === scenarioId && e.norm);
  for (const e of all) await ensureHash(e);
  const exact = all.find((e) => e.hashCache === hash);
  if (exact) return { entry: exact, sameHash: true };
  return { entry: all[0], sameHash: false };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compute and cache hashes for all known entries (async; used before starting a run / matching run files). */
export async function ensureHash(e: LibraryEntry): Promise<string> {
  e.hashCache ??= await sha256Hex(e.raw);
  return e.hashCache;
}
