import { useEffect, useState } from "react";
import { href, navigate } from "../lib/router.ts";
import { findEntry } from "../lib/scenario/library.ts";
import { useRun } from "../state/RunContext.tsx";
import { Clock } from "../ui/Clock.tsx";
import { Footer, Modal } from "../ui/primitives.tsx";
import Prebrief from "./Prebrief.tsx";
import RunTab from "./RunTab.tsx";
import Debrief from "./Debrief.tsx";

type Tab = "prebrief" | "run" | "debrief";
const TABS: [Tab, string][] = [
  ["prebrief", "Pre-brief"],
  ["run", "Run"],
  ["debrief", "Debrief"],
];

export default function ScenarioShell({ entryKey, tab }: { entryKey: string; tab: Tab }) {
  const entry = findEntry(entryKey);
  const ctx = useRun();
  const { run, start, sc, openDisplay, displayConnected, pendingResume } = ctx;
  const [conflict, setConflict] = useState(false);

  // Opening a scenario starts a run for it, unless another run with events is in progress (ask first).
  useEffect(() => {
    if (!entry?.norm || pendingResume) return; // wait for the resume / discard decision
    if (run?.entry.key === entry.key) return;
    if (run && run.record.events.length && !run.exported) setConflict(true);
    else void start(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.key, run?.entry.key, pendingResume]);

  if (!entry || !entry.norm)
    return (
      <div className="page">
        <p className="text-alert font-bold">Scenario not found or not valid: {entryKey}</p>
        <a className="sheet-btn inline-flex items-center" href={href.library()}>
          Back to library
        </a>
        <Footer />
      </div>
    );

  if (conflict && run)
    return (
      <Modal title="Another run is in progress">
        <p className="mb-2">
          <b>
            {run.record.scenarioId} {run.record.scenarioTitle}
          </b>{" "}
          has {run.record.events.length} logged events and has not been exported.
        </p>
        <div className="flex flex-col gap-1">
          <button type="button" className="sheet-btn font-bold" onClick={() => navigate(href.scenario(run.entry.key, "debrief"))}>
            Go to that run (export it from Debrief)
          </button>
          <button
            type="button"
            className="sheet-btn"
            onClick={() => {
              if (confirm("Discard the unexported run and start this scenario?")) {
                ctx.discard();
                setConflict(false);
              }
            }}
          >
            Discard it and start {entry.scenario.id}
          </button>
          <a className="sheet-btn flex items-center" href={href.library()}>
            Back to library
          </a>
        </div>
      </Modal>
    );

  if (!run || run.entry.key !== entry.key || !sc) return <div className="page">{pendingResume ? "" : "Starting run..."}</div>;

  const s = entry.scenario;
  return (
    <div className="shell">
      <header className="run-head no-print-chrome">
        <div className="min-w-0">
          <div className="text-xs font-bold truncate">
            {s.id} | {s.title}
          </div>
          <div className="text-xs truncate">
            {s.category} | {s.level} | {s.run_time} | {s.difficulty}
          </div>
        </div>
        <div className="flex gap-1 items-stretch no-print">
          <Clock />
          <button type="button" className="sheet-btn" onClick={openDisplay} data-testid="open-display" title="Opens the student display in a new window">
            Student screen
            <span className={`ml-1 text-xs ${displayConnected ? "font-bold" : "text-rule"}`}>{displayConnected ? "(on)" : "(off)"}</span>
          </button>
        </div>
      </header>

      <main className="shell-main">
        {tab === "prebrief" && <Prebrief />}
        {tab === "run" && <RunTab />}
        {tab === "debrief" && <Debrief record={run.record} sc={sc} />}
        <Footer />
      </main>

      <nav className="tabbar no-print" aria-label="Scenario tabs">
        <a className="tab" href={href.library()}>
          Library
        </a>
        {TABS.map(([k, label]) => (
          <a key={k} className={`tab ${tab === k ? "tab-on" : ""}`} href={href.scenario(entry.key, k)} aria-current={tab === k ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}
