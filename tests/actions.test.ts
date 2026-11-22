import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { actionById, CATALOG, formatValues, linkErrors, matchesLink } from "../src/lib/actions/catalog.ts";
import { schemaErrors } from "../src/lib/validate/index.ts";
import { FIXTURE_DIR, readJson, ROOT, scenarioFiles } from "./helpers.ts";
import type { Scenario } from "../src/lib/scenario/types.ts";

describe("provider-action catalog", () => {
  it("validates against schema/actions.schema.json", () => {
    const schema = JSON.parse(readFileSync(join(ROOT, "schema/actions.schema.json"), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    const check = ajv.compile(schema);
    const ok = check(JSON.parse(readFileSync(join(ROOT, "schema/actions.json"), "utf8")));
    expect(check.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
  it("unique ids; every action in a known group; unique field ids per action", () => {
    const ids = CATALOG.actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(CATALOG.groups.map((g) => g.id));
    for (const a of CATALOG.actions) {
      expect(groups.has(a.group), a.id).toBe(true);
      const f = a.fields.map((x) => x.id);
      expect(new Set(f).size, a.id).toBe(f.length);
    }
  });
  it("paramedic-only drugs/procedures appear only under intercept, labelled Intercept/MD", () => {
    const pmOnly = /fentanyl|morphine|ketamine|ketorolac|midazolam|diphenhydramine|amiodarone|atropine|hydroxocobalamin|tranexamic|\btxa\b|needle decompression|pacing|cardioversion|intubation/i;
    for (const a of CATALOG.actions) {
      const text = JSON.stringify(a);
      if (a.group === "intercept") expect(a.label).toMatch(/^Intercept\/MD: /);
      else expect(text, a.id).not.toMatch(pmOnly);
    }
  });
  it("formats values in field order with units; empty fields skipped", () => {
    expect(formatValues(actionById("oxygen"), { rate: 15, device: "NRB" })).toBe("NRB, 15 L/min");
    expect(formatValues(actionById("iv"), { gauge: "18", site: "L AC" })).toBe("18, L AC");
    expect(formatValues(actionById("cpr"), { mode: ["Manual", "Metronome"], event: "" })).toBe("Manual + Metronome");
    expect(formatValues(actionById("md_contact"), {})).toBe("");
  });
  it("matchesLink: id + every match field (multi = contains)", () => {
    expect(matchesLink({ action: "oxygen" }, "oxygen", {})).toBe(true);
    expect(matchesLink({ action: "oxygen", match: { device: "NRB" } }, "oxygen", { device: "NRB", rate: 15 })).toBe(true);
    expect(matchesLink({ action: "oxygen", match: { device: "NRB" } }, "oxygen", { device: "NC" })).toBe(false);
    expect(matchesLink({ action: "oxygen", match: { device: "NRB" } }, "oxygen", {})).toBe(false);
    expect(matchesLink({ action: "ecg12", match: { steps: "Transmitted" } }, "ecg12", { steps: ["Acquired", "Transmitted"] })).toBe(true);
    expect(matchesLink({ action: "oxygen" }, "bvm", {})).toBe(false);
  });
  it("bad match fixture is reported with paths", () => {
    expect(linkErrors(readJson(join(FIXTURE_DIR, "bad", "action-match.json")))).toEqual([
      "/flow/0/expected/0/match/device: 'Hood' is not an option of oxygen.device",
      "/flow/0/expected/0/match/colour: action 'oxygen' has no field 'colour'",
    ]);
    expect(schemaErrors(readJson(join(FIXTURE_DIR, "good-new-fields.json")))).toEqual([]);
  });
  it.each(scenarioFiles())("%s: every action link / provider_actions entry resolves", (f) => {
    const sc = readJson(f) as Scenario;
    for (const ph of sc.flow ?? [])
      for (const it of ph.expected) if (typeof it === "object" && it.action) expect(actionById(it.action), it.action).toBeDefined();
    for (const id of sc.provider_actions ?? []) expect(actionById(id), id).toBeDefined();
    expect(linkErrors(sc)).toEqual([]);
  });
});
