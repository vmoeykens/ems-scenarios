import { useEffect, useState } from "react";
import { elapsed, fmtT } from "../lib/run/reducer.ts";
import { useRun } from "../state/RunContext.tsx";

export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return active ? now : Date.now();
}

/** Scenario clock: start / pause / resume / reset; T+mm:ss. Green (live) only while running. */
export function Clock({ compact = false }: { compact?: boolean }) {
  const { state, dispatch } = useRun();
  const c = state?.clock;
  const now = useNow(!!c?.running);
  if (!c) return null;
  const t = fmtT(elapsed(c, now));
  return (
    <div className="flex items-stretch gap-1" data-testid="clock">
      <div
        className={`clock-face ${c.running ? "text-live border-live" : ""}`}
        aria-live="off"
        title={c.running ? "running" : c.started ? "paused" : "not started"}
      >
        {c.running && <span className="live-dot" aria-hidden />}
        <span className="tabular-nums" data-testid="clock-time">
          {t}
        </span>
        {!c.running && c.started && <span className="text-xs font-normal ml-1">paused</span>}
      </div>
      {!c.running ? (
        <button type="button" className="sheet-btn font-bold" onClick={() => dispatch({ kind: "clock", action: c.started ? "resume" : "start" })}>
          {c.started ? "Resume" : "Start"}
        </button>
      ) : (
        <button type="button" className="sheet-btn font-bold" onClick={() => dispatch({ kind: "clock", action: "pause" })}>
          Pause
        </button>
      )}
      {!compact && c.started && (
        <button
          type="button"
          className="sheet-btn no-print"
          onClick={() => {
            if (confirm("Reset the scenario clock to T+00:00? Logged events keep their times.")) dispatch({ kind: "clock", action: "reset" });
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
