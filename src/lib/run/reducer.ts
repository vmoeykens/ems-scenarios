// reduce(events) -> RunState. Pure; the whole UI and the student display derive from this.
import type { NormalizedScenario } from "../scenario/normalize.ts";
import type { VitalKey } from "../scenario/types.ts";
import { matchesLink, type ActionValues } from "../actions/catalog.ts";
import type { DisplayView, HistorySection, MonitorLayout, RunEvent } from "./types.ts";

export interface Stamp {
  t: number;
  seq: number;
}
export interface Revealed extends Stamp {
  value: string;
  stageKey: string;
  adlib: boolean;
}

export interface ClockState {
  running: boolean;
  started: boolean;
  /** ms accumulated before the current running segment */
  accMs: number;
  /** wall ms when the current running segment began */
  segStartWall: number | null;
}

export interface RunState {
  clock: ClockState;
  phaseId: string | null;
  stageKey: string | null;
  stageVia: string | null;
  branches: (Stamp & { branchId: string; phaseId: string; inject: boolean })[];
  /** checked expected items; byAction = seq of the provider-action event that ticked it (synced, not tapped) */
  expected: Record<string, Stamp & { byAction?: number }>;
  /** logged provider actions, in order */
  actions: (Stamp & { actionId: string; values: ActionValues; itemId?: string })[];
  /** per stage, per vital */
  revealed: Record<string, Partial<Record<VitalKey, Revealed>>>;
  /** most recent revealed value per vital (what the display shows) */
  latest: Partial<Record<VitalKey, Revealed>>;
  history: Record<string, Stamp>; // `${section}:${index}`
  /** currently pushed cards / tags, newest first */
  cards: (Stamp & { cardIndex: number })[];
  tags: (Stamp & { tagIndex: number })[];
  setup: Record<number, Stamp>;
  critical: Record<string, Stamp & { status: "met" | "missed" }>;
  notes: (Stamp & { text: string; quick: boolean })[];
  view: DisplayView;
  /** bumps on every explicit view change so the display can follow it */
  viewSeq: number;
  ecgOn: boolean;
  capnoOn: boolean;
  /** SpO2 pleth trace (auto-on when SpO2 is given) */
  plethOn: boolean;
  layout: MonitorLayout;
  /** bumps on every explicit layout change so the display can follow it */
  layoutSeq: number;
  /** strip / capno card currently overriding the stage monitor (cleared on stage change) */
  ecgOverride: number | null;
  capnoOverride: number | null;
  undone: Set<number>;
  /** events that are in effect (not undone, not undo markers) */
  effective: RunEvent[];
}

export const historyKey = (section: HistorySection, index: number) => `${section}:${index}`;

export function initialState(sc: NormalizedScenario): RunState {
  return {
    clock: { running: false, started: false, accMs: 0, segStartWall: null },
    phaseId: sc.phases[0]?.id ?? null,
    stageKey: sc.stages[0]?.key ?? null,
    stageVia: null,
    branches: [],
    expected: {},
    actions: [],
    revealed: {},
    latest: {},
    history: {},
    cards: [],
    tags: [],
    setup: {},
    critical: {},
    notes: [],
    view: "monitor",
    viewSeq: 0,
    ecgOn: false,
    capnoOn: false,
    plethOn: false,
    layout: "single",
    layoutSeq: 0,
    ecgOverride: null,
    capnoOverride: null,
    undone: new Set(),
    effective: [],
  };
}

/** Clock events are not undoable (time keeps its meaning); undo markers themselves are not undoable either. */
export const isUndoable = (e: RunEvent) => e.kind !== "clock" && e.kind !== "undo";

export function reduce(sc: NormalizedScenario, events: readonly RunEvent[]): RunState {
  const s = initialState(sc);
  for (const e of events) if (e.kind === "undo") s.undone.add(e.target);
  const cardsJson = sc.source.show_cards ?? [];
  for (const e of events) {
    if (e.kind === "undo" || s.undone.has(e.seq)) continue;
    s.effective.push(e);
    const st: Stamp = { t: e.t, seq: e.seq };
    switch (e.kind) {
      case "clock": {
        const wall = Date.parse(e.wall);
        const c = s.clock;
        if ((e.action === "start" || e.action === "resume") && !c.running) {
          c.running = true;
          c.started = true;
          c.segStartWall = wall;
        } else if (e.action === "pause" && c.running) {
          c.accMs += wall - (c.segStartWall ?? wall);
          c.running = false;
          c.segStartWall = null;
        } else if (e.action === "reset") {
          s.clock = { running: false, started: false, accMs: 0, segStartWall: null };
        }
        break;
      }
      case "phase":
        s.phaseId = e.phaseId;
        break;
      case "stage":
        s.stageKey = e.stageKey;
        s.stageVia = e.via ?? null;
        s.ecgOverride = null;
        s.capnoOverride = null;
        break;
      case "branch":
        s.branches.push({ ...st, branchId: e.branchId, phaseId: e.phaseId, inject: e.inject });
        break;
      case "expected":
        if (e.checked) s.expected[e.itemId] = st;
        else delete s.expected[e.itemId];
        break;
      case "action": {
        s.actions.push({ ...st, actionId: e.actionId, values: e.values ?? {}, ...(e.itemId ? { itemId: e.itemId } : {}) });
        const target = linkedItemFor(sc, s, e.actionId, e.values ?? {}, e.itemId);
        if (target) s.expected[target] = { ...st, byAction: e.seq };
        break;
      }
      case "reveal": {
        const r: Revealed = { ...st, value: e.value, stageKey: e.stageKey, adlib: !!e.adlib };
        (s.revealed[e.stageKey] ??= {})[e.vital] = r;
        s.latest[e.vital] = r;
        if (e.vital === "HR") s.ecgOn = true;
        if (e.vital === "EtCO2") s.capnoOn = true;
        if (e.vital === "SpO2") s.plethOn = true;
        break;
      }
      case "history": {
        const k = historyKey(e.section, e.index);
        if (e.done) s.history[k] = st;
        else delete s.history[k];
        break;
      }
      case "card": {
        s.cards = s.cards.filter((c) => c.cardIndex !== e.cardIndex);
        const type = cardsJson[e.cardIndex]?.type;
        if (e.action === "show") {
          s.cards.unshift({ ...st, cardIndex: e.cardIndex });
          if (type === "strip") {
            s.ecgOverride = e.cardIndex;
            s.ecgOn = true;
          }
          if (type === "capno") {
            s.capnoOverride = e.cardIndex;
            s.capnoOn = true;
          }
        } else {
          if (s.ecgOverride === e.cardIndex) s.ecgOverride = null;
          if (s.capnoOverride === e.cardIndex) s.capnoOverride = null;
        }
        break;
      }
      case "tag":
        s.tags = s.tags.filter((x) => x.tagIndex !== e.tagIndex);
        if (e.action === "show") s.tags.unshift({ ...st, tagIndex: e.tagIndex });
        break;
      case "setup":
        if (e.done) s.setup[e.tagIndex] = st;
        else delete s.setup[e.tagIndex];
        break;
      case "critical":
        if (e.status) s.critical[e.itemId] = { ...st, status: e.status };
        else delete s.critical[e.itemId];
        break;
      case "note":
        s.notes.push({ ...st, text: e.text, quick: !!e.quick });
        break;
      case "display":
        if (e.view) {
          s.view = e.view;
          s.viewSeq = e.seq;
        }
        if (e.ecg !== undefined) s.ecgOn = e.ecg;
        if (e.capno !== undefined) s.capnoOn = e.capno;
        if (e.pleth !== undefined) s.plethOn = e.pleth;
        if (e.layout) {
          s.layout = e.layout;
          s.layoutSeq = e.seq;
        }
        break;
    }
  }
  return s;
}

/**
 * Expected item a logged provider action ticks: the item it was logged from (if still unchecked), else the first
 * unchecked item whose link (action id + match) fits, preferring the current phase, then flow order.
 */
export function linkedItemFor(sc: NormalizedScenario, s: RunState, actionId: string, values: ActionValues, itemId?: string): string | undefined {
  const items = sc.phases.flatMap((p) => p.expectedItems.map((it) => ({ ...it, phaseId: p.id })));
  if (itemId) {
    const it = items.find((x) => x.id === itemId);
    if (it && !s.expected[it.id]) return it.id;
  }
  const fits = items.filter((it) => it.action && !s.expected[it.id] && matchesLink({ action: it.action, match: it.match }, actionId, values));
  return (fits.find((it) => it.phaseId === s.phaseId) ?? fits[0])?.id;
}

/** Elapsed scenario-clock ms at wall time `now`. */
export function elapsed(c: ClockState, now = Date.now()): number {
  return c.accMs + (c.running && c.segStartWall !== null ? Math.max(0, now - c.segStartWall) : 0);
}

/** The most recent event that "Undo" would cancel. */
export function lastUndoable(events: readonly RunEvent[]): RunEvent | undefined {
  const undone = new Set(events.filter((e) => e.kind === "undo").map((e) => (e as { target: number }).target));
  for (let i = events.length - 1; i >= 0; i--) if (isUndoable(events[i]) && !undone.has(events[i].seq)) return events[i];
  return undefined;
}

export function fmtT(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Checklist completion over all phases' expected items. */
export function completion(sc: NormalizedScenario, s: RunState): { done: number; total: number; pct: number } {
  const ids = sc.phases.flatMap((p) => p.expectedItems.map((i) => i.id));
  const done = ids.filter((id) => s.expected[id]).length;
  return { done, total: ids.length, pct: ids.length ? Math.round((100 * done) / ids.length) : 0 };
}
