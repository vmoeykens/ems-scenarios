// Building events: seq / scenario-clock time / wall time, plus composite actions (branch tap).
import type { NormalizedScenario } from "../scenario/normalize.ts";
import { elapsed, reduce } from "./reducer.ts";
import type { RunEvent, RunEventBody, RunRecord } from "./types.ts";
import { APP_NAME, RUN_FORMAT } from "./types.ts";
import { FOOTER } from "../scenario/constants.ts";

export function stamp(sc: NormalizedScenario, events: readonly RunEvent[], body: RunEventBody, now = Date.now()): RunEvent {
  const seq = events.length ? events[events.length - 1].seq + 1 : 1;
  const clock = reduce(sc, events).clock;
  return { ...body, seq, t: Math.round(elapsed(clock, now)), wall: new Date(now).toISOString() } as RunEvent;
}

/** Append one or more bodies, each stamped in order. Returns the new event list. */
export function append(sc: NormalizedScenario, events: readonly RunEvent[], bodies: RunEventBody[], now = Date.now()): RunEvent[] {
  const out = [...events];
  for (const b of bodies) out.push(stamp(sc, out, b, now));
  return out;
}

/** Tap on a branch (crew IF->THEN or examiner inject): log it, then jump to goto_stage / goto_phase. No other auto-advance. */
export function branchBodies(sc: NormalizedScenario, phaseId: string, branchId: string): RunEventBody[] {
  const ph = sc.phases.find((p) => p.id === phaseId);
  const b = ph?.branchList.find((x) => x.id === branchId);
  if (!ph || !b) return [];
  const out: RunEventBody[] = [{ kind: "branch", phaseId, branchId, inject: b.type === "inject" }];
  // goto_stage only (explicit link). Branches without it stay text-only, as in the PDF flowchart.
  if (b.goto_stage) out.push({ kind: "stage", stageKey: b.goto_stage, via: b.id });
  if (b.goto_phase) out.push({ kind: "phase", phaseId: b.goto_phase });
  return out;
}

export function newRunId(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return r;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function newRecord(sc: NormalizedScenario, hash: string, source: string): RunRecord {
  return {
    format: RUN_FORMAT,
    formatVersion: 1,
    runId: newRunId(),
    scenarioId: sc.source.id ?? "",
    scenarioTitle: sc.source.title,
    scenarioVersion: sc.source.version ?? "",
    scenarioHash: hash,
    scenarioSource: source,
    trainee: "",
    evaluator: "",
    date: today(),
    result: null,
    events: [],
    app: APP_NAME,
    footer: FOOTER,
    createdAt: new Date().toISOString(),
  };
}
