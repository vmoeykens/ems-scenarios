import { describe, expect, it } from "vitest";
import { beatTimes, ecg, FS, LEADS, Rng } from "../src/lib/waveforms/ecg.ts";
import { capno, capnoAt } from "../src/lib/waveforms/capno.ts";
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
