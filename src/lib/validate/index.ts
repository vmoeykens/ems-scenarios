// Shared validator: JSON Schema (structure) + rules (mirror of tools/ems_scenario.py validate()).
// Used by `npm run validate`, vitest, and the app's import path.
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import schema from "../../../schema/scenario.schema.json" with { type: "json" };
import { validateRules } from "./rules.ts";
import type { Scenario } from "../scenario/types.ts";

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const schemaCheck = ajv.compile<Scenario>(schema);

export interface ValidationResult {
  ok: boolean;
  /** Structural problems from schema/scenario.schema.json, "<json pointer>: <message>". */
  schemaErrors: string[];
  /** Content-rule problems; same text as tools/ems_scenario.py validate() would print. */
  ruleErrors: string[];
  errors: string[];
}

function fmt(e: ErrorObject): string {
  const where = e.instancePath || "/";
  if (e.keyword === "additionalProperties") return `${where}: unknown key '${(e.params as { additionalProperty: string }).additionalProperty}'`;
  if (e.keyword === "enum") return `${where}: ${e.message} (${(e.params as { allowedValues: unknown[] }).allowedValues.join(", ")})`;
  if (e.keyword === "false schema") return `${where}: not allowed`;
  return `${where}: ${e.message}`;
}

export function schemaErrors(data: unknown): string[] {
  if (schemaCheck(data)) return [];
  // "if" errors just say "must match then schema"; the specific then-branch errors are reported alongside.
  const out = (schemaCheck.errors ?? []).filter((e) => e.keyword !== "if").map(fmt);
  return [...new Set(out)];
}

export function validateScenario(data: unknown): ValidationResult {
  const s = schemaErrors(data);
  let r: string[];
  try {
    r = validateRules(data);
  } catch (e) {
    // Rules assume roughly the right shape; if the schema already failed, report that instead of a crash.
    r = s.length ? [] : [`rules check crashed: ${(e as Error).message}`];
  }
  return { ok: s.length === 0 && r.length === 0, schemaErrors: s, ruleErrors: r, errors: [...s, ...r] };
}

export { validateRules };
