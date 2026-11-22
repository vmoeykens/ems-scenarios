// Live check for pasted/uploaded scenario text (no Vite-only imports, so tests can use it directly).
import { validateScenario } from "../validate/index.ts";
import { parseScenarioText } from "./parse.ts";
import type { Scenario } from "./types.ts";

export type CheckResult =
  | { state: "empty" }
  | { state: "json-error"; error: string; snippet?: string }
  | { state: "invalid"; errors: string[]; scenario: Partial<Scenario>; cleaned: boolean }
  | { state: "valid"; scenario: Scenario; json: string; cleaned: boolean; duplicateOf?: string };

/** Parse (tolerant of chat prose / ``` fences) then validate with the same schema + rules as file import. */
export function checkScenarioText(raw: string, existing: { id?: string; title?: string }[] = []): CheckResult {
  if (!raw.trim()) return { state: "empty" };
  const p = parseScenarioText(raw);
  if (!p.ok) return { state: "json-error", error: p.error, snippet: p.snippet };
  const result = validateScenario(p.data);
  const sc = (p.data ?? {}) as Scenario;
  if (!result.ok) return { state: "invalid", errors: result.errors, scenario: sc, cleaned: p.cleaned };
  const dup = existing.find((e) => e.id && e.id === sc.id);
  return { state: "valid", scenario: sc, json: p.json, cleaned: p.cleaned, duplicateOf: dup ? `${dup.id} ${dup.title ?? ""}`.trim() : undefined };
}
