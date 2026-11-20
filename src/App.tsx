import { bundledScenarios } from "./lib/scenario/bundled.ts";
import { FOOTER } from "./lib/scenario/constants.ts";

// Phase 0 placeholder in the "paper" theme: proves the bundled scenarios load and validate in the browser.
// The instructor console (Phase 1) replaces this.
export default function App() {
  const list = bundledScenarios();
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 p-3 max-w-4xl mx-auto w-full">
        <h1 className="text-xl font-bold border-b-2 border-ink mb-2">Scenario Runner</h1>
        <p className="mb-3 text-sm">Phase 0 build: schema + validator only. Instructor console comes in Phase 1.</p>
        <section className="section">
          <div className="section-bar">
            <span>Scenario library</span>
            <span className="italic normal-case font-normal">schema + rules</span>
          </div>
          <table className="sheet-table zebra">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Validation</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ file, scenario, result }) => (
                <tr key={file}>
                  <td className="font-bold">{scenario.id}</td>
                  <td>{scenario.title}</td>
                  <td className={result.ok ? "" : "text-alert font-bold"}>
                    {result.ok ? "valid" : `${result.errors.length} problems`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
      <footer className="px-3 py-1 text-xs text-rule">{FOOTER}</footer>
    </div>
  );
}
