import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { append, branchBodies, newRecord } from "../src/lib/run/actions.ts";
import { completion, elapsed, fmtT, lastUndoable, reduce } from "../src/lib/run/reducer.ts";
import { CSV_HEADER, exportCsv, exportJson, parseRunFile, summaryHtml } from "../src/lib/run/export.ts";
import type { RunEvent, RunEventBody } from "../src/lib/run/types.ts";
import { normalize } from "../src/lib/scenario/normalize.ts";
import { FOOTER } from "../src/lib/scenario/constants.ts";
import type { Scenario } from "../src/lib/scenario/types.ts";
import { readJson, SCENARIO_DIR } from "./helpers.ts";

const card01 = normalize(readJson(join(SCENARIO_DIR, "CARD-01_inferior_stemi.json")) as Scenario);
const T0 = Date.parse("2026-11-20T10:00:00Z");

/** append bodies at given wall offsets (s) */
function play(steps: [number, RunEventBody | RunEventBody[]][]): RunEvent[] {
  let ev: RunEvent[] = [];
  for (const [s, b] of steps) ev = append(card01, ev, Array.isArray(b) ? b : [b], T0 + s * 1000);
  return ev;
}

describe("clock", () => {
  it("timestamps events on the scenario clock, excluding pauses", () => {
    const ev = play([
      [0, { kind: "note", text: "before start" }],
      [5, { kind: "clock", action: "start" }],
      [65, { kind: "note", text: "one minute in" }],
      [70, { kind: "clock", action: "pause" }],
      [100, { kind: "clock", action: "resume" }],
      [110, { kind: "note", text: "after pause" }],
    ]);
    expect(ev.map((e) => e.t)).toEqual([0, 0, 60000, 65000, 65000, 75000]);
    expect(ev.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    const s = reduce(card01, ev);
    expect(s.clock.running).toBe(true);
    expect(elapsed(s.clock, T0 + 120000)).toBe(85000);
    expect(fmtT(85000)).toBe("T+01:25");
  });
  it("reset zeroes the clock but keeps the log", () => {
    const ev = play([
      [0, { kind: "clock", action: "start" }],
      [30, { kind: "clock", action: "reset" }],
      [40, { kind: "note", text: "x" }],
    ]);
    expect(ev[2].t).toBe(0);
    expect(reduce(card01, ev).clock.started).toBe(false);
  });
});

describe("branch navigation", () => {
  const treat = card01.phases[3]; // 8-12 Treatment decision
  it("crew branch with goto_stage logs the branch and switches the vitals stage", () => {
    const b = treat.branchList[0];
    expect(b.goto_stage).toBe("C");
    expect(branchBodies(card01, treat.id, b.id)).toEqual([
      { kind: "branch", phaseId: treat.id, branchId: b.id, inject: false },
      { kind: "stage", stageKey: "C", via: b.id },
    ]);
    const s = reduce(card01, play([[0, branchBodies(card01, treat.id, b.id)]]));
    expect(s.stageKey).toBe("C");
    expect(s.stageVia).toBe(b.id);
    expect(s.branches).toHaveLength(1);
    expect(s.phaseId).toBe(card01.phases[0].id); // no automatic phase advance
  });
  it("branch without goto_stage only logs", () => {
    const b = treat.branchList[1];
    const s = reduce(card01, play([[0, branchBodies(card01, treat.id, b.id)]]));
    expect(s.stageKey).toBe("A");
    expect(s.branches[0].branchId).toBe(b.id);
  });
  it("examiner inject branches are flagged inject", () => {
    const last = card01.phases[card01.phases.length - 1];
    const inj = last.branchList.find((x) => x.type === "inject")!;
    expect(branchBodies(card01, last.id, inj.id)[0]).toMatchObject({ inject: true });
  });
  it("goto_phase moves the current phase", () => {
    const sc = normalize(readJson(join(import.meta.dirname, "fixtures", "good-new-fields.json")) as Scenario);
    const ph = sc.phases[0];
    const b = ph.branchList.find((x) => x.goto_phase)!;
    const ev = append(sc, [], branchBodies(sc, ph.id, b.id), T0);
    const s = reduce(sc, ev);
    expect(s.phaseId).toBe(b.goto_phase);
    expect(s.stageKey).toBe(b.goto_stage);
  });
  it("unknown branch yields nothing", () => expect(branchBodies(card01, "nope", "x")).toEqual([]));
});

describe("event log + undo", () => {
  it("undo appends an inverse marker; the original stays in the log", () => {
    const item = card01.phases[0].expectedItems[0].id;
    let ev = play([
      [0, { kind: "clock", action: "start" }],
      [10, { kind: "expected", itemId: item, checked: true }],
      [20, { kind: "reveal", stageKey: "A", vital: "BP", value: "112/74" }],
    ]);
    expect(reduce(card01, ev).latest.BP?.value).toBe("112/74");
    const last = lastUndoable(ev)!;
    expect(last.kind).toBe("reveal");
    ev = append(card01, ev, [{ kind: "undo", target: last.seq }], T0 + 25000);
    let s = reduce(card01, ev);
    expect(s.latest.BP).toBeUndefined();
    expect(s.expected[item].t).toBe(10000);
    expect(ev).toHaveLength(4);
    // next undo goes to the checklist item, never the clock
    ev = append(card01, ev, [{ kind: "undo", target: lastUndoable(ev)!.seq }], T0 + 26000);
    s = reduce(card01, ev);
    expect(s.expected[item]).toBeUndefined();
    expect(lastUndoable(ev)).toBeUndefined();
    expect(s.clock.running).toBe(true);
  });
  it("checklist uncheck, critical toggle, history, cards/tags newest first", () => {
    const item = card01.phases[1].expectedItems[0].id;
    const ev = play([
      [1, { kind: "expected", itemId: item, checked: true }],
      [2, { kind: "expected", itemId: item, checked: false }],
      [3, { kind: "critical", itemId: "crit2", status: "missed" }],
      [4, { kind: "critical", itemId: "crit3", status: "met" }],
      [5, { kind: "critical", itemId: "crit3", status: null }],
      [6, { kind: "history", section: "SAMPLE", index: 1, done: true }],
      [7, { kind: "card", cardIndex: 0, action: "show" }],
      [8, { kind: "tag", tagIndex: 2, action: "show" }],
      [9, { kind: "card", cardIndex: 3, action: "show" }],
      [10, { kind: "card", cardIndex: 0, action: "hide" }],
    ]);
    const s = reduce(card01, ev);
    expect(s.expected[item]).toBeUndefined();
    expect(s.critical).toEqual({ crit2: expect.objectContaining({ status: "missed" }) });
    expect(s.history["SAMPLE:1"]).toBeDefined();
    expect(s.cards.map((c) => c.cardIndex)).toEqual([3]);
    expect(s.tags.map((t) => t.tagIndex)).toEqual([2]);
  });
  it("strip/capno card overrides the monitor until the stage changes", () => {
    const ev = play([
      [1, { kind: "card", cardIndex: 5, action: "show" }], // CHB strip
      [2, { kind: "card", cardIndex: 2, action: "show" }], // capno
    ]);
    let s = reduce(card01, ev);
    expect([s.ecgOverride, s.capnoOverride, s.ecgOn, s.capnoOn]).toEqual([5, 2, true, true]);
    s = reduce(card01, append(card01, ev, [{ kind: "stage", stageKey: "B" }], T0 + 3000));
    expect([s.ecgOverride, s.capnoOverride]).toEqual([null, null]);
  });
  it("revealing HR / EtCO2 turns the traces on; explicit display events win", () => {
    const ev = play([
      [1, { kind: "reveal", stageKey: "A", vital: "HR", value: "58" }],
      [2, { kind: "display", capno: true, view: "info" }],
      [3, { kind: "display", ecg: false }],
    ]);
    const s = reduce(card01, ev);
    expect([s.ecgOn, s.capnoOn, s.view, s.viewSeq]).toEqual([false, true, "info", 2]);
  });
  it("completion counts expected items", () => {
    const ids = card01.phases.flatMap((p) => p.expectedItems.map((i) => i.id));
    const s = reduce(card01, play([[1, ids.slice(0, 5).map((itemId) => ({ kind: "expected" as const, itemId, checked: true }))]]));
    expect(completion(card01, s)).toEqual({ done: 5, total: ids.length, pct: Math.round((500 / ids.length)) });
  });
});

describe("exports", () => {
  const rec = { ...newRecord(card01, "ab".repeat(32), "CARD-01_inferior_stemi.json"), trainee: "Pat Q, Jr.", evaluator: "E", result: "remediate" as const };
  rec.events = play([
    [0, { kind: "clock", action: "start" }],
    [30, branchBodies(card01, card01.phases[3].id, card01.phases[3].branchList[0].id)],
    [40, { kind: "critical", itemId: "crit2", status: "missed" }],
    [50, { kind: "note", text: 'said "nitro", then <b>dizzy</b>' }],
  ]);
  it("JSON run record round-trips and carries ids, hash and footer", () => {
    const r = parseRunFile(exportJson(rec));
    expect(r).toMatchObject({ format: "scenario-runner-run", formatVersion: 1, scenarioId: "CARD-01", scenarioHash: "ab".repeat(32), footer: FOOTER, result: "remediate" });
    expect(r.events).toHaveLength(rec.events.length);
    expect(r.exportedAt).toBeTruthy();
    expect(() => parseRunFile("{}")).toThrow();
  });
  it("CSV: metadata, header, one row per event, quoted cells", () => {
    const csv = exportCsv(card01, rec);
    const lines = csv.trim().split("\r\n");
    const hi = lines.indexOf(CSV_HEADER.join(","));
    expect(hi).toBeGreaterThan(0);
    expect(lines.length - hi - 1).toBe(rec.events.length);
    expect(csv).toContain('"Pat Q, Jr."');
    expect(csv).toContain('"Note: said ""nitro"", then <b>dizzy</b>"');
    expect(csv).toContain("MISSED (evaluator discretion)");
    expect(csv).toContain(FOOTER);
  });
  it("HTML summary is standalone, greyscale, escaped, has the footer and the discretion flag", () => {
    const html = summaryHtml(card01, rec);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(FOOTER.replace("&", "&amp;"));
    expect(html).toContain("FLAGGED FOR EVALUATOR DISCRETION");
    expect(html).toContain("Not an automatic fail");
    expect(html).not.toMatch(/critical fail/i);
    expect(html).toContain("&lt;b&gt;dizzy&lt;/b&gt;");
    expect(html).not.toMatch(/https?:\/\/(?!www\.openevidence\.com)/); // no external resources
    const colors = html.match(/#[0-9a-f]{3,6}\b/gi) ?? [];
    for (const c of colors) expect(["#000", "#fff", "#e0e0e0", "#f2f2f2", "#404040", "#8c8c8c"]).toContain(c.toLowerCase());
  });
});

describe("provider actions <-> expected items", () => {
  const med02 = normalize(readJson(join(SCENARIO_DIR, "MED-02_anaphylaxis.json")) as Scenario);
  const T = Date.parse("2026-11-21T10:00:00Z");
  const items = (sc: typeof med02) => sc.phases.flatMap((p) => p.expectedItems);
  it("logging an action ticks the first unchecked linked item, preferring the current phase; repeats tick the next", () => {
    const epi = items(med02).filter((i) => i.action === "epi_im").map((i) => i.id);
    expect(epi.length).toBe(2);
    let ev = append(med02, [], [{ kind: "action", actionId: "epi_im", values: { dose: "0.3 mg" } }], T);
    let s = reduce(med02, ev);
    expect(s.expected[epi[0]]).toMatchObject({ byAction: 1 });
    expect(s.expected[epi[1]]).toBeUndefined();
    ev = append(med02, ev, [{ kind: "action", actionId: "epi_im", values: {} }], T + 60_000);
    s = reduce(med02, ev);
    expect(s.expected[epi[1]]).toMatchObject({ byAction: 2 });
    expect(s.actions.map((a) => a.actionId)).toEqual(["epi_im", "epi_im"]);
    // a third dose is still logged (repeatable) even with no item left to tick
    ev = append(med02, ev, [{ kind: "action", actionId: "epi_im", values: {} }], T + 120_000);
    expect(reduce(med02, ev).actions).toHaveLength(3);
  });
  it("prefers the current phase", () => {
    const epi = items(med02).filter((i) => i.action === "epi_im");
    const later = med02.phases.find((p) => p.expectedItems.some((i) => i.id === epi[1].id))!;
    const ev = append(med02, [], [{ kind: "phase", phaseId: later.id }, { kind: "action", actionId: "epi_im", values: {} }], T);
    const s = reduce(med02, ev);
    expect(s.expected[epi[1].id]).toBeDefined();
    expect(s.expected[epi[0].id]).toBeUndefined();
  });
  it("match must fit (NRB-only item is not ticked by NC); itemId targets the tapped item", () => {
    const sc = normalize(readJson(join(SCENARIO_DIR, "TRA-03_anticoagulated_fall_tbi.json")) as Scenario);
    const nrb = items(sc).find((i) => i.action === "oxygen" && i.match?.device === "NRB")!;
    let ev = append(sc, [], [{ kind: "action", actionId: "oxygen", values: { device: "NC", rate: 4 } }], T);
    expect(reduce(sc, ev).expected[nrb.id]).toBeUndefined();
    ev = append(sc, ev, [{ kind: "action", actionId: "oxygen", values: { device: "NRB", rate: 15 } }], T + 1000);
    expect(reduce(sc, ev).expected[nrb.id]).toBeDefined();
    const roles = items(sc).find((i) => i.action === "roles")!;
    const ev2 = append(sc, [], [{ kind: "action", actionId: "roles", values: {}, itemId: roles.id }], T);
    expect(reduce(sc, ev2).expected[roles.id]).toMatchObject({ byAction: 1 });
  });
  it("undoing the action un-ticks the item it ticked", () => {
    const epi = items(med02).find((i) => i.action === "epi_im")!;
    let ev = append(med02, [], [{ kind: "action", actionId: "epi_im", values: {} }], T);
    ev = append(med02, ev, [{ kind: "undo", target: lastUndoable(ev)!.seq }], T + 1000);
    const s = reduce(med02, ev);
    expect(s.expected[epi.id]).toBeUndefined();
    expect(s.actions).toEqual([]);
  });
  it("exports carry the actions (JSON events, CSV rows, HTML table)", () => {
    const rec = { ...newRecord(med02, "cd".repeat(32), "MED-02_anaphylaxis.json") };
    rec.events = append(med02, [], [{ kind: "clock", action: "start" }, { kind: "action", actionId: "oxygen", values: { device: "NRB", rate: 15 } }], T);
    const json = parseRunFile(exportJson(rec));
    expect(json.events[1]).toMatchObject({ kind: "action", actionId: "oxygen", values: { device: "NRB", rate: 15 } });
    expect(exportCsv(med02, rec)).toContain("Action: Oxygen therapy (NRB, 15 L/min)");
    const html = summaryHtml(med02, rec);
    expect(html).toContain("Provider actions");
    expect(html).toContain("NRB, 15 L/min");
  });
});
