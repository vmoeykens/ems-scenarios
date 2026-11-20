// TypeScript port of capno_png()'s waveform in tools/ems_scenario.py: normal (square), shark (bronchospasm), cpr.
import type { CapnoPattern } from "../scenario/types.ts";

export const CAPNO_FS = 100;

export interface CapnoOptions {
  pattern?: CapnoPattern;
  etco2?: number;
  rr?: number;
  seconds?: number;
  fs?: number;
}

/** EtCO2 trace in mmHg. Breath starts at 0.5 s then every 60/rr s; expiration = half the cycle, 0.2 s downstroke. */
export function capno(o: CapnoOptions = {}): { t: Float64Array; y: Float64Array } {
  const pattern = o.pattern ?? "normal";
  const etco2 = o.etco2 ?? 38;
  const rr = o.rr ?? 14;
  const seconds = o.seconds ?? 16;
  const fs = o.fs ?? CAPNO_FS;
  const n = Math.round(seconds * fs);
  const t = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i / fs;
  if (rr <= 0) return { t, y };
  const per = 60 / Math.max(rr, 1);
  const exp = per * 0.5;
  for (let b = 0.5; b < seconds; b += per) {
    for (let i = 0; i < n; i++) {
      const ph = t[i] - b;
      if (ph >= 0 && ph < exp) {
        if (pattern === "shark") y[i] = etco2 * (1 - Math.exp(-ph / (exp * 0.45)));
        else if (pattern === "cpr")
          y[i] = etco2 * Math.min(Math.max(ph / 0.25, 0), 1) * (1 - (0.1 * ph) / exp) + 1.5 * Math.sin(2 * Math.PI * 1.8 * ph);
        else y[i] = etco2 * Math.min(Math.max(ph / 0.15, 0), 1) * (1 + (0.06 * ph) / exp);
      } else if (ph >= exp && ph < exp + 0.2) {
        y[i] = Math.max(y[i], etco2 * (1 - (ph - exp) / 0.2));
      }
    }
  }
  return { t, y };
}

/** One breath cycle (period 60/rr s) evaluated at phase ph seconds since breath start - used by the live sweep. */
export function capnoAt(pattern: CapnoPattern, etco2: number, rr: number, ph: number): number {
  if (rr <= 0) return 0;
  const per = 60 / Math.max(rr, 1);
  const exp = per * 0.5;
  ph = ((ph % per) + per) % per;
  if (ph < exp) {
    if (pattern === "shark") return etco2 * (1 - Math.exp(-ph / (exp * 0.45)));
    if (pattern === "cpr") return etco2 * Math.min(ph / 0.25, 1) * (1 - (0.1 * ph) / exp) + 1.5 * Math.sin(2 * Math.PI * 1.8 * ph);
    return etco2 * Math.min(ph / 0.15, 1) * (1 + (0.06 * ph) / exp);
  }
  if (ph < exp + 0.2) return Math.max(0, etco2 * (1 - (ph - exp) / 0.2));
  return 0;
}
