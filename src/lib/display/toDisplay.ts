// The ONLY place that builds what crosses to the student display (docs/PLAN.md section 9).
// Allowed: revealed vital values (markup stripped), waveform parameters, crew card, pushed card faces
// (title / caption / body + waveform params) and pushed moulage tags (region / text).
// Never: cue, stage names / triggers, `other`, branches, give/expected, critical, differentials, actor card,
// scenario id / title. tests/display.test.ts scans every scenario for leaks.
import type { NormalizedScenario } from "../scenario/normalize.ts";
import type { CapnoPattern, Lead, Monitor, Rhythm, ShowCard, VitalKey } from "../scenario/types.ts";
import { VITAL_KEYS } from "../scenario/types.ts";
import { stripMarkup } from "../scenario/text.ts";
import type { RunState } from "../run/reducer.ts";
import type { DisplayView, MonitorLayout } from "../run/types.ts";
import { plethAmplitude } from "../waveforms/pleth.ts";

export interface EcgParams {
  rhythm: Rhythm;
  rate: number;
  p_rate?: number;
  st?: number;
}
export interface PlethParams {
  rhythm: Rhythm;
  rate: number;
  /** 0..1 relative amplitude from the stage SBP */
  amp: number;
}
export interface CapnoParams {
  pattern: CapnoPattern;
  etco2: number;
  rr: number;
}

export type DisplayCard =
  | { key: string; kind: "text"; title: string; body: string }
  | { key: string; kind: "12lead"; title: string; caption: string; rhythm: Rhythm; rate: number; p_rate?: number; st: Partial<Record<Lead, number>> }
  | { key: string; kind: "strip"; title: string; caption: string; rhythm: Rhythm; rate: number; p_rate?: number; lead: Lead; st: number; seconds: number }
  | { key: string; kind: "capno"; title: string; caption: string; pattern: CapnoPattern; etco2: number; rr: number }
  | { key: string; kind: "image"; title: string; caption: string; src: string }
  | { key: string; kind: "tag"; title: string; body: string };

export interface DisplaySnapshot {
  v: 1;
  /** run id: lets the display drop state from an older run */
  run: string;
  view: DisplayView;
  viewSeq: number;
  vitals: Partial<Record<VitalKey, string>>;
  ecg: EcgParams | null;
  /** SpO2 pleth; null until SpO2 is given, or when the current stage has no perfusing pulse */
  pleth: PlethParams | null;
  /** ST shift (mm) per lead for the live 12-lead view: last pushed 12-lead card, else lead II from the monitor */
  leadSt: Partial<Record<Lead, number>>;
  layout: MonitorLayout;
  layoutSeq: number;
  capno: CapnoParams | null;
  crewCard: { dispatch: string; on_arrival: string };
  /** pushed show cards and moulage tags, newest first */
  cards: DisplayCard[];
}

export { stripMarkup };

const num = (x: unknown, d: number): number => (typeof x === "number" && Number.isFinite(x) ? x : d);

/** Image cards: only bundled assets (public/scenario-assets/...) or data: URIs can load in the browser. */
export function imageSrc(path: string): string {
  if (/^data:image\//.test(path)) return path;
  const name = path.replace(/^.*scenario-assets\//, "").replace(/^\.?\//, "");
  return `scenario-assets/${name}`;
}

export function cardFace(c: ShowCard, index: number): DisplayCard {
  const key = `c${index}`;
  const title = stripMarkup(c.title);
  switch (c.type) {
    case "text":
      return { key, kind: "text", title, body: String(c.body ?? "").replace(/\*\*/g, "") };
    case "12lead":
      return {
        key, kind: "12lead", title, caption: stripMarkup(c.caption), rhythm: c.rhythm ?? "sinus", rate: num(c.rate, 75),
        ...(c.p_rate !== undefined ? { p_rate: c.p_rate } : {}), st: { ...(c.st ?? {}) },
      };
    case "strip":
      return {
        key, kind: "strip", title, caption: stripMarkup(c.caption), rhythm: c.rhythm ?? "sinus", rate: num(c.rate, 75),
        ...(c.p_rate !== undefined ? { p_rate: c.p_rate } : {}), lead: c.lead ?? "II", st: num(c.st, 0),
        seconds: num(c.seconds, c.width === "half" ? 4 : 8),
      };
    case "capno":
      return { key, kind: "capno", title, caption: stripMarkup(c.caption), pattern: c.pattern ?? "normal", etco2: num(c.etco2, 38), rr: num(c.rr, 14) };
    case "image":
      return { key, kind: "image", title, caption: stripMarkup(c.caption), src: imageSrc(c.path) };
  }
}

function stageMonitor(sc: NormalizedScenario, stageKey: string | null): Monitor | undefined {
  return sc.stages.find((s) => s.key === stageKey)?.monitor;
}

export function toDisplay(sc: NormalizedScenario, s: RunState, runId: string): DisplaySnapshot {
  const cards = sc.source.show_cards ?? [];
  const tags = sc.source.moulage_tags ?? [];
  const vitals: Partial<Record<VitalKey, string>> = {};
  for (const k of VITAL_KEYS) {
    const r = s.latest[k];
    if (r) vitals[k] = stripMarkup(r.value);
  }

  const mon = stageMonitor(sc, s.stageKey);
  let ecg: EcgParams | null = null;
  if (s.ecgOn) {
    const oc = s.ecgOverride !== null ? cards[s.ecgOverride] : undefined;
    if (oc && oc.type === "strip")
      ecg = { rhythm: oc.rhythm ?? "sinus", rate: num(oc.rate, 75), ...(oc.p_rate !== undefined ? { p_rate: oc.p_rate } : {}), st: num(oc.st, 0) };
    else if (mon)
      ecg = { rhythm: mon.rhythm, rate: mon.rate, ...(mon.p_rate !== undefined ? { p_rate: mon.p_rate } : {}), ...(mon.st !== undefined ? { st: mon.st } : {}) };
  }
  let capno: CapnoParams | null = null;
  if (s.capnoOn) {
    const oc = s.capnoOverride !== null ? cards[s.capnoOverride] : undefined;
    if (oc && oc.type === "capno") capno = { pattern: oc.pattern ?? "normal", etco2: num(oc.etco2, 38), rr: num(oc.rr, 14) };
    else if (mon?.capno) capno = { pattern: mon.capno.pattern, etco2: mon.capno.etco2, rr: mon.capno.rr };
  }

  // Perfusion of the current stage: pulse = HR > 0 in the stage row and an organized rhythm; SBP from the stage
  // (walking back through earlier stages when the cell is "-" = unchanged).
  const stIdx = sc.stages.findIndex((x) => x.key === s.stageKey);
  const row = sc.stages[stIdx];
  const hrNum = Number.parseFloat(stripMarkup(row?.HR ?? ""));
  const rhythmNow = ecg?.rhythm ?? mon?.rhythm;
  const pulse = !!row && !(Number.isFinite(hrNum) && hrNum <= 0) && rhythmNow !== "vf" && rhythmNow !== "asystole" && (ecg?.rate ?? mon?.rate ?? 0) > 0;
  let sbp: number | null = null;
  for (let k = stIdx; k >= 0 && sbp === null; k--) {
    const m = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(stripMarkup(sc.stages[k]?.BP ?? ""));
    if (m) sbp = Number(m[1]);
  }
  if (!pulse) delete vitals.SpO2; // no pulse -> no SpO2 reading ("--"), like a real oximeter
  let pleth: PlethParams | null = null;
  const src = ecg ?? mon;
  if (s.plethOn && pulse && src && vitals.SpO2) pleth = { rhythm: src.rhythm, rate: src.rate, amp: Math.round(plethAmplitude(sbp) * 100) / 100 };

  const last12 = s.cards.map((c) => cards[c.cardIndex]).find((c) => c?.type === "12lead");
  const leadSt: Partial<Record<Lead, number>> =
    last12 && last12.type === "12lead" ? { ...(last12.st ?? {}) } : ecg?.st ? { II: ecg.st } : {};

  // Merge pushed cards and tags newest first.
  const pushed = [
    ...s.cards.filter((c) => cards[c.cardIndex]).map((c) => ({ seq: c.seq, card: cardFace(cards[c.cardIndex], c.cardIndex) })),
    ...s.tags
      .filter((x) => tags[x.tagIndex])
      .map((x) => ({
        seq: x.seq,
        card: { key: `t${x.tagIndex}`, kind: "tag", title: stripMarkup(tags[x.tagIndex].region), body: String(tags[x.tagIndex].text).replace(/\*\*/g, "") } as DisplayCard,
      })),
  ].sort((a, b) => b.seq - a.seq);

  const crew = sc.source.crew_card ?? {};
  return {
    v: 1,
    run: runId,
    view: s.view,
    viewSeq: s.viewSeq,
    vitals,
    ecg,
    pleth,
    capno,
    leadSt,
    layout: s.layout,
    layoutSeq: s.layoutSeq,
    crewCard: { dispatch: stripMarkup(crew.dispatch ?? sc.source.dispatch ?? ""), on_arrival: stripMarkup(crew.on_arrival ?? "") },
    cards: pushed.map((p) => p.card),
  };
}

/** Snapshot before any run exists (display opened first). */
export const EMPTY_SNAPSHOT: DisplaySnapshot = {
  v: 1, run: "", view: "monitor", viewSeq: 0, vitals: {}, ecg: null, pleth: null, capno: null, leadSt: {}, layout: "single", layoutSeq: 0,
  crewCard: { dispatch: "", on_arrival: "" }, cards: [],
};
