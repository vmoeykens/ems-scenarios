import { useMemo, useState } from "react";
import { describeEvent } from "../lib/run/describe.ts";
import { exportCsv, exportJson, fileStem, summaryHtml } from "../lib/run/export.ts";
import { completion, fmtT, reduce } from "../lib/run/reducer.ts";
import type { Result, RunRecord } from "../lib/run/types.ts";
import { OE_URL } from "../lib/scenario/constants.ts";
import { learnPrompt } from "../lib/scenario/learn.ts";
import type { NormalizedScenario } from "../lib/scenario/normalize.ts";
import { useRun } from "../state/RunContext.tsx";
import { download, Md, Section } from "../ui/primitives.tsx";
import { QR } from "../ui/QR.tsx";
import { href, navigate } from "../lib/router.ts";

/** Debrief = PDF p.2 bottom (critical | differentials, debrief prompts | result) + event log, learn-more card, exports.
 *  readOnly = Runs screen view of an exported run file. */
export default function Debrief({ record, sc, readOnly = false }: { record: RunRecord; sc: NormalizedScenario; readOnly?: boolean }) {
  const s = useMemo(() => reduce(sc, record.events), [sc, record.events]);
  const comp = completion(sc, s);
  const missed = sc.critical.filter((c) => s.critical[c.id]?.status === "missed");
  const met = sc.critical.filter((c) => s.critical[c.id]?.status === "met");
  const [showUndone, setShowUndone] = useState(false);
  const prompt = learnPrompt(sc.source);

  return (
    <div className="flex flex-col gap-2">
      {missed.length > 0 && (
        <div className="flag-banner" role="status">
          Flagged for evaluator discretion: {missed.length} critical item{missed.length > 1 ? "s" : ""} marked MISSED. Not an automatic fail.
        </div>
      )}

      <div className="grid-2">
        <Section title="Result">
          <ResultForm record={record} readOnly={readOnly} />
        </Section>
        <Section title="Completion">
          <table className="sheet-table">
            <tbody>
              <tr>
                <th className="bg-head w-40">Expected actions</th>
                <td>
                  <b data-testid="completion">
                    {comp.done}/{comp.total} ({comp.pct}%)
                  </b>
                  <div className="meter" aria-hidden>
                    <div style={{ width: `${comp.pct}%` }} />
                  </div>
                </td>
              </tr>
              <tr>
                <th className="bg-head">Critical items</th>
                <td>
                  {met.length} met, <span className={missed.length ? "text-alert font-bold" : ""}>{missed.length} missed</span>,{" "}
                  {sc.critical.length - met.length - missed.length} not marked
                </td>
              </tr>
              <tr>
                <th className="bg-head">Branches taken</th>
                <td>
                  {s.branches.filter((b) => !b.inject).length} crew, {s.branches.filter((b) => b.inject).length} examiner options
                </td>
              </tr>
              <tr>
                <th className="bg-head">Run time</th>
                <td>{fmtT(s.effective.reduce((m, e) => Math.max(m, e.t), 0))} (last logged event)</td>
              </tr>
            </tbody>
          </table>
        </Section>
      </div>

      <div className="grid-2">
        <Section title="Critical actions (instructor discretion)">
          <table className="sheet-table zebra">
            <tbody>
              {sc.critical.map((c) => {
                const st = s.critical[c.id];
                return (
                  <tr key={c.id}>
                    <td className="w-24 font-bold">
                      {st?.status === "missed" ? <span className="text-alert">MISSED</span> : st?.status === "met" ? "MET" : <span className="text-rule font-normal">-</span>}
                    </td>
                    <td>
                      <Md text={c.text} />
                    </td>
                    <td className="w-20 text-xs">{st ? fmtT(st.t) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
        <Section title="Differentials">
          <table className="sheet-table zebra">
            <thead>
              <tr>
                <th>Differential</th>
                <th>Supports</th>
                <th>Against / rule-out</th>
              </tr>
            </thead>
            <tbody>
              {(sc.source.differentials ?? []).map((d, i) => (
                <tr key={i}>
                  <td className="font-bold">
                    <Md text={d[0]} />
                  </td>
                  <td className="text-sm">
                    <Md text={d[1]} />
                  </td>
                  <td className="text-sm">
                    <Md text={d[2]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <Section title="Debrief prompts">
        <ul className="list-disc pl-6 py-1 pr-2">
          {(sc.source.debrief ?? []).map((q, i) => (
            <li key={i}>
              <Md text={q} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Scenario flow - expected actions" right="time = scenario clock">
        <table className="sheet-table">
          <tbody>
            {sc.phases.map((p) => (
              <FlowRows key={p.id} p={p} s={s} />
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Event log"
        right={
          <label className="flex items-center gap-1 no-print">
            <input type="checkbox" className="box" checked={showUndone} onChange={(e) => setShowUndone(e.target.checked)} /> show undone
          </label>
        }
      >
        <table className="sheet-table zebra" data-testid="event-log">
          <thead>
            <tr>
              <th className="w-12">#</th>
              <th className="w-20">Time</th>
              <th>Event</th>
            </tr>
          </thead>
          <tbody>
            {record.events
              .filter((e) => showUndone || (e.kind !== "undo" && !s.undone.has(e.seq)))
              .map((e) => (
                <tr key={e.seq} className={s.undone.has(e.seq) ? "line-through text-rule" : ""}>
                  <td className="text-xs">{e.seq}</td>
                  <td className="text-xs tabular-nums">{fmtT(e.t)}</td>
                  <td className={e.kind === "critical" && e.status === "missed" ? "font-bold" : ""}>{describeEvent(sc, e)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Section>

      <Section title="After the scenario - learn more" right="for the trainee">
        <div className="flex flex-wrap gap-3 p-2 items-end">
          <div className="flex-1 min-w-[16rem]">
            <p className="text-xs mb-1">
              Paste this into <b>OpenEvidence</b> (free with a US clinician NPI account), or any evidence tool. Verify against VT protocols.
            </p>
            <p className="border border-ink p-1.5 text-sm" data-testid="learn-prompt">
              {prompt}
            </p>
            <button type="button" className="sheet-btn mt-1 no-print" onClick={() => void navigator.clipboard?.writeText(prompt)}>
              Copy prompt
            </button>
          </div>
          <QR data={prompt} size="9rem" label="Scan: prompt text" />
          <QR data={OE_URL} size="5.5rem" label="Scan: openevidence.com" />
        </div>
      </Section>

      <ExportPanel record={record} sc={sc} readOnly={readOnly} />
    </div>
  );
}

function FlowRows({ p, s }: { p: NormalizedScenario["phases"][number]; s: ReturnType<typeof reduce> }) {
  return (
    <>
      <tr>
        <th colSpan={3} className="bg-head">
          {p.time} | <Md text={p.phase} />
        </th>
      </tr>
      {p.expectedItems.map((i) => (
        <tr key={i.id}>
          <td className="w-10 text-center">{s.expected[i.id] ? "[x]" : "[ ]"}</td>
          <td className={s.expected[i.id] ? "" : "text-cue"}>
            <Md text={i.text} />
          </td>
          <td className="w-20 text-xs">{s.expected[i.id] ? fmtT(s.expected[i.id].t) : ""}</td>
        </tr>
      ))}
    </>
  );
}

function ResultForm({ record, readOnly }: { record: RunRecord; readOnly: boolean }) {
  const { setMeta } = useRun();
  const results: [Result, string][] = [
    ["pass", "Pass"],
    ["remediate", "Remediate"],
    ["fail", "Fail"],
  ];
  return (
    <div className="p-1.5 flex flex-col gap-1.5">
      <div className="flex gap-1" role="radiogroup" aria-label="Result">
        {results.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={record.result === k}
            disabled={readOnly}
            className={`sheet-btn seg flex-1 font-bold ${record.result === k ? "seg-on" : ""}`}
            onClick={() => setMeta({ result: record.result === k ? null : k })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-1 items-center">
        <label htmlFor="trainee" className="font-bold text-sm">
          Trainee
        </label>
        <input id="trainee" className="field" readOnly={readOnly} value={record.trainee} onChange={(e) => setMeta({ trainee: e.target.value })} />
        <label htmlFor="evaluator" className="font-bold text-sm">
          Evaluator
        </label>
        <input id="evaluator" className="field" readOnly={readOnly} value={record.evaluator} onChange={(e) => setMeta({ evaluator: e.target.value })} />
        <label htmlFor="date" className="font-bold text-sm">
          Date
        </label>
        <input id="date" type="date" className="field" readOnly={readOnly} value={record.date} onChange={(e) => setMeta({ date: e.target.value })} />
      </div>
      <p className="text-xs text-cue">Staff names only - no patient data. Kept in this browser until the run is exported or discarded.</p>
    </div>
  );
}

function ExportPanel({ record, sc, readOnly }: { record: RunRecord; sc: NormalizedScenario; readOnly: boolean }) {
  const { markExported, discard, run } = useRun();
  const stem = fileStem(record);
  const after = () => !readOnly && markExported();
  const printSummary = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(summaryHtml(sc, record));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  return (
    <Section title="Export" right={readOnly ? "read-only run file" : run?.exported ? "exported - autosave cleared" : "exporting clears the autosave"}>
      <div className="flex flex-wrap gap-1 p-1 no-print">
        <button
          type="button"
          className="sheet-btn font-bold"
          data-testid="export-json"
          onClick={() => {
            download(`${stem}.json`, exportJson(record), "application/json");
            after();
          }}
        >
          Run record (.json)
        </button>
        <button
          type="button"
          className="sheet-btn"
          data-testid="export-csv"
          onClick={() => {
            download(`${stem}_events.csv`, exportCsv(sc, record), "text/csv");
            after();
          }}
        >
          Events (.csv)
        </button>
        <button
          type="button"
          className="sheet-btn"
          data-testid="export-html"
          onClick={() => {
            download(`${stem}_summary.html`, summaryHtml(sc, record), "text/html");
            after();
          }}
        >
          Summary (.html)
        </button>
        <button type="button" className="sheet-btn" onClick={printSummary}>
          Print summary
        </button>
        {!readOnly && (
          <button
            type="button"
            className="sheet-btn ml-auto"
            onClick={() => {
              if (run?.exported || confirm("Discard this run? It has not been exported.")) {
                discard();
                navigate(href.library());
              }
            }}
          >
            {run?.exported ? "Close run" : "Discard run"}
          </button>
        )}
      </div>
    </Section>
  );
}
