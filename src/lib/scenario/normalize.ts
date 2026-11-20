// Default keys/ids the app derives when the optional Scenario Runner fields are absent.
// Must agree with tools/ems_scenario.py validate() (stage letter + flow id defaults).
import type { Branch, CheckItem, Phase, Scenario, VitalsRow } from "./types.ts";

/** Stage letter: vitals[].key, else first char of stage, upper-cased. Mirrors Python `str(v.get("key") or str(v.get("stage","?"))[:1]).upper()`. */
export function stageKey(row: Partial<VitalsRow>): string {
  const k = row.key || String(row.stage ?? "?").slice(0, 1);
  return String(k).toUpperCase();
}

/** Flow id: flow[].id, else p<index>. */
export function phaseId(ph: Partial<Phase>, index: number): string {
  return String(ph.id || `p${index}`);
}

export function itemText(i: CheckItem): string {
  return typeof i === "string" ? i : i.text;
}

/** Item id: own id, else <scope>.<index> (e.g. "p2.e0", "crit3"). */
export function itemId(i: CheckItem, fallback: string): string {
  return typeof i === "string" ? fallback : i.id;
}

export const STAGE_REF = /Stage \*\*([A-Z])\*\*|Stage ([A-Z])\b/g;

/** All `Stage X` / `Stage **X**` letters in a THEN text, in order (Python re.findall semantics). */
export function stageRefs(text: string): string[] {
  return [...text.matchAll(STAGE_REF)].map((m) => m[1] || m[2]);
}

/** Branch target stage: goto_stage, else first Stage ref in THEN text (what the PDF flowchart shows). */
export function branchStage(b: Branch): string | undefined {
  return b.goto_stage ?? stageRefs(b.then)[0];
}

export interface NormalizedPhase extends Phase {
  id: string;
  index: number;
  expectedItems: { id: string; text: string }[];
  branchList: (Branch & { id: string; target_stage?: string })[];
}

export interface NormalizedScenario {
  source: Scenario;
  stages: (VitalsRow & { key: string })[];
  phases: NormalizedPhase[];
  critical: { id: string; text: string }[];
}

/** Derive every id/key the runner needs; does not mutate the input. Assumes the scenario validated. */
export function normalize(sc: Scenario): NormalizedScenario {
  const stages = (sc.vitals ?? []).map((v) => ({ ...v, key: stageKey(v) }));
  const phases = (sc.flow ?? []).map((ph, i) => {
    const id = phaseId(ph, i);
    return {
      ...ph,
      id,
      index: i,
      expectedItems: ph.expected.map((e, j) => ({ id: itemId(e, `${id}.e${j}`), text: itemText(e) })),
      branchList: (ph.branches ?? []).map((b, j) => ({ ...b, id: b.id || `${id}.b${j}`, target_stage: branchStage(b) })),
    };
  });
  const critical = (sc.critical ?? []).map((c, i) => ({ id: itemId(c, `crit${i}`), text: itemText(c) }));
  return { source: sc, stages, phases, critical };
}
