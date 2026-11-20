// Scenarios shipped with the app: every scenarios/*.json, validated at load.
import { validateScenario, type ValidationResult } from "../validate/index.ts";
import type { Scenario } from "./types.ts";

const files = import.meta.glob<Scenario>("../../../scenarios/*.json", { eager: true, import: "default" });

export interface BundledScenario {
  file: string;
  scenario: Scenario;
  result: ValidationResult;
}

export function bundledScenarios(): BundledScenario[] {
  return Object.entries(files)
    .map(([path, scenario]) => ({ file: path.split("/").pop()!, scenario, result: validateScenario(scenario) }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
