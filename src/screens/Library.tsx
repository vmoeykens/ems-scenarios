import { useState, useSyncExternalStore } from "react";
import { href, navigate } from "../lib/router.ts";
import {
  bundledEntries,
  CATEGORY_ORDER,
  categoryOf,
  importedEntries,
  importScenarioText,
  subscribeLibrary,
  type LibraryEntry,
} from "../lib/scenario/library.ts";
import { useRun } from "../state/RunContext.tsx";
import { Footer, Section } from "../ui/primitives.tsx";

export default function Library() {
  const imported = useSyncExternalStore(subscribeLibrary, importedEntries);
  const all = [...bundledEntries(), ...imported];
  const { run } = useRun();
  const [errors, setErrors] = useState<{ file: string; errors: string[] }[]>([]);
  const [drag, setDrag] = useState(false);

  const cats = [...new Set(all.map((e) => categoryOf(e.scenario)))].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  async function onFiles(files: FileList | File[]) {
    const errs: { file: string; errors: string[] }[] = [];
    for (const f of Array.from(files)) {
      const r = importScenarioText(f.name, await f.text());
      if (!r.ok) errs.push({ file: r.file, errors: r.errors });
    }
    setErrors(errs);
  }

  return (
    <div className="page">
      <header className="sheet-head">
        <h1 className="sheet-title">Scenario Runner</h1>
        <div className="flex gap-1 no-print">
          <a className="sheet-btn flex items-center" href={href.runs()}>
            Runs (open files)
          </a>
        </div>
      </header>
      <p className="text-sm mb-2">
        UVM Rescue AEMT crew-chief-in-training scenarios (VT Statewide EMS Protocols 2025). Pick a scenario to open its pre-brief; the run starts there.
      </p>

      {run && (
        <div className="section mb-2 no-print">
          <div className="section-bar">
            <span>Run in progress</span>
            <span className="italic normal-case font-normal">{run.exported ? "exported" : "autosaved in this browser"}</span>
          </div>
          <a className="sheet-btn flex items-center border-0 font-bold" href={href.scenario(run.entry.key, "run")}>
            {run.record.scenarioId} {run.record.scenarioTitle} - return to run
          </a>
        </div>
      )}

      {cats.map((cat) => (
        <Section key={cat} title={cat} right={`${all.filter((e) => categoryOf(e.scenario) === cat).length} scenarios`} className="mb-2">
          <table className="sheet-table zebra lib-table">
            <thead>
              <tr>
                <th className="w-20">ID</th>
                <th>Title</th>
                <th className="w-24">Difficulty</th>
                <th className="w-24">Run time</th>
                <th className="hide-narrow">Protocols</th>
              </tr>
            </thead>
            <tbody>
              {all
                .filter((e) => categoryOf(e.scenario) === cat)
                .map((e) => (
                  <Row key={e.key} e={e} />
                ))}
            </tbody>
          </table>
        </Section>
      ))}

      <Section title="Import scenario JSON" right="session only - add to scenarios/ to keep it" className="mb-2 no-print">
        <label
          className={`dropzone ${drag ? "dropzone-on" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void onFiles(e.dataTransfer.files);
          }}
        >
          <input type="file" accept=".json,application/json" multiple className="sr-only" onChange={(e) => e.target.files && void onFiles(e.target.files)} />
          <span>
            <b>Choose file</b> or drop scenario <code>.json</code> here. Validated with the same schema + rules as <code>npm run validate</code>.
          </span>
        </label>
        {errors.map((er) => (
          <div key={er.file} className="p-1.5 border-t border-ink">
            <div className="text-alert font-bold">Not imported: {er.file}</div>
            <ul className="text-sm list-disc pl-5">
              {er.errors.map((m, i) => (
                <li key={i} className="font-mono text-xs">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <Footer />
    </div>
  );
}

function Row({ e }: { e: LibraryEntry }) {
  const sc = e.scenario;
  const ok = !!e.norm;
  return (
    <tr
      className={ok ? "row-link" : ""}
      onClick={() => ok && navigate(href.scenario(e.key))}
      tabIndex={ok ? 0 : -1}
      onKeyDown={(ev) => ok && ev.key === "Enter" && navigate(href.scenario(e.key))}
      data-testid={`lib-${sc.id ?? e.key}`}
    >
      <td className="font-bold">{sc.id ?? "-"}</td>
      <td>
        <span className="font-bold">{sc.title}</span>
        {e.source === "import" && <span className="ml-1 text-xs border border-ink px-1">imported</span>}
        {!ok && <div className="text-alert text-xs font-bold">{e.result.errors.length} validation problems - fix the JSON</div>}
      </td>
      <td>{sc.difficulty ?? ""}</td>
      <td>{sc.run_time ?? ""}</td>
      <td className="text-xs hide-narrow">{(sc.protocols ?? []).join(" | ")}</td>
    </tr>
  );
}
