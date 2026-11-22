import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractJsonText, parseScenarioText } from "../src/lib/scenario/parse.ts";
import { checkScenarioText } from "../src/lib/scenario/check.ts";
import { validateScenario } from "../src/lib/validate/index.ts";
import { SCENARIO_DIR } from "./helpers.ts";

const raw = readFileSync(join(SCENARIO_DIR, "MED-01_hypoglycemia_refusal.json"), "utf8");
const data = JSON.parse(raw);
const chatReply = `Sure! Here is the finished scenario:\n\n\`\`\`json\n${raw}\n\`\`\`\n\nLet me know if you'd like any changes.`;

describe("extractJsonText / parseScenarioText", () => {
  it("plain JSON is unchanged", () => {
    const r = parseScenarioText(raw);
    expect(r.ok && r.cleaned).toBe(false);
    expect(r.ok && r.data).toEqual(data);
  });
  it("strips a chat reply with prose and ```json fences", () => {
    const r = parseScenarioText(chatReply);
    expect(r.ok).toBe(true);
    expect(r.ok && r.cleaned).toBe(true);
    expect(r.ok && r.data).toEqual(data);
  });
  it("strips prose without fences and a BOM", () => {
    const r = parseScenarioText(`﻿Here you go: ${raw} hope that helps`);
    expect(r.ok && r.data).toEqual(data);
  });
  it("empty / no object", () => {
    expect(extractJsonText("   ")).toBeNull();
    expect(parseScenarioText("no json here").ok).toBe(false);
  });
  it("trailing comma reports line and column with the bad line", () => {
    const r = parseScenarioText('{\n  "id": "MED-09",\n  "title": "x",\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/^Invalid JSON \(line \d+, column \d+\)/);
      expect(r.line).toBeGreaterThanOrEqual(3);
      expect(r.snippet).toBeDefined();
    }
  });
  it("truncated paste reports a position", () => {
    const r = parseScenarioText(raw.slice(0, 400));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid JSON/);
  });
});

describe("checkScenarioText (live validation)", () => {
  it("empty", () => expect(checkScenarioText("").state).toBe("empty"));
  it("valid chat reply, flags duplicate bundled id", () => {
    const c = checkScenarioText(chatReply, [{ id: "MED-01", title: "Hypoglycemia" }]);
    expect(c.state).toBe("valid");
    if (c.state === "valid") {
      expect(c.cleaned).toBe(true);
      expect(c.duplicateOf).toMatch(/^MED-01 /);
    }
  });
  it("schema problems are listed (same messages as file import)", () => {
    const bad = structuredClone(data);
    bad.showcards = [];
    bad.scene.safety = "Scene safe";
    const c = checkScenarioText(JSON.stringify(bad));
    expect(c.state).toBe("invalid");
    if (c.state === "invalid") {
      expect(c.errors.some((e) => e.includes("showcards"))).toBe(true);
      expect(c.errors.some((e) => e.includes("safety"))).toBe(true);
      expect(c.errors).toEqual(validateScenario(bad).errors); // identical to file import / npm run validate
    }
  });
  it("json syntax error", () => expect(checkScenarioText('{"id": "MED-09",}').state).toBe("json-error"));
});
