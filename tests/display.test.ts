// toDisplay() is the only thing that crosses to the student display. Scripted "everything" run over every
// scenario: no instructor-only text may appear in any snapshot.
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { append, branchBodies } from "../src/lib/run/actions.ts";
import { reduce } from "../src/lib/run/reducer.ts";
import type { RunEvent, RunEventBody } from "../src/lib/run/types.ts";
import { toDisplay, type DisplaySnapshot } from "../src/lib/display/toDisplay.ts";
import { normalize, type NormalizedScenario } from "../src/lib/scenario/normalize.ts";
import { stripMarkup } from "../src/lib/scenario/text.ts";
import { VITAL_KEYS, type Scenario } from "../src/lib/scenario/types.ts";
import { readJson, scenarioFiles } from "./helpers.ts";

/** Every instructor-only string in a scenario. */
function instructorOnly(sc: Scenario): string[] {
  const out: unknown[] = [sc.title, sc.id, sc.vitals_note, sc.resources, ...(sc.objectives ?? []), ...(sc.debrief ?? [])];
  for (const c of sc.show_cards ?? []) out.push(c.cue);
  for (const t of sc.moulage_tags ?? []) out.push(t.cue);
  for (const v of sc.vitals ?? []) out.push(v.stage, v.trigger, v.other);
  for (const p of sc.flow ?? []) {
    out.push(p.phase, p.give, ...p.expected.map((e) => (typeof e === "string" ? e : e.text)));
    for (const b of p.branches ?? []) out.push(b.if, b.then);
  }
  for (const c of sc.critical ?? []) out.push(typeof c === "string" ? c : c.text);
  for (const d of sc.differentials ?? []) out.push(...d);
  // Actor card is instructor/actor-only. Scene, history and exam findings are not listed: the crew learns them
  // (and the same findings legitimately appear on moulage tags).
  out.push(...Object.values(sc.actor_card ?? {}));
  return [...new Set(out.filter((x): x is string => typeof x === "string").map((x) => stripMarkup(x).toLowerCase()))].filter((x) => x.length >= 16 || x.split(" ").length >= 3); // 1-2 word labels ("Bathroom", "Reassess") can coincide with card titles
}

/** Do everything an instructor can do, collecting a snapshot after each step. */
function scriptedRun(sc: NormalizedScenario): DisplaySnapshot[] {
  const snaps: DisplaySnapshot[] = [];
  let ev: RunEvent[] = [];
  let now = Date.parse("2026-11-20T10:00:00Z");
  const step = (...b: RunEventBody[]) => {
    ev = append(sc, ev, b, (now += 1000));
    snaps.push(toDisplay(sc, reduce(sc, ev), "run-1"));
  };
  step({ kind: "clock", action: "start" });
  for (const st of sc.stages) {
    step({ kind: "stage", stageKey: st.key });
    for (const k of VITAL_KEYS) if (st[k] !== undefined) step({ kind: "reveal", stageKey: st.key, vital: k, value: String(st[k]) });
  }
  (sc.source.show_cards ?? []).forEach((_, i) => step({ kind: "card", cardIndex: i, action: "show" }, { kind: "display", view: "info" }));
  (sc.source.moulage_tags ?? []).forEach((_, i) => step({ kind: "tag", tagIndex: i, action: "show" }));
  for (const p of sc.phases) {
    step({ kind: "phase", phaseId: p.id });
    for (const it of p.expectedItems) step({ kind: "expected", itemId: it.id, checked: true });
    for (const b of p.branchList) step(...branchBodies(sc, p.id, b.id));
  }
  for (const c of sc.critical) step({ kind: "critical", itemId: c.id, status: "missed" });
  step({ kind: "note", text: "instructor note: crew missed the nitrate trap" });
  return snaps;
}

const files = scenarioFiles();

describe("toDisplay leak test", () => {
  it.each(files.map((f) => [basename(f), f]))("%s: no instructor-only text in any snapshot", (_n, f) => {
    const raw = readJson(f) as Scenario;
    const sc = normalize(raw);
    const secrets = instructorOnly(raw);
    const snaps = scriptedRun(sc);
    expect(snaps.length).toBeGreaterThan(20);
    for (const snap of snaps) {
      const text = JSON.stringify(snap).toLowerCase();
      for (const s of secrets) expect(text.includes(s), `leaked: "${s}"`).toBe(false);
      expect(text).not.toContain("instructor note");
      expect(text).not.toContain('"cue"');
      // remote display relays every snapshot through a broker (Supabase Realtime broadcast): keep it small
      expect(new TextEncoder().encode(JSON.stringify(snap)).length, "snapshot too large for the broker").toBeLessThan(64 * 1024);
    }
    // the final snapshot really did carry crew-facing content (so the test is not vacuous)
    const last = snaps[snaps.length - 1];
    expect(last.cards.length).toBe((raw.show_cards?.length ?? 0) + (raw.moulage_tags?.length ?? 0));
    expect(Object.keys(last.vitals).length).toBeGreaterThan(3);
    expect(last.crewCard.dispatch.length).toBeGreaterThan(10);
  });

  it("snapshot has only the documented keys", () => {
    const sc = normalize(readJson(files[0]) as Scenario);
    const snap = scriptedRun(sc).at(-1)!;
    expect(Object.keys(snap).sort()).toEqual(["capno", "cards", "crewCard", "ecg", "layout", "layoutSeq", "leadSt", "pleth", "run", "v", "view", "viewSeq", "vitals"]);
    for (const c of snap.cards) for (const k of Object.keys(c)) expect(["key", "kind", "title", "caption", "body", "rhythm", "rate", "p_rate", "st", "lead", "seconds", "pattern", "etco2", "rr", "src"]).toContain(k);
  });
});

describe("display monitor follows the stage", () => {
  const sc = normalize(readJson(files.find((f) => f.includes("CARD-01"))!) as Scenario);
  const T = Date.parse("2026-11-20T10:00:00Z");
  it("no traces until HR / EtCO2 are given; then the current stage's monitor; strip card overrides until stage changes", () => {
    let ev = append(sc, [], [{ kind: "stage", stageKey: "C" }], T);
    let d = toDisplay(sc, reduce(sc, ev), "r");
    expect([d.ecg, d.capno, d.vitals]).toEqual([null, null, {}]);
    ev = append(sc, ev, [{ kind: "reveal", stageKey: "C", vital: "HR", value: "50" }, { kind: "reveal", stageKey: "C", vital: "EtCO2", value: "32" }], T + 1000);
    d = toDisplay(sc, reduce(sc, ev), "r");
    expect(d.ecg).toEqual({ rhythm: "sinus", rate: 50, st: 2.5 });
    expect(d.capno).toEqual({ pattern: "normal", etco2: 32, rr: 20 });
    expect(d.vitals).toEqual({ HR: "50", EtCO2: "32" });
    ev = append(sc, ev, [{ kind: "card", cardIndex: 5, action: "show" }], T + 2000);
    d = toDisplay(sc, reduce(sc, ev), "r");
    expect(d.ecg).toEqual({ rhythm: "chb", rate: 38, p_rate: 80, st: 0 });
    expect(d.cards[0]).toMatchObject({ kind: "strip", rhythm: "chb" });
    ev = append(sc, ev, [{ kind: "stage", stageKey: "F" }], T + 3000);
    d = toDisplay(sc, reduce(sc, ev), "r");
    expect(d.ecg).toEqual({ rhythm: "sinus", rate: 46, st: 2.5 });
    expect(d.vitals.HR).toBe("50"); // last value given stays until the crew re-checks
    expect(d.cards).toHaveLength(1); // pushed cards persist
  });
  it("bold markup never reaches the display", () => {
    const ev = append(sc, [], [{ kind: "reveal", stageKey: "F", vital: "BP", value: "**74/44**" }], T);
    expect(toDisplay(sc, reduce(sc, ev), "r").vitals.BP).toBe("74/44");
  });
});

describe("every bundled scenario stage has a monitor block", () => {
  it.each(files.map((f) => [basename(f), f]))("%s", (_n, f) => {
    const sc = readJson(f) as Scenario;
    for (const v of sc.vitals ?? []) {
      expect(v.monitor, v.stage).toBeDefined();
      const hr = Number(String(v.HR).replace(/\*/g, "").split(" ")[0]);
      if (v.monitor!.rhythm === "vf" || v.monitor!.rhythm === "asystole") expect(v.monitor!.rate).toBe(0);
      else if (hr > 0) expect(v.monitor!.rate, v.stage).toBe(hr);
    }
  });
});

describe("SpO2 pleth + 12-lead on the display", () => {
  const T = Date.parse("2026-11-20T10:00:00Z");
  const load = (id: string) => normalize(readJson(files.find((f) => f.includes(id))!) as Scenario);
  it("pleth only after SpO2 is given; amplitude from stage SBP; follows the ECG rhythm", () => {
    const sc = load("CARD-01");
    let ev = append(sc, [], [{ kind: "reveal", stageKey: "A", vital: "HR", value: "58" }], T);
    expect(toDisplay(sc, reduce(sc, ev), "r").pleth).toBeNull();
    ev = append(sc, ev, [{ kind: "reveal", stageKey: "A", vital: "SpO2", value: "95% RA" }], T + 1000);
    const a = toDisplay(sc, reduce(sc, ev), "r").pleth!;
    expect(a).toMatchObject({ rhythm: "sinus", rate: 58 });
    ev = append(sc, ev, [{ kind: "stage", stageKey: "F" }], T + 2000); // BP 74/44
    const f = toDisplay(sc, reduce(sc, ev), "r").pleth!;
    expect(f.amp).toBeLessThan(a.amp);
    expect(f.rate).toBe(46);
    ev = append(sc, ev, [{ kind: "display", pleth: false }], T + 3000);
    expect(toDisplay(sc, reduce(sc, ev), "r").pleth).toBeNull();
  });
  it("no pulse (VF, asystole, PEA with HR 0) -> no pleth and SpO2 shows --", () => {
    const sc = load("ARR-01");
    const ev = append(sc, [], [{ kind: "stage", stageKey: "D" }, { kind: "reveal", stageKey: "D", vital: "SpO2", value: "92%" }, { kind: "stage", stageKey: "A" }], T);
    const d = toDisplay(sc, reduce(sc, ev), "r");
    expect(d.pleth).toBeNull();
    expect(d.vitals.SpO2).toBeUndefined();
    const pea = load("ARR-03"); // stage A: organized rhythm on the monitor, HR 0
    const e2 = append(pea, [], [{ kind: "reveal", stageKey: "A", vital: "HR", value: "0" }, { kind: "display", pleth: true }], T);
    expect(toDisplay(pea, reduce(pea, e2), "r").pleth).toBeNull();
  });
  it("12-lead layout is an instructor-controlled display event; ST from the last pushed 12-lead card", () => {
    const sc = load("CARD-01");
    let ev = append(sc, [], [{ kind: "reveal", stageKey: "A", vital: "HR", value: "58" }, { kind: "display", layout: "12lead" }], T);
    let d = toDisplay(sc, reduce(sc, ev), "r");
    expect([d.layout, d.layoutSeq > 0]).toEqual(["12lead", true]);
    expect(d.leadSt).toEqual({ II: 2.5 }); // stage monitor.st only
    ev = append(sc, ev, [{ kind: "card", cardIndex: 0, action: "show" }], T + 1000);
    d = toDisplay(sc, reduce(sc, ev), "r");
    expect(d.leadSt).toMatchObject({ II: 2.5, III: 3.5, aVF: 3, aVL: -2 });
  });
});
