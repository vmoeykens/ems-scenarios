import { useEffect, useState, useSyncExternalStore } from "react";
import { href, navigate } from "../lib/router.ts";
import {
  bundledEntries,
  CATEGORY_ORDER,
  checkInLibrary,
  categoryOf,
  importedEntries,
  importScenarioText,
  subscribeLibrary,
  type LibraryEntry,
} from "../lib/scenario/library.ts";
import type { CheckResult } from "../lib/scenario/check.ts";
import { useRun } from "../state/RunContext.tsx";
import { RemoteButton } from "../ui/RemotePanel.tsx";
import { Footer, Md, Section } from "../ui/primitives.tsx";

export default function Library() {
  const imported = useSyncExternalStore(subscribeLibrary, importedEntries);
  const all = [...bundledEntries(), ...imported];
  const { run, openDisplay } = useRun();
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
          <button type="button" className="sheet-btn" onClick={openDisplay}>
            Open student screen
          </button>
          <RemoteButton />
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
        <PasteImport />
        <div className="section-sub">Or upload a file</div>
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
          <input type="file" accept=".json,.txt,application/json,text/plain" multiple className="sr-only" onChange={(e) => e.target.files && void onFiles(e.target.files)} />
          <span>
            <b>Choose file</b> or drop scenario <code>.json</code> here. Validated with the same schema + rules as <code>npm run validate</code>.
          </span>
        </label>
        {errors.map((er) => (
          <div key={er.file} className="p-1.5 border-t border-ink">
            <div className="text-alert font-bold">Not imported: {er.file}</div>
            <ul className="text-sm list-disc pl-5">
              {er.errors.map((m, i) => (
                <li key={i} className="font-mono text-xs whitespace-pre-wrap">
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
      <td className="text-xs hide-narrow">
        <Md text={(sc.protocols ?? []).join(" | ")} />
      </td>
    </tr>
  );
}

/** Paste box: validates live (debounced) with the same schema + rules as file import. */
function PasteImport() {
  const [text, setText] = useState("");
  const [check, setCheck] = useState<CheckResult>({ state: "empty" });
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setCheck(checkInLibrary(text)), 250);
    return () => clearTimeout(t);
  }, [text]);

  const errorList = check.state === "invalid" ? check.errors : check.state === "json-error" ? [check.error] : [];

  function doImport(open: boolean) {
    if (check.state !== "valid") return;
    const name = `${check.scenario.id ?? "pasted"}_pasted.json`;
    const r = importScenarioText(name, text);
    if (!r.ok) return; // cannot happen: same checks as checkScenarioText
    setText("");
    setCheck({ state: "empty" });
    setDone(`Imported ${r.entry.scenario.id} ${r.entry.scenario.title} (this session only).`);
    if (open) navigate(href.scenario(r.entry.key));
  }

  async function copyErrors() {
    const body = `Fix these validation errors in the scenario JSON, then give me the complete corrected JSON:\n${errorList.map((e, i) => `${i + 1}. ${e}`).join("\n")}`;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the list is still visible to select by hand */
    }
  }

  return (
    <div className="p-1.5" data-testid="paste-import">
      <label htmlFor="paste-json" className="block text-sm mb-1">
        <b>Paste scenario JSON</b> - a whole AI chat reply is fine; text and <code>```</code> fences around the JSON are ignored. Checked as you type.
      </label>
      <textarea
        id="paste-json"
        data-testid="paste-json"
        className="field font-mono text-xs min-h-40"
        rows={10}
        spellCheck={false}
        placeholder='{ "id": "MED-07", "title": "...", ... }'
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDone(null);
        }}
      />
      <div className="mt-1" data-testid="paste-status" data-state={check.state} aria-live="polite">
        {check.state === "empty" && done && <div className="font-bold">{done}</div>}
        {check.state === "json-error" && (
          <div>
            <div className="text-alert font-bold">{check.error}</div>
            {check.snippet && <pre className="font-mono text-xs border border-ink p-1 mt-0.5 overflow-x-auto">{check.snippet}</pre>}
          </div>
        )}
        {check.state === "invalid" && (
          <div>
            <div className="text-alert font-bold">
              {check.scenario.id ?? "Scenario"}: {check.errors.length} validation problem{check.errors.length === 1 ? "" : "s"} - fix the JSON
            </div>
            <ol className="list-decimal pl-5 font-mono text-xs" data-testid="paste-errors">
              {check.errors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ol>
          </div>
        )}
        {check.state === "valid" && (
          <div data-testid="paste-valid">
            <div className="font-bold">
              Valid: {check.scenario.id} {check.scenario.title}
            </div>
            {check.duplicateOf && <div className="text-xs">Same ID as {check.duplicateOf} - it will be added as a separate imported entry.</div>}
            {!!check.scenario.review_notes?.length && (
              <div className="text-xs mt-0.5" data-testid="paste-review-notes">
                <b>Review notes (not printed):</b>
                <ul className="list-disc pl-5">
                  {check.scenario.review_notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {check.state !== "empty" && check.state !== "json-error" && check.cleaned && (
          <div className="text-xs italic">Text around the JSON was ignored.</div>
        )}
      </div>
      <div className="flex flex-wrap gap-1 mt-1">
        <button type="button" className="sheet-btn" disabled={check.state !== "valid"} onClick={() => doImport(true)} data-testid="paste-open">
          Import &amp; open
        </button>
        <button type="button" className="sheet-btn" disabled={check.state !== "valid"} onClick={() => doImport(false)} data-testid="paste-import-btn">
          Import
        </button>
        <button type="button" className="sheet-btn" disabled={errorList.length === 0} onClick={() => void copyErrors()} data-testid="paste-copy-errors">
          {copied ? "Copied" : "Copy errors (for the AI)"}
        </button>
        <button
          type="button"
          className="sheet-btn"
          disabled={!text}
          onClick={() => {
            setText("");
            setDone(null);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
