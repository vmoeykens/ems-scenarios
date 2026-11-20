import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");
export const SCENARIO_DIR = join(ROOT, "scenarios");
export const FIXTURE_DIR = join(ROOT, "tests", "fixtures");

export const scenarioFiles = () =>
  readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(SCENARIO_DIR, f));

export const badFixtureFiles = () =>
  readdirSync(join(FIXTURE_DIR, "bad"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(FIXTURE_DIR, "bad", f));

export const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

/**
 * Run the Python generator's validate() and learn_prompt() on files.
 * Returns null when python3 or the generator's deps are unavailable (tests then skip).
 */
export function pythonCheck(files: string[]): Record<string, { errors: string[]; prompt: string }> | null {
  const code = [
    "import sys, json",
    "sys.path.insert(0, 'tools')",
    "from ems_scenario import validate, learn_prompt",
    "out = {}",
    "for f in sys.argv[1:]:",
    "    sc = json.load(open(f))",
    "    out[f] = {'errors': validate(sc), 'prompt': learn_prompt(sc)}",
    "print(json.dumps(out))",
  ].join("\n");
  try {
    return JSON.parse(execFileSync("python3", ["-c", code, ...files], { cwd: ROOT, encoding: "utf8" }));
  } catch {
    return null;
  }
}
