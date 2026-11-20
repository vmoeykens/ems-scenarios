import { useEffect, useState } from "react";
import { parseRunFile } from "../lib/run/export.ts";
import { completion, fmtT, reduce } from "../lib/run/reducer.ts";
import type { RunRecord } from "../lib/run/types.ts";
import { findForRun, type LibraryEntry } from "../lib/scenario/library.ts";
import { href } from "../lib/router.ts";
import { Footer, Section } from "../ui/primitives.tsx";
import Debrief from "./Debrief.tsx";

interface Loaded {
  file: string;
  record: RunRecord;
  entry?: LibraryEntry;
  sameHash: boolean;
}

/** Runs: open exported run JSON files (no stored history), view read-only debriefs, compare per trainee. */
export default function Runs() {
  const [runs, setRuns] = useState<Loaded[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  async function onFiles(files: FileList) {
    const errs: string[] = [];
    const add: Loaded[] = [];
    for (const f of Array.from(files)) {
      try {
        const record = parseRunFile(await f.text());
        const { entry, sameHash } = await findForRun(record.scenarioId, record.scenarioHash);
        add.push({ file: f.name, record, entry, sameHash });
      } catch (e) {
        errs.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setErrors(errs);
    setRuns((r) => [...r, ...add.filter((a) => !r.some((x) => x.record.runId === a.record.runId))]);
  }

  useEffect(() => window.scrollTo(0, 0), [open]);

  if (open !== null && runs[open]) {
    const r = runs[open];
    return (
      <div className="page">
        <header className="sheet-head">
          <h1 className="sheet-title">
            {r.record.scenarioId} | {r.record.scenarioTitle} - {r.record.trainee || "trainee"} {r.record.date}
          </h1>
          <button type="button" className="sheet-btn no-print" onClick={() => setOpen(null)}>
            Back to runs
          </button>
        </header>
        {!r.sameHash && (
          <p className="text-sm border border-ink p-1 mb-2">
            Note: this run used a different version of the scenario (hash {r.record.scenarioHash.slice(0, 12)}); items are matched by index id and may not line up.
          </p>
        )}
        {r.entry?.norm ? (
          <Debrief record={r.record} sc={r.entry.norm} readOnly />
        ) : (
          <p className="text-alert font-bold">Scenario {r.record.scenarioId} is not in this app's library, so the log cannot be described.</p>
        )}
        <Footer />
      </div>
    );
  }

  const trainees = [...new Set(runs.map((r) => r.record.trainee || "(no name)"))].sort();
  return (
    <div className="page">
      <header className="sheet-head">
        <h1 className="sheet-title">Runs</h1>
        <a className="sheet-btn flex items-center no-print" href={href.library()}>
          Library
        </a>
      </header>
      <p className="text-sm mb-2">Nothing is stored here: open exported run files (.json) to review them. Files stay on your device.</p>
      <Section title="Open run files" className="mb-2 no-print">
        <label className="dropzone">
          <input type="file" accept=".json,application/json" multiple className="sr-only" onChange={(e) => e.target.files && void onFiles(e.target.files)} />
          <span>
            <b>Choose run file(s)</b> exported from Debrief (<code>*_*.json</code>).
          </span>
        </label>
        {errors.map((e) => (
          <div key={e} className="text-alert text-sm px-1.5">
            {e}
          </div>
        ))}
      </Section>
      {trainees.map((t) => (
        <Section key={t} title={`Trainee: ${t}`} right={`${runs.filter((r) => (r.record.trainee || "(no name)") === t).length} runs`} className="mb-2">
          <table className="sheet-table zebra">
            <thead>
              <tr>
                <th>Date</th>
                <th>Scenario</th>
                <th>Result</th>
                <th>Checklist</th>
                <th>Critical missed</th>
                <th>Length</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {runs
                .map((r, i) => [r, i] as const)
                .filter(([r]) => (r.record.trainee || "(no name)") === t)
                .sort(([a], [b]) => a.record.date.localeCompare(b.record.date))
                .map(([r, i]) => {
                  const sc = r.entry?.norm;
                  const s = sc ? reduce(sc, r.record.events) : null;
                  const comp = sc && s ? completion(sc, s) : null;
                  const missed = sc && s ? sc.critical.filter((c) => s.critical[c.id]?.status === "missed").length : null;
                  return (
                    <tr key={r.record.runId}>
                      <td>{r.record.date}</td>
                      <td>
                        <b>{r.record.scenarioId}</b> {r.record.scenarioTitle}
                      </td>
                      <td className="font-bold uppercase">{r.record.result ?? "-"}</td>
                      <td>{comp ? `${comp.done}/${comp.total} (${comp.pct}%)` : "-"}</td>
                      <td className={missed ? "text-alert font-bold" : ""}>{missed ?? "-"}</td>
                      <td>{fmtT(r.record.events.reduce((m, e) => Math.max(m, e.t), 0))}</td>
                      <td className="p-0 no-print">
                        <button type="button" className="sheet-btn w-full border-0 font-bold" onClick={() => setOpen(i)}>
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </Section>
      ))}
      <Footer />
    </div>
  );
}
