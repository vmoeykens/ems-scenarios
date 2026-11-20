// Simulated SpO2 plethysmograph, beat-synced to the ECG: one pulse per QRS (same beat times as ecg() with the same
// seed), arriving after a pulse-transit delay, with a systolic peak, dicrotic notch and diastolic wave. Amplitude
// follows perfusion (SBP); no pulse (VF / asystole / PEA / rate 0) = flat line with sensor noise.
import type { Rhythm } from "../scenario/types.ts";
import { beatTimes, Rng } from "./ecg.ts";

export const PLETH_FS = 125;
/** QRS -> finger pulse arrival (pulse transit time), seconds */
export const PULSE_DELAY = 0.22;

export interface PlethOptions {
  rhythm?: Rhythm;
  rate?: number;
  /** false = no perfusing pulse (PEA etc.) */
  pulse?: boolean;
  /** 0..1 relative amplitude (perfusion) */
  amp?: number;
  dur?: number;
  fs?: number;
  /** same seed as the ECG -> same beat times (afib) */
  seed?: number;
  /** explicit beat times (overrides rhythm/rate/seed) */
  beats?: number[];
}

/** Relative pleth amplitude from systolic BP: 120+ -> 1, 85 -> 0.5, <= 58 -> floor 0.12. */
export function plethAmplitude(sbp: number | null | undefined): number {
  if (sbp === null || sbp === undefined || !Number.isFinite(sbp)) return 1;
  return Math.min(1, Math.max(0.12, (sbp - 50) / 70));
}

/** One pulse, tau seconds after arrival: upstroke + systolic peak, dicrotic notch, diastolic wave, runoff. */
export function pulseShape(tau: number): number {
  if (tau < -0.05 || tau > 1.2) return 0;
  const sys = Math.exp(-((tau - 0.13) ** 2) / (2 * 0.055 ** 2));
  const dia = 0.42 * Math.exp(-((tau - 0.36) ** 2) / (2 * 0.075 ** 2));
  const runoff = tau > 0.13 ? 0.25 * Math.exp(-(tau - 0.13) / 0.35) : 0.25 * sys;
  return sys + dia + runoff * 0.6;
}

export function pleth(o: PlethOptions = {}): { t: Float64Array; y: Float64Array; beats: number[] } {
  const dur = o.dur ?? 10;
  const fs = o.fs ?? PLETH_FS;
  const n = Math.round(dur * fs);
  const t = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i / fs;
  const noise = new Rng(((o.seed ?? 1) * 7919) >>> 0);
  const rhythm = o.rhythm ?? "sinus";
  const rate = o.rate ?? 75;
  const pulse = o.pulse !== false && rate > 0 && rhythm !== "vf" && rhythm !== "asystole";
  if (!pulse) {
    for (let i = 0; i < n; i++) y[i] = noise.normal(0, 0.012);
    return { t, y, beats: [] };
  }
  const beats = o.beats ?? beatTimes(rhythm, rate, dur, new Rng(o.seed ?? 1));
  const amp = Math.min(1, Math.max(0, o.amp ?? 1));
  for (let k = 0; k < beats.length; k++) {
    // afib: short preceding R-R = less filling = smaller pulse (pulse deficit)
    const rr = k > 0 ? beats[k] - beats[k - 1] : 60 / rate;
    const fill = rhythm === "afib" ? Math.min(1, Math.max(0.35, rr / (60 / rate))) : 1;
    const a = amp * fill;
    const arrive = beats[k] + PULSE_DELAY;
    // loop wrap: also draw the pulse that started near the end, at the start of the buffer
    for (const off of [0, -dur]) {
      const i0 = Math.max(0, Math.floor((arrive + off - 0.05) * fs));
      const i1 = Math.min(n, Math.ceil((arrive + off + 1.2) * fs));
      for (let i = i0; i < i1; i++) y[i] += a * pulseShape(t[i] - arrive - off);
    }
  }
  for (let i = 0; i < n; i++) y[i] += noise.normal(0, 0.006);
  return { t, y, beats };
}
