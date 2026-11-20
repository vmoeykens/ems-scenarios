// Live sweeping trace for the student monitor (erase-bar sweep like a bedside monitor).
import { useEffect, useRef } from "react";
import type { CapnoParams, EcgParams } from "../lib/display/toDisplay.ts";
import { capnoAt } from "../lib/waveforms/capno.ts";
import { ecg } from "../lib/waveforms/ecg.ts";

const ECG_FS = 250;

/** Loopable lead II buffer: regular rhythms use a whole number of beats so the loop is seamless. */
export function ecgLoop(p: EcgParams): Float64Array {
  const regular = p.rhythm !== "afib" && p.rhythm !== "vf" && p.rhythm !== "asystole" && p.rhythm !== "chb" && p.rhythm !== "flutter";
  let dur = 24;
  if (regular && p.rate > 0) {
    const rr = 60 / p.rate;
    dur = rr * Math.max(1, Math.round(24 / rr));
  }
  // Start beats at 0.25 s like the generator; with dur = k*rr the loop point falls on the same phase.
  return ecg({ kind: p.rhythm, rate: p.rate, dur, lead: "II", stmm: p.st ?? 0, p_rate: p.p_rate, fs: ECG_FS, seed: 7 }).y;
}

interface Props {
  kind: "ecg" | "capno";
  ecg?: EcgParams | null;
  capno?: CapnoParams | null;
  /** seconds across the full width */
  span: number;
  color: string;
  label: string;
  height: number;
}

export function LiveTrace({ kind, ecg: ep, capno: cp, span, color, label, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sig = JSON.stringify(kind === "ecg" ? ep : cp);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const buf = kind === "ecg" && ep ? ecgLoop(ep) : null;
    let w = 0;
    let h = 0;
    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      w = c.clientWidth || 600;
      h = height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(c);

    const value = (t: number): number | null => {
      if (kind === "ecg") {
        if (!buf) return null;
        const i = Math.floor(t * ECG_FS) % buf.length;
        return buf[i];
      }
      if (!cp) return null;
      return capnoAt(cp.pattern, cp.etco2, cp.rr, t - 0.5);
    };
    const yOf = (v: number) => {
      if (kind === "ecg") return h * 0.62 - (v / 2.2) * h * 0.85; // ~ -0.8..1.4 mV
      const top = Math.max(50, (cp?.etco2 ?? 40) + 8);
      return h - 6 - (Math.max(-2, v) / top) * (h - 14);
    };

    const t0 = performance.now();
    let lastT = 0;
    let lastY: number | null = null;
    let raf = 0;
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      const pxPerS = w / span;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.lineJoin = "round";
      const step = 1 / 120;
      for (let tt = lastT + step; tt <= t; tt += step) {
        const x0 = ((tt - step) % span) * pxPerS;
        const x1 = (tt % span) * pxPerS;
        // erase bar ahead of the pen
        ctx.fillStyle = "#000";
        ctx.fillRect(x1 + 2, 0, 14, h);
        const v = value(tt);
        if (v === null) {
          lastY = null;
          continue;
        }
        const y = yOf(v);
        if (lastY !== null && x1 > x0) {
          ctx.beginPath();
          ctx.moveTo(x0, lastY);
          ctx.lineTo(x1, y);
          ctx.stroke();
        }
        lastY = y;
        lastT = tt;
      }
      lastT = Math.max(lastT, t - step);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sig, span, color, height]);

  const off = kind === "ecg" ? !ep : !cp;
  return (
    <div className="relative">
      <canvas ref={ref} className="block w-full" role="img" aria-label={`${label} (simulated)`} />
      <span className="absolute left-2 top-1 text-sm font-bold" style={{ color }}>
        {label}
      </span>
      {off && <span className="absolute inset-0 flex items-center justify-center text-lg text-rule">{kind === "ecg" ? "ECG --" : "CO2 --"}</span>}
    </div>
  );
}
