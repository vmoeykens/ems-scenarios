// Live sweeping traces for the student monitor (erase-bar sweep like a bedside monitor): ECG lead II, SpO2 pleth,
// capnography, and a live 12-lead. All traces share one time origin, so the pleth pulse follows each QRS.
import { useEffect, useMemo, useRef } from "react";
import type { CapnoParams, EcgParams, PlethParams } from "../lib/display/toDisplay.ts";
import type { Lead } from "../lib/scenario/types.ts";
import { capnoAt } from "../lib/waveforms/capno.ts";
import { ecg, TWELVE_ORDER } from "../lib/waveforms/ecg.ts";
import { pleth, PLETH_FS } from "../lib/waveforms/pleth.ts";

const ECG_FS = 250;
const SEED = 7;
/** shared time origin for every trace in this window */
const T0 = typeof performance !== "undefined" ? performance.now() : 0;
const now = () => (performance.now() - T0) / 1000;

/** Loop length: regular rhythms use a whole number of beats so the loop is seamless (beats start at 0.25 s). */
export function loopDur(p: { rhythm: string; rate: number }): number {
  const regular = !["afib", "vf", "asystole", "chb", "flutter"].includes(p.rhythm);
  if (regular && p.rate > 0) {
    const rr = 60 / p.rate;
    return rr * Math.max(1, Math.round(24 / rr));
  }
  return 24;
}

export function ecgLoop(p: EcgParams, lead: Lead = "II", st = p.st ?? 0): Float64Array {
  return ecg({ kind: p.rhythm, rate: p.rate, dur: loopDur(p), lead, stmm: st, p_rate: p.p_rate, fs: ECG_FS, seed: SEED }).y;
}

export function plethLoop(p: PlethParams): Float64Array {
  return pleth({ rhythm: p.rhythm, rate: p.rate, amp: p.amp, dur: loopDur(p), fs: PLETH_FS, seed: SEED }).y;
}

type Sampler = (t: number) => number | null;

/** Runs the sweep: calls draw for each step with x positions; erase bar ahead of the pen. */
function useSweep(
  ref: React.RefObject<HTMLCanvasElement | null>,
  deps: unknown[],
  height: number,
  span: number,
  rows: { sample: Sampler; y: (v: number, h: number) => number; top: (h: number) => number; rowH: (h: number) => number }[],
  color: string,
  grid?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let w = 0;
    const h = height;
    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      w = c.clientWidth || 600;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      grid?.(ctx, w, h);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(c);
    const step = 1 / 120;
    let lastT = now();
    const lastY: (number | null)[] = rows.map(() => null);
    let raf = 0;
    const frame = () => {
      const t = now();
      const pxPerS = w / span;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.lineJoin = "round";
      if (t - lastT > 2) lastT = t - step; // tab was hidden: don't replay
      for (let tt = lastT + step; tt <= t; tt += step) {
        const x0 = ((tt - step) % span) * pxPerS;
        const x1 = (tt % span) * pxPerS;
        ctx.fillStyle = "#000";
        ctx.fillRect(x1 + 2, 0, 12, h);
        if (grid && x1 < x0) grid(ctx, w, h); // redraw separators each pass
        rows.forEach((r, i) => {
          const v = r.sample(tt);
          if (v === null) {
            lastY[i] = null;
            return;
          }
          const y = r.top(h) + r.y(v, r.rowH(h));
          if (lastY[i] !== null && x1 > x0) {
            ctx.beginPath();
            ctx.moveTo(x0, lastY[i]!);
            ctx.lineTo(x1, y);
            ctx.stroke();
          }
          lastY[i] = y;
        });
        lastT = tt;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const ecgY = (v: number, h: number) => h * 0.66 - (v / 2.2) * h * 0.85; // ~ -0.8..1.4 mV

interface TraceProps {
  kind: "ecg" | "pleth" | "capno";
  ecg?: EcgParams | null;
  pleth?: PlethParams | null;
  capno?: CapnoParams | null;
  /** seconds across the full width */
  span: number;
  color: string;
  label: string;
  /** right-hand scale text, e.g. "x1.0  25 mm/s" */
  scale?: string;
  height: number;
  offText: string;
}

export function LiveTrace({ kind, ecg: ep, pleth: pp, capno: cp, span, color, label, scale, height, offText }: TraceProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const params = kind === "ecg" ? ep : kind === "pleth" ? pp : cp;
  const sig = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buf = useMemo(() => (kind === "ecg" && ep ? ecgLoop(ep) : kind === "pleth" && pp ? plethLoop(pp) : null), [kind, sig]);
  let sample: Sampler = () => null;
  let yMap = ecgY;
  if (kind === "ecg" && ep && buf) {
    sample = (t) => buf[Math.floor(t * ECG_FS) % buf.length];
  } else if (kind === "pleth" && pp && buf) {
    sample = (t) => buf[Math.floor(t * PLETH_FS) % buf.length];
    yMap = (v, h) => h - 8 - (v / 1.45) * (h - 16); // fixed gain: poor perfusion looks small
  } else if (kind === "capno" && cp) {
    const top = Math.max(50, cp.etco2 + 8);
    sample = (t) => capnoAt(cp.pattern, cp.etco2, cp.rr, t - 0.5);
    yMap = (v, h) => h - 6 - (Math.max(-2, v) / top) * (h - 14);
  }
  useSweep(ref, [kind, sig, span, color, height], height, span, [{ sample, y: yMap, top: () => 0, rowH: (h) => h }], color);
  return (
    <div className="relative trace" style={{ color }}>
      <canvas ref={ref} className="block w-full" role="img" aria-label={`${label} waveform (simulated)`} />
      <span className="trace-label">{label}</span>
      {scale && <span className="trace-scale">{scale}</span>}
      {!params && <span className="trace-off">{offText}</span>}
    </div>
  );
}

/** Live 12-lead: 3 x 4 leads (2.5 s each, sweep across 10 s) + lead II rhythm strip, same rhythm model per lead. */
export function TwelveLive({ ecg: ep, leadSt, color, height }: { ecg: EcgParams | null; leadSt: Partial<Record<Lead, number>>; color: string; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sig = JSON.stringify([ep, leadSt]);
  const { bufs, rhythmBuf } = useMemo(() => {
    const b: Partial<Record<Lead, Float64Array>> = {};
    if (ep) for (const row of TWELVE_ORDER) for (const ld of row) b[ld] = ecgLoop(ep, ld, leadSt[ld] ?? 0);
    return { bufs: b, rhythmBuf: ep ? b.II! : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const span = 10;
  const at = (b: Float64Array | null | undefined, t: number) => (b ? b[Math.floor(t * ECG_FS) % b.length] : null);
  const rows = [0, 1, 2, 3].map((r) => ({
    sample: (t: number) => (r < 3 ? at(bufs[TWELVE_ORDER[r][Math.min(3, Math.floor((t % span) / 2.5))]], t) : at(rhythmBuf, t)),
    y: (v: number, h: number) => h * 0.6 - (v / 2.4) * h * 0.95,
    top: (h: number) => (h / 4) * r,
    rowH: (h: number) => h / 4,
  }));
  const grid = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < 4; c++) {
      const x = (w / 4) * c + 0.5;
      for (let r = 0; r < 3; r++) {
        ctx.moveTo(x, (h / 4) * r + h / 16);
        ctx.lineTo(x, (h / 4) * (r + 1) - h / 16);
      }
    }
    ctx.stroke();
  };
  useSweep(ref, [sig, color, height], height, span, rows, color, grid);
  return (
    <div className="relative trace" style={{ color }} data-testid="twelve-live">
      <canvas ref={ref} className="block w-full" role="img" aria-label="12-lead ECG (simulated)" />
      {TWELVE_ORDER.map((row, r) =>
        row.map((ld, c) => (
          <span key={ld} className="twelve-label" style={{ left: `calc(${c * 25}% + 6px)`, top: `${r * 25}%` }} data-lead={ld}>
            {ld}
          </span>
        )),
      )}
      <span className="twelve-label" style={{ left: 6, top: "75%" }}>
        II
      </span>
      <span className="trace-scale">x1.0 25 mm/s 12-lead</span>
      {!ep && <span className="trace-off">ECG --</span>}
    </div>
  );
}
