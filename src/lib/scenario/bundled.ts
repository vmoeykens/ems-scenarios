// Scenarios shipped with the app: every scenarios/*.json (picked up automatically at build time), validated at load.
import { validateScenario, type ValidationResult } from "../validate/index.ts";
import type { Scenario } from "./types.ts";

// Raw text so the run record can carry a sha-256 of exactly the JSON that was used.
const files = import.meta.glob<string>("../../../scenarios/*.json", { eager: true, query: "?raw", import: "default" });

export interface BundledScenario {
  file: string;
  raw: string;
  scenario: Scenario;
  result: ValidationResult;
}

let cache: BundledScenario[] | null = null;

export function bundledScenarios(): BundledScenario[] {
  cache ??= Object.entries(files)
    .map(([path, raw]) => {
      const file = path.split("/").pop()!;
      let scenario: Scenario;
      let result: ValidationResult;
      try {
        scenario = JSON.parse(raw) as Scenario;
        result = validateScenario(scenario);
      } catch (e) {
        scenario = { title: file };
        const msg = `invalid JSON: ${(e as Error).message}`;
        result = { ok: false, schemaErrors: [msg], ruleErrors: [], errors: [msg] };
      }
      return { file, raw, scenario, result };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
  return cache;
}
