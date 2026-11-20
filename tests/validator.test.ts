import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { schemaErrors, validateScenario } from "../src/lib/validate/index.ts";
import { pyRepr, pyStr } from "../src/lib/validate/rules.ts";
import { learnPrompt } from "../src/lib/scenario/learn.ts";
import type { Scenario } from "../src/lib/scenario/types.ts";
import { badFixtureFiles, FIXTURE_DIR, pythonCheck, readJson, scenarioFiles } from "./helpers.ts";

describe("bundled scenarios", () => {
  const files = scenarioFiles();
  it("there are 10", () => expect(files).toHaveLength(10));
  it.each(files.map((f) => [basename(f), f]))("%s passes schema + rules", (_n, f) => {
    const r = validateScenario(readJson(f));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("good fixtures", () => {
  it.each(["good-minimal.json", "good-new-fields.json"])("%s passes", (f) => {
    expect(validateScenario(readJson(join(FIXTURE_DIR, f))).errors).toEqual([]);
  });
});

// Every bad fixture: exact rule message(s) (= what tools/ems_scenario.py prints) and whether the schema also rejects it.
const BAD: Record<string, { rules: string[]; schema: boolean }> = {
  "branch-missing-if": { rules: ["flow 'Arrival': branch missing if/then"], schema: true },
  "branch-type": { rules: ["flow 'Arrival': branch type must be omitted or 'inject'"], schema: true },
  "card-face-hint": { rules: ["show card 'MONITOR - Lead II': instructor hint on card face ('after ') - move to 'cue'"], schema: false },
  "card-type": { rules: ["show card type video"], schema: true },
  "critical-fail-wording": { rules: ["flow 'Arrival': use 'critical (evaluator discretion)'"], schema: false },
  "duplicate-flow-id": { rules: ["duplicate flow ids: ['p0', 'p0']"], schema: false },
  "duplicate-stage-letter": {
    rules: ["duplicate vitals stage letters: ['A', 'A']", "flow 'Arrival': references Stage B but vitals has ['A', 'A']"],
    schema: false,
  },
  "expected-object-no-text": { rules: ["flow 'Transport': expected item object needs text"], schema: true },
  "goto-phase-missing": { rules: ["flow 'Arrival': goto_phase p9 is not a flow id ['p0', 'p1']"], schema: false },
  "goto-stage-disagrees": { rules: ["flow 'Arrival': goto_stage A disagrees with THEN text Stage ['B']"], schema: false },
  "goto-stage-missing": { rules: ["flow 'Arrival': goto_stage Z is not a vitals stage ['A', 'B']"], schema: false },
  "if-not-condition": {
    rules: ["flow 'Arrival': IF 'Stage B reached' is not a condition (use type:inject for examiner choices)"],
    schema: false,
  },
  "if-too-long": { rules: ["flow 'Arrival': IF text > 75 chars"], schema: true },
  "learn-more-too-long": { rules: ["learn_more prompt 552 chars > 480 (QR too dense to scan) - shorten focus"], schema: false },
  "no-expected": { rules: ["flow 'Transport': no expected actions"], schema: true },
  rhythm: { rules: ["bad rhythm torsades"], schema: true },
  "scene-safety": { rules: ["scene.safety present - scene safety is trained outside scenarios; remove it"], schema: true },
  "stage-ref-missing": { rules: ["flow 'Arrival': references Stage Z but vitals has ['A', 'B']"], schema: false },
  "tag-hint": { rules: ["moulage tag 'Eyes': instructor hint on tag ('during ') - move to 'cue'"], schema: false },
  "tag-missing-text": { rules: ["moulage tag needs region + text"], schema: true },
  "unknown-branch-key": { rules: ["flow 'Arrival': unknown branch keys {'next'}"], schema: true },
};

describe("known-bad fixtures", () => {
  const files = badFixtureFiles();
  it("every fixture file has an expectation and vice versa", () => {
    expect(files.map((f) => basename(f, ".json")).sort()).toEqual(Object.keys(BAD).sort());
  });
  it.each(files.map((f) => [basename(f, ".json"), f]))("%s fails for the expected reason", (name, f) => {
    const r = validateScenario(readJson(f));
    expect(r.ok).toBe(false);
    expect(r.ruleErrors).toEqual(BAD[name].rules);
    expect(r.schemaErrors.length > 0).toBe(BAD[name].schema);
  });
});

describe("schema messages are readable", () => {
  it("names unknown keys and the safety key", () => {
    expect(schemaErrors(readJson(join(FIXTURE_DIR, "bad", "unknown-branch-key.json")))).toContain(
      "/flow/0/branches/0: unknown key 'next'",
    );
    expect(schemaErrors(readJson(join(FIXTURE_DIR, "bad", "scene-safety.json")))).toContain("/scene/safety: not allowed");
  });
  it("requires title", () => {
    expect(schemaErrors({})).toContain("/: must have required property 'title'");
  });
});

describe("python formatting helpers", () => {
  it("matches Python str/repr", () => {
    expect(pyStr(null)).toBe("None");
    expect(pyStr(["A", "B"])).toBe("['A', 'B']");
    expect(pyRepr("it's")).toBe(`"it's"`);
    expect(pyRepr("a\nb")).toBe("'a\\nb'");
  });
});

// Ground truth: run the real Python validator and compare message-for-message.
const all = [...scenarioFiles(), join(FIXTURE_DIR, "good-minimal.json"), join(FIXTURE_DIR, "good-new-fields.json"), ...badFixtureFiles()];
const py = pythonCheck(all);
describe.skipIf(!py)("agrees with tools/ems_scenario.py validate()", () => {
  it.each(all.map((f) => [basename(f), f]))("%s: same rule errors and learn prompt", (_n, f) => {
    const sc = readJson(f) as Scenario;
    expect(validateScenario(sc).ruleErrors).toEqual(py![f].errors);
    expect(learnPrompt(sc)).toBe(py![f].prompt);
  });
  it("anything Python rejects, the shared validator rejects", () => {
    for (const f of all) if (py![f].errors.length) expect(validateScenario(readJson(f)).ok, f).toBe(false);
  });
});
