// TypeScript port of the simulated ECG in tools/ems_scenario.py (ecg(), beat_times(), LEADS, ST model).
// Same rhythms, per-lead amplitudes, beat timing and ST-shift model. numpy's default_rng is replaced by a
// small seeded PRNG, so shapes match the PDF but individual noise samples do not.
import type { Lead, Rhythm } from "../scenario/types.ts";

/** R, S, T amplitude (mV), P amplitude - copied from LEADS in the generator. */
export const LEADS: Record<Lead, readonly [number, number, number, number]> = {
  I: [0.6, 0.1, 0.2, 0.1],
  II: [1.0, 0.1, 0.3, 0.15],
  III: [0.5, 0.15, 0.1, 0.07],
  aVR: [0.1, 0.6, -0.2, -0.1],
  aVL: [0.35, 0.2, 0.1, 0.05],
  aVF: [0.7, 0.1, 0.2, 0.1],
  V1: [0.15, 0.9, -0.05, 0.05],
  V2: [0.3, 1.1, 0.3, 0.07],
  V3: [0.6, 0.6, 0.4, 0.07],
  V4: [1.1, 0.3, 0.4, 0.08],
  V5: [1.2, 0.15, 0.35, 0.08],
  V6: [1.0, 0.1, 0.3, 0.08],
};

/** 12-lead print order (3 rows x 4 columns) + rhythm strip II, as twelve_png(). */
export const TWELVE_ORDER: Lead[][] = [
  ["I", "aVR", "V1", "V4"],
  ["II", "aVL", "V2", "V5"],
  ["III", "aVF", "V3", "V6"],
];

export const FS = 500; // samples per second

/** Seeded PRNG (mulberry32) with uniform + normal draws. */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  random(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }
  normal(mu: number, sd: number): number {
    const u = Math.max(this.random(), 1e-12);
    const v = this.random();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

const gauss = (t: number, mu: number, sd: number) => Math.exp(-((t - mu) ** 2) / (2 * sd ** 2));

/** Beat (R-wave) times in seconds. VF/asystole have none; afib is irregular. */
export function beatTimes(kind: Rhythm, rate: number, dur: number, rng: Rng): number[] {
  if (kind === "vf" || kind === "asystole") return [];
  const rr = 60 / Math.max(rate, 1);
  const out: number[] = [];
  if (kind === "afib") {
    for (let t = 0.3; t < dur; t += rr * rng.uniform(0.6, 1.45)) out.push(t);
    return out;
  }
  for (let t = 0.25; t < dur; t += rr) out.push(t);
  return out;
}

export interface EcgOptions {
  kind?: Rhythm;
  rate?: number;
  dur?: number;
  lead?: Lead;
  /** ST shift in mm (+ elevation) */
  stmm?: number;
  seed?: number;
  pr?: number;
  wide?: boolean;
  p_rate?: number;
  fs?: number;
}

/** Simulated ECG in mV, sampled at fs (default 500 Hz). Mirrors ecg() in the generator. */
export function ecg(o: EcgOptions = {}): { t: Float64Array; y: Float64Array } {
  const kind = o.kind ?? "sinus";
  const rate = o.rate ?? 75;
  const dur = o.dur ?? 10;
  const fs = o.fs ?? FS;
  const rng = new Rng(o.seed ?? 1);
  const n = Math.round(dur * fs);
  const t = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i / fs;
  const [R, Sa, T, Pa] = LEADS[o.lead ?? "II"] ?? LEADS.II;
  const stv = (o.stmm ?? 0) / 10;
  const wide = o.wide || kind === "vt";

  if (kind === "vf") {
    const comps = [
      [4.1, 0.25],
      [5.3, 0.2],
      [6.7, 0.12],
      [3.2, 0.15],
    ].map(([f, a]) => [f, a, rng.uniform(0, 6), rng.uniform(0, 6)]);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const [f, a, p1, p2] of comps) v += a * Math.sin(2 * Math.PI * f * t[i] + p1) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.3 * t[i] + p2));
      y[i] = v + rng.normal(0, 0.01);
    }
    return { t, y };
  }
  if (kind === "asystole") {
    for (let i = 0; i < n; i++) y[i] = 0.03 * Math.sin(2 * Math.PI * 0.2 * t[i]) + rng.normal(0, 0.006);
    return { t, y };
  }

  const beats = beatTimes(kind, rate, dur, rng);
  const pr = (o.pr ?? 0.16) * (kind === "avb1" ? 1.9 : 1);
  const showP = kind === "sinus" || kind === "avb1";
  const qw = wide ? (kind === "vt" ? 0.045 : 0.03) : 0.009;
  // Only evaluate each beat within +-0.6 s (all components are negligible beyond that).
  for (const b of beats) {
    const i0 = Math.max(0, Math.floor((b - 0.6) * fs));
    const i1 = Math.min(n, Math.ceil((b + 0.7) * fs));
    for (let i = i0; i < i1; i++) {
      const x = t[i];
      let v = 0;
      if (showP) v += Pa * gauss(x, b - pr, 0.022);
      if (!wide) v += -0.08 * R * gauss(x, b - 0.018, 0.006);
      if (wide) {
        v += (R * 0.9 + 0.4) * gauss(x, b, qw) - (Sa + 0.5) * gauss(x, b + 0.07, 0.03);
        v += -0.35 * Math.sign(R - Sa + 1e-6) * gauss(x, b + 0.22, 0.06);
      } else {
        v += (R + (stv > 0.05 ? 0.15 : 0)) * gauss(x, b, qw) - Sa * gauss(x, b + 0.022, 0.008);
        // ST segment (logistic window b+35 ms .. b+300 ms) + T wave
        const win = (1 / (1 + Math.exp(-(x - (b + 0.035)) / 0.004))) * (1 / (1 + Math.exp((x - (b + 0.3)) / 0.03)));
        v += stv * win;
        v += (T + 0.6 * stv) * gauss(x, b + 0.26, 0.045);
      }
      y[i] += v;
    }
  }
  if (kind === "chb") {
    const pp = 60 / (o.p_rate || 80);
    for (let p = 0.1; p < dur; p += pp) {
      const i0 = Math.max(0, Math.floor((p - 0.15) * fs));
      const i1 = Math.min(n, Math.ceil((p + 0.15) * fs));
      for (let i = i0; i < i1; i++) y[i] += Pa * gauss(t[i], p, 0.022);
    }
  }
  if (kind === "afib")
    for (let i = 0; i < n; i++)
      y[i] += 0.04 * Math.sin(2 * Math.PI * 6.5 * t[i]) + 0.025 * Math.sin(2 * Math.PI * 8.3 * t[i] + 1) + rng.normal(0, 0.012);
  if (kind === "flutter") {
    const fr = (o.p_rate || 300) / 60;
    for (let i = 0; i < n; i++) y[i] += 0.18 * (2 * ((t[i] * fr) % 1) - 1);
  }
  for (let i = 0; i < n; i++) y[i] += rng.normal(0, 0.005);
  return { t, y };
}
