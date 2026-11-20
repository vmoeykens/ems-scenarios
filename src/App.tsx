import { href, navigate, useRoute } from "./lib/router.ts";
import { findEntry, restoreImported } from "./lib/scenario/library.ts";
import { RunProvider, useRun } from "./state/RunContext.tsx";
import { ProtocolProvider } from "./state/ProtocolContext.tsx";
import { Modal } from "./ui/primitives.tsx";
import { fmtT } from "./lib/run/reducer.ts";
import Library from "./screens/Library.tsx";
import ScenarioShell from "./screens/ScenarioShell.tsx";
import Runs from "./screens/Runs.tsx";
import Display from "./screens/Display.tsx";

export default function App() {
  const route = useRoute();
  // The student display is a separate window with its own (display-only) state: no run context, no autosave prompt.
  if (route.name === "display") return <Display />;
  return (
    <RunProvider>
      <ProtocolProvider>
        <ResumePrompt />
        {route.name === "library" && <Library />}
        {route.name === "runs" && <Runs />}
        {route.name === "scenario" && <ScenarioShell key={route.key} entryKey={route.key} tab={route.tab} />}
      </ProtocolProvider>
    </RunProvider>
  );
}

/** On load: offer to resume the autosaved in-progress run. */
function ResumePrompt() {
  const { run, resume, pendingResume: saved, clearPendingResume } = useRun();
  if (!saved || run) return null;
  const r = saved.record;
  const last = r.events[r.events.length - 1];
  const doResume = () => {
    const entry = saved.imported ? restoreImported(saved.entryKey, saved.imported.file, saved.imported.raw) : findEntry(saved.entryKey);
    if (!entry?.norm) {
      alert("The scenario for this run is no longer available; the run cannot be resumed.");
      clearPendingResume(false);
      return;
    }
    resume(entry, r);
    navigate(href.scenario(entry.key, "run"));
  };
  return (
    <Modal title="Resume run in progress?">
      <table className="sheet-table mb-2">
        <tbody>
          <tr>
            <th className="bg-head w-32">Scenario</th>
            <td>
              <b>{r.scenarioId}</b> {r.scenarioTitle}
            </td>
          </tr>
          <tr>
            <th className="bg-head">Trainee</th>
            <td>{r.trainee || "-"}</td>
          </tr>
          <tr>
            <th className="bg-head">Started</th>
            <td>{new Date(r.createdAt).toLocaleString()}</td>
          </tr>
          <tr>
            <th className="bg-head">Events</th>
            <td>
              {r.events.length}
              {last ? ` (last at ${fmtT(last.t)})` : ""}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm mb-2">This run was autosaved in this browser and not exported yet.</p>
      <div className="flex gap-2">
        <button type="button" className="sheet-btn font-bold flex-1" onClick={doResume}>
          Resume run
        </button>
        <button
          type="button"
          className="sheet-btn flex-1"
          onClick={() => {
            if (confirm("Discard the autosaved run? It has not been exported.")) clearPendingResume(true);
          }}
        >
          Discard
        </button>
      </div>
    </Modal>
  );
}
