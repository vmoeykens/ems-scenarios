// Canvas renders of the simulated waveforms: static paper-style cards (same layout as strip_png / twelve_png /
// capno_png in the generator) and the live sweeping monitor traces for the student display.
import { useEffect, useRef } from "react";
import { capno } from "../lib/waveforms/capno.ts";
import { ecg, TWELVE_ORDER } from "../lib/waveforms/ecg.ts";
import type { CapnoPattern, Lead, Rhythm } from "../lib/scenario/types.ts";

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** Canvas that fills its container width at a fixed aspect ratio (w/h) and redraws on resize. */
export function WaveCanvas({ draw, aspect, label, sig, className = "" }: { draw: Draw; aspect: number; label: string; sig: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      const w = c.clientWidth || 600;
      const h = Math.round(w / aspect);
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.height = `${h}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRef.current(ctx, w, h);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
  }, [aspect, sig]);
  return <canvas ref={ref} className={`block w-full ${className}`} role="img" aria-label={label} />;
}

function ecgGrid(ctx: CanvasRenderingContext2D, pxmm: number, wmm: number, hmm: number) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, wmm * pxmm, hmm * pxmm);
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? "#8c8c8c" : "#d9d9d9";
    ctx.lineWidth = major ? 0.8 : 0.5;
    ctx.beginPath();
    for (let x = 0; x <= wmm + 0.01; x++) {
      if ((x % 5 === 0) !== major) continue;
      ctx.moveTo(x * pxmm + 0.5, 0);
      ctx.lineTo(x * pxmm + 0.5, hmm * pxmm);
    }
    for (let y = 0; y <= hmm + 0.01; y++) {
      if ((y % 5 === 0) !== major) continue;
      ctx.moveTo(0, y * pxmm + 0.5);
      ctx.lineTo(wmm * pxmm, y * pxmm + 0.5);
    }
    ctx.stroke();
  }
}

function trace(ctx: CanvasRenderingContext2D, xs: ArrayLike<number>, ys: ArrayLike<number>, color = "#000", lw = 1.3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, xs[i], ys[i]);
  ctx.stroke();
}

function leadLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  ctx.font = `bold ${size}px Helvetica, Arial, sans-serif`;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 1, y - size, w + 2, size + 2);
  ctx.fillStyle = "#000";
  ctx.fillText(text, x, y);
}

export interface StripProps {
  rhythm: Rhythm;
  rate: number;
  p_rate?: number;
  lead?: Lead;
  st?: number;
  seconds?: number;
  label?: string;
}

/** strip_png(): seconds*25 mm wide x 26 mm, trace at y*10-2 mm. */
export function StripCard({ rhythm, rate, p_rate, lead = "II", st = 0, seconds = 8, label }: StripProps) {
  const wmm = seconds * 25;
  const hmm = 26;
  return (
    <WaveCanvas
      aspect={wmm / hmm}
      label={`ECG strip lead ${lead}`}
      sig={JSON.stringify([rhythm, rate, p_rate, lead, st, seconds, label])}
      draw={(ctx, w) => {
        const pxmm = w / wmm;
        ecgGrid(ctx, pxmm, wmm, hmm);
        const { t, y } = ecg({ kind: rhythm, rate, dur: seconds, lead, stmm: st, p_rate });
        const xs = Array.from(t, (v) => v * 25 * pxmm);
        const ys = Array.from(y, (v) => (hmm / 2 - (v * 10 - 2)) * pxmm);
        trace(ctx, xs, ys, "#000", Math.max(1, pxmm * 0.3));
        leadLabel(ctx, label ?? lead, 1.5 * pxmm, 5 * pxmm, Math.max(10, 2.6 * pxmm));
      }}
    />
  );
}

/** twelve_png(): 250 x 112 mm; 3 rows x 4 leads (2.5 s each) + 10 s lead II rhythm strip. */
export function TwelveCard({ rhythm, rate, p_rate, st = {} }: { rhythm: Rhythm; rate: number; p_rate?: number; st?: Partial<Record<Lead, number>> }) {
  const wmm = 250;
  const rowH = 28;
  const H = rowH * 4;
  return (
    <WaveCanvas
      aspect={wmm / H}
      label="12-lead ECG"
      sig={JSON.stringify([rhythm, rate, p_rate, st])}
      draw={(ctx, w) => {
        const pxmm = w / wmm;
        ecgGrid(ctx, pxmm, wmm, H);
        const Y = (mm: number) => (H - mm) * pxmm; // mm from bottom -> px
        const size = Math.max(9, 2.6 * pxmm);
        TWELVE_ORDER.forEach((row, r) => {
          const base = H - rowH * (r + 0.55);
          row.forEach((ld, c) => {
            const { t, y } = ecg({ kind: rhythm, rate, dur: 10, lead: ld, stmm: st[ld] ?? 0, p_rate });
            const xs: number[] = [];
            const ys: number[] = [];
            for (let i = 0; i < t.length; i++)
              if (t[i] >= c * 2.5 && t[i] < (c + 1) * 2.5) {
                xs.push(t[i] * 25 * pxmm);
                ys.push(Y(y[i] * 10 + base));
              }
            trace(ctx, xs, ys, "#000", Math.max(1, pxmm * 0.28));
            leadLabel(ctx, ld, (c * 62.5 + 1.5) * pxmm, Y(base + 7), size);
            if (c) trace(ctx, [c * 62.5 * pxmm, c * 62.5 * pxmm], [Y(base - 3), Y(base + 3)], "#000", 1.2);
          });
        });
        const { t, y } = ecg({ kind: rhythm, rate, dur: 10, lead: "II", stmm: st.II ?? 0, p_rate });
        trace(
          ctx,
          Array.from(t, (v) => v * 25 * pxmm),
          Array.from(y, (v) => Y(v * 10 + rowH * 0.45)),
          "#000",
          Math.max(1, pxmm * 0.28),
        );
        leadLabel(ctx, "II", 1.5 * pxmm, Y(rowH * 0.45 + 7), size);
      }}
    />
  );
}

/** capno_png(): 16 s, y axis -2..55 mmHg with dashed lines at 0/25/50. */
export function CapnoCard({ pattern, etco2, rr, seconds = 16 }: { pattern: CapnoPattern; etco2: number; rr: number; seconds?: number }) {
  return (
    <WaveCanvas
      aspect={3.7 / 1.15}
      label="Capnography waveform"
      sig={JSON.stringify([pattern, etco2, rr, seconds])}
      draw={(ctx, w, h) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        const L = w * 0.09;
        const B = h * 0.08;
        const pw = w * 0.89;
        const ph = h * 0.86;
        const top = h - B - ph;
        const X = (s: number) => L + (s / seconds) * pw;
        const Yv = (v: number) => top + ph - ((v + 2) / 57) * ph;
        ctx.font = `${Math.max(10, h * 0.09)}px Helvetica, Arial, sans-serif`;
        ctx.fillStyle = "#000";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const lv of [0, 25, 50]) {
          ctx.setLineDash([4, 3]);
          trace(ctx, [L, L + pw], [Yv(lv), Yv(lv)], "#b3b3b3", 0.8);
          ctx.setLineDash([]);
          ctx.fillText(String(lv), L - 4, Yv(lv));
        }
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 0.8;
        ctx.strokeRect(L, top, pw, ph);
        const { t, y } = capno({ pattern, etco2, rr, seconds });
        trace(ctx, Array.from(t, X), Array.from(y, Yv), "#000", 1.5);
      }}
    />
  );
}
