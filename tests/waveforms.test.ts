import { describe, expect, it } from "vitest";
import { beatTimes, ecg, FS, LEADS, Rng, TWELVE_ORDER } from "../src/lib/waveforms/ecg.ts";
import { capno, capnoAt } from "../src/lib/waveforms/capno.ts";
import { pleth, plethAmplitude, PLETH_FS, PULSE_DELAY } from "../src/lib/waveforms/pleth.ts";
import type { Rhythm } from "../src/lib/scenario/types.ts";

const RHYTHMS: Rhythm[] = ["sinus", "afib", "svt", "vt", "vf", "asystole", "chb", "avb1", "flutter"];
const max = (a: ArrayLike<number>) => Math.max(...Array.from(a));
const min = (a: ArrayLike<number>) => Math.min(...Array.from(a));

describe("ecg()", () => {
  it.each(RHYTHMS)("%s: length = dur*500, finite", (k) => {
    const { t, y } = ecg({ kind: k, rate: 80, dur: 10, p_rate: k === "flutter" ? 300 : 80 });
    expect(t.length).toBe(10 * FS);
    expect(y.length).toBe(10 * FS);
    expect(Array.from(y).every(Number.isFinite)).toBe(true);
  });
  it("VF / asystole have no beats; regular rhythms have rate-matched beats; afib is irregular", () => {
    const rng = new Rng(1);
    expect(beatTimes("vf", 80, 10, rng)).toEqual([]);
    expect(beatTimes("asystole", 80, 10, rng)).toEqual([]);
    expect(beatTimes("sinus", 60, 10, rng)).toHaveLength(10);
    const af = beatTimes("afib", 90, 20, new Rng(3));
    const rr = af.slice(1).map((t, i) => t - af[i]);
    expect(max(rr) - min(rr)).toBeGreaterThan(0.2);
  });
  it("asystole is near-flat; sinus has R waves ~1 mV in lead II", () => {
    expect(max(ecg({ kind: "asystole" }).y)).toBeLessThan(0.1);
    expect(max(ecg({ kind: "sinus", lead: "II" }).y)).toBeGreaterThan(0.8);
  });
  it("ST shift visible: elevated segment ~ +stmm/10 mV between QRS and T", () => {
    const base = ecg({ kind: "sinus", rate: 60, lead: "V2", stmm: 0, seed: 2 }).y;
    const ste = ecg({ kind: "sinus", rate: 60, lead: "V2", stmm: 3, seed: 2 }).y;
    const i = Math.round((0.25 + 0.12) * FS); // 120 ms after the first R
    expect(ste[i] - base[i]).toBeGreaterThan(0.2);
    expect(LEADS.aVR[0]).toBe(0.1); // copied table
  });
  it("seeded: same seed = same samples", () => {
    expect(Array.from(ecg({ kind: "afib", seed: 9 }).y.slice(0, 50))).toEqual(Array.from(ecg({ kind: "afib", seed: 9 }).y.slice(0, 50)));
  });
});

describe("capno()", () => {
  it.each(["normal", "shark", "cpr"] as const)("%s: shape and plateau ~ EtCO2", (p) => {
    const { t, y } = capno({ pattern: p, etco2: 36, rr: 12, seconds: 16 });
    expect(t.length).toBe(1600);
    expect(max(y)).toBeGreaterThan(30);
    expect(max(y)).toBeLessThan(42);
    expect(min(y)).toBeGreaterThanOrEqual(-2);
  });
  it("square vs shark-fin: normal reaches plateau fast, shark rises slowly", () => {
    // 0.3 s into expiration
    expect(capnoAt("normal", 40, 12, 0.3)).toBeGreaterThan(38);
    expect(capnoAt("shark", 40, 12, 0.3)).toBeLessThan(15);
  });
  it("rr 0 = flat", () => expect(max(capno({ rr: 0 }).y)).toBe(0));
});

describe("pleth()", () => {
  const peaks = (y: Float64Array, thr: number) => {
    const out: number[] = [];
    for (let i = 1; i < y.length - 1; i++) if (y[i] > thr && y[i] >= y[i - 1] && y[i] > y[i + 1]) out.push(i / PLETH_FS);
    return out;
  };
  it("no pulse (VF / asystole / rate 0 / pulse:false) = flat", () => {
    for (const o of [{ rhythm: "vf" as const }, { rhythm: "asystole" as const }, { rate: 0 }, { pulse: false }]) {
      const { y, beats } = pleth({ ...o, dur: 10 });
      expect(beats).toEqual([]);
      expect(max(y) - min(y)).toBeLessThan(0.1);
    }
  });
  it("one pulse per QRS, arriving PULSE_DELAY after the R wave, with a dicrotic notch", () => {
    const { y, beats } = pleth({ rhythm: "sinus", rate: 60, dur: 10, seed: 7 });
    expect(beats).toEqual(beatTimes("sinus", 60, 10, new Rng(7)));
    const sys = peaks(y, 0.8);
    expect(sys.length).toBeGreaterThanOrEqual(9);
    expect(sys[0] - beats[0]).toBeCloseTo(PULSE_DELAY + 0.13, 1);
    // notch: a local minimum between systolic peak and diastolic wave
    const i0 = Math.round((beats[1] + PULSE_DELAY + 0.13) * PLETH_FS);
    const seg = Array.from(y.slice(i0, i0 + Math.round(0.3 * PLETH_FS)));
    const lo = seg.indexOf(Math.min(...seg.slice(0, 25)));
    expect(Math.max(...seg.slice(lo))).toBeGreaterThan(seg[lo] + 0.02);
  });
  it("afib = irregular pulse intervals (same beats as the ECG)", () => {
    const { beats } = pleth({ rhythm: "afib", rate: 90, dur: 20, seed: 3 });
    expect(beats).toEqual(beatTimes("afib", 90, 20, new Rng(3)));
    const rr = beats.slice(1).map((t, i) => t - beats[i]);
    expect(max(rr) - min(rr)).toBeGreaterThan(0.2);
  });
  it("low SBP = smaller amplitude", () => {
    expect(plethAmplitude(120)).toBe(1);
    expect(plethAmplitude(74)).toBeLessThan(0.5);
    expect(plethAmplitude(null)).toBe(1);
    const big = max(pleth({ rate: 70, amp: plethAmplitude(118) }).y);
    const small = max(pleth({ rate: 70, amp: plethAmplitude(74) }).y);
    expect(small).toBeLessThan(big * 0.5);
  });
});

describe("live 12-lead", () => {
  it("12 leads, each its own trace from the same rhythm", () => {
    const leads = TWELVE_ORDER.flat();
    expect(leads).toHaveLength(12);
    expect(new Set(leads).size).toBe(12);
    const traces = leads.map((ld) => ecg({ kind: "sinus", rate: 70, lead: ld, stmm: ld === "III" ? 3 : 0, seed: 7 }).y);
    expect(traces.every((t) => t.length === 5000)).toBe(true);
    expect(max(traces[leads.indexOf("aVR")])).toBeLessThan(max(traces[leads.indexOf("II")])); // aVR mostly negative
  });
});
