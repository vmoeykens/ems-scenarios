import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { branchStage, normalize, stageRefs } from "../src/lib/scenario/normalize.ts";
import type { Scenario } from "../src/lib/scenario/types.ts";
import { FIXTURE_DIR, readJson, scenarioFiles } from "./helpers.ts";

describe("normalize", () => {
  it("derives defaults when optional fields are absent", () => {
    const n = normalize(readJson(join(FIXTURE_DIR, "good-minimal.json")) as Scenario);
    expect(n.stages.map((s) => s.key)).toEqual(["A", "B"]);
    expect(n.phases.map((p) => p.id)).toEqual(["p0", "p1"]);
    expect(n.phases[0].expectedItems[0]).toEqual({ id: "p0.e0", text: "Roles assigned" });
    expect(n.phases[0].branchList[0]).toMatchObject({ id: "p0.b0", target_stage: "B" });
    expect(n.critical).toEqual([{ id: "crit0", text: "No vitals obtained" }]);
  });

  it("uses explicit keys/ids when present", () => {
    const n = normalize(readJson(join(FIXTURE_DIR, "good-new-fields.json")) as Scenario);
    expect(n.stages.map((s) => s.key)).toEqual(["A", "B"]); // stage "Better (after tx)" keyed B explicitly
    expect(n.phases.map((p) => p.id)).toEqual(["arrival", "transport"]);
    expect(n.phases[0].expectedItems).toEqual([
      { id: "roles", text: "Roles assigned" },
      { id: "arrival.e1", text: "Vitals obtained" },
      { id: "arrival.e2", text: "O2 by NRB", action: "oxygen", match: { device: "NRB" } }, // provider-action link, no explicit id
    ]);
    expect(n.phases[0].branchList.map((b) => [b.id, b.target_stage, b.goto_phase])).toEqual([
      ["treat", "B", "transport"],
      ["arrival.b1", "A", undefined],
    ]);
    expect(n.critical[0]).toEqual({ id: "no-vitals", text: "No vitals obtained" });
  });

  it("stageRefs follows the generator regex", () => {
    expect(stageRefs("pain 10/10, Stage **C**")).toEqual(["C"]);
    expect(stageRefs("Stage B values; Stage **D**")).toEqual(["B", "D"]);
    expect(stageRefs("stage c (lowercase not a ref)")).toEqual([]);
  });

  it.each(scenarioFiles())("%s: every branch target resolves to a real stage", (f) => {
    const n = normalize(readJson(f) as Scenario);
    const keys = new Set(n.stages.map((s) => s.key));
    for (const p of n.phases)
      for (const b of p.branchList) {
        if (b.goto_stage) expect(b.goto_stage).toBe(stageRefs(b.then)[0] ?? b.goto_stage);
        const t = branchStage(b);
        if (t) expect(keys.has(t)).toBe(true);
      }
  });
});
