// Types for scenario JSON. Source of truth for the shape is schema/scenario.schema.json;
// keep these in sync with it (see tests/schema.test.ts).

export type Pair = [string, string];
export type CheckItem = string | { id: string; text: string };
/** Expected-action item: string, or object with optional id and a provider-action link (schema/actions.json). */
export type ExpectedItem = string | { id?: string; text: string; action?: string; match?: Record<string, string | number> };

export const VITAL_KEYS = ["HR", "BP", "RR", "SpO2", "EtCO2", "BGL", "Temp", "Pain", "GCS", "Pupils"] as const;
export type VitalKey = (typeof VITAL_KEYS)[number];

export type VitalsRow = {
  stage: string;
  key?: string;
  trigger?: string;
  other?: string;
  bold?: (VitalKey | "other")[];
  monitor?: Monitor;
} & Partial<Record<VitalKey, string | number>>;

export type CapnoPattern = "normal" | "shark" | "cpr";

/** Optional live-monitor settings per vitals stage (student display only; the PDF generator ignores it). */
export interface Monitor {
  rhythm: Rhythm;
  rate: number;
  /** atrial rate (chb) / flutter-wave rate (flutter) */
  p_rate?: number;
  /** lead II ST shift in mm (+ elevation) */
  st?: number;
  capno?: { pattern: CapnoPattern; etco2: number; rr: number };
}

export interface Branch {
  id?: string;
  type?: "inject";
  if: string;
  then: string;
  goto_stage?: string;
  goto_phase?: string;
}

export interface Phase {
  id?: string;
  time?: string;
  phase?: string;
  give?: string;
  expected: ExpectedItem[];
  branches?: Branch[];
}

export type Rhythm = "sinus" | "afib" | "svt" | "vt" | "vf" | "asystole" | "chb" | "avb1" | "flutter";
export type Lead = "I" | "II" | "III" | "aVR" | "aVL" | "aVF" | "V1" | "V2" | "V3" | "V4" | "V5" | "V6";
type CardBase = { title?: string; caption?: string; cue?: string; width?: "full" | "half" };
export type ShowCard =
  | (CardBase & { type: "12lead"; rhythm?: Rhythm; rate?: number; p_rate?: number; st?: Partial<Record<Lead, number>> })
  | (CardBase & { type: "strip"; rhythm?: Rhythm; rate?: number; p_rate?: number; lead?: Lead; st?: number; seconds?: number })
  | (CardBase & { type: "capno"; pattern?: CapnoPattern; etco2?: number; rr?: number })
  | (Omit<CardBase, "caption"> & { type: "text"; body?: string })
  | (CardBase & { type: "image"; path: string });

export interface MoulageTag {
  region: string;
  text: string;
  cue?: string;
}

export type LearnMore = { topic?: string; focus?: string } | { prompt: string };

export interface Scenario {
  id?: string;
  title: string;
  version?: string;
  category?: string;
  level?: string;
  run_time?: string;
  difficulty?: string;
  crew?: string;
  protocols?: string[];
  objectives?: string[];
  resources?: string;
  dispatch?: string;
  scene?: Record<string, string>;
  patient?: { name?: string; age?: string | number; sex?: string; weight_kg?: string | number; cc?: string; on_arrival?: string };
  history?: { SAMPLE?: Pair[]; OPQRST?: Pair[] };
  primary?: Pair[];
  secondary?: Pair[];
  vitals?: VitalsRow[];
  vitals_note?: string;
  blank_vitals_rows?: number;
  flow?: Phase[];
  critical?: CheckItem[];
  provider_actions?: string[];
  differentials?: [string, string, string][];
  debrief?: string[];
  crew_card?: { dispatch?: string; on_arrival?: string };
  actor_card?: Record<string, string>;
  show_cards?: ShowCard[];
  moulage_tags?: MoulageTag[];
  learn_more?: LearnMore;
}
