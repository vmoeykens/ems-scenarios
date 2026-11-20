// npm run validate [dir-or-files...]  - schema + shared rules on every scenario JSON. Exit 1 on any problem.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateScenario } from "../src/lib/validate/index.ts";

const args = process.argv.slice(2);
const targets = (args.length ? args : ["scenarios"]).flatMap((p) =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => join(p, f))
    : [p],
);

let bad = 0;
for (const file of targets) {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    bad++;
    console.log(`FAIL ${file}\n  invalid JSON: ${(e as Error).message}`);
    continue;
  }
  const r = validateScenario(data);
  if (r.ok) console.log(`ok   ${file}`);
  else {
    bad++;
    console.log(`FAIL ${file}`);
    for (const e of r.schemaErrors) console.log(`  schema: ${e}`);
    for (const e of r.ruleErrors) console.log(`  rule:   ${e}`);
  }
}
console.log(`\n${targets.length - bad}/${targets.length} valid`);
process.exit(bad ? 1 : 0);
