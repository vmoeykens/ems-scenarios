// Run exports: JSON run record, CSV of events, printable B&W HTML summary. Pure functions (tested in node).
import type { NormalizedScenario } from "../scenario/normalize.ts";
import { FOOTER } from "../scenario/constants.ts";
import { learnPrompt } from "../scenario/learn.ts";
import { stripMarkup } from "../scenario/text.ts";
import { describeEvent } from "./describe.ts";
import { completion, fmtT, reduce } from "./reducer.ts";
import type { RunRecord } from "./types.ts";

export function exportJson(rec: RunRecord): string {
  return JSON.stringify({ ...rec, exportedAt: new Date().toISOString() }, null, 2);
}

export const CSV_HEADER = ["seq", "t_ms", "clock", "wall", "kind", "undone", "description"] as const;

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv(sc: NormalizedScenario, rec: RunRecord): string {
  const undone = new Set(rec.events.flatMap((e) => (e.kind === "undo" ? [e.target] : [])));
  const rows = rec.events.map((e) => [e.seq, e.t, fmtT(e.t), e.wall, e.kind, undone.has(e.seq) ? "yes" : "", describeEvent(sc, e)]);
  const meta = [
    ["# run", rec.runId],
    ["# scenario", `${rec.scenarioId} ${rec.scenarioTitle} (${rec.scenarioVersion}) sha256:${rec.scenarioHash}`],
    ["# trainee", rec.trainee],
    ["# evaluator", rec.evaluator],
    ["# date", rec.date],
    ["# result", rec.result ?? ""],
    ["# footer", FOOTER],
  ];
  return [...meta, [...CSV_HEADER], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
/** escape + **bold** + -> arrow, like md() in the generator */
export const mdHtml = (s: unknown) =>
  esc(s)
    .replace(/\*\*\*(.+?)\*\*\*/g, "<b>$1</b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/-&gt;/g, "&rarr;")
    .replace(/\n/g, "<br>");

/** Paper-sheet CSS for the standalone summary (same tokens as src/index.css, greyscale only). */
export const SUMMARY_CSS = `
@page{size:letter;margin:.4in}
*{box-sizing:border-box}
body{font:12px/1.3 Helvetica,Arial,"Liberation Sans",sans-serif;color:#000;background:#fff;margin:16px auto;max-width:8in}
h1{font-size:18px;margin:0;border-bottom:2px solid #000;padding-bottom:2px}
.meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin:4px 0 8px}
.section{border:1px solid #000;margin:0 0 6px;break-inside:avoid}
.bar{background:#000;color:#fff;font-weight:bold;text-transform:uppercase;font-size:11px;padding:2px 5px;display:flex;justify-content:space-between}
.bar i{font-weight:normal;text-transform:none}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #000;padding:2px 4px;text-align:left;vertical-align:top}
thead th{background:#e0e0e0;font-size:11px}
tbody tr:nth-child(even){background:#f2f2f2}
.flag{border:2px solid #000;padding:4px 6px;font-weight:bold;margin:0 0 6px}
.missed{font-weight:bold}
.muted{color:#404040}
.pad{padding:4px 6px}
footer{margin-top:10px;font-size:10px;color:#404040;border-top:1px solid #8c8c8c;padding-top:3px}
`;

export function summaryHtml(sc: NormalizedScenario, rec: RunRecord): string {
  const s = reduce(sc, rec.events);
  const comp = completion(sc, s);
  const missed = sc.critical.filter((c) => s.critical[c.id]?.status === "missed");
  const result = rec.result ? rec.result.toUpperCase() : "not recorded";
  const sec = (title: string, body: string, right = "") =>
    `<div class="section"><div class="bar"><span>${esc(title)}</span>${right ? `<i>${esc(right)}</i>` : ""}</div>${body}</div>`;

  const flowRows = sc.phases
    .map((p) => {
      const items = p.expectedItems
        .map((i) => `<tr><td>${s.expected[i.id] ? "[x]" : "[ ]"}</td><td>${mdHtml(i.text)}</td><td>${s.expected[i.id] ? fmtT(s.expected[i.id].t) : ""}</td></tr>`)
        .join("");
      return `<tr><th colspan="3" style="background:#e0e0e0">${esc(p.time ?? "")} | ${mdHtml(p.phase ?? p.id)}</th></tr>${items}`;
    })
    .join("");
  const crit = sc.critical
    .map((c) => {
      const st = s.critical[c.id];
      const label = st?.status === "missed" ? `<span class="missed">MISSED</span>` : st?.status === "met" ? "MET" : `<span class="muted">not marked</span>`;
      return `<tr><td>${label}</td><td>${mdHtml(c.text)}</td><td>${st ? fmtT(st.t) : ""}</td></tr>`;
    })
    .join("");
  const branches = s.branches
    .map((b) => {
      const br = sc.phases.find((p) => p.id === b.phaseId)?.branchList.find((x) => x.id === b.branchId);
      return `<tr><td>${fmtT(b.t)}</td><td>${b.inject ? "EXAMINER OPTION" : "IF"}</td><td>${mdHtml(br?.if ?? b.branchId)} &rarr; ${mdHtml(br?.then ?? "")}</td></tr>`;
    })
    .join("");
  const vit = s.effective
    .filter((e) => e.kind === "reveal")
    .map((e) => (e.kind === "reveal" ? `<tr><td>${fmtT(e.t)}</td><td>${esc(e.stageKey)}${e.adlib ? " (ad lib)" : ""}</td><td>${esc(e.vital)}</td><td>${esc(stripMarkup(e.value))}</td></tr>` : ""))
    .join("");
  const notes = s.notes.map((n) => `<tr><td>${fmtT(n.t)}</td><td>${esc(n.text)}</td></tr>`).join("");
  const log = rec.events
    .map((e) => `<tr${s.undone.has(e.seq) ? ' class="muted"' : ""}><td>${e.seq}</td><td>${fmtT(e.t)}</td><td>${esc(describeEvent(sc, e))}${s.undone.has(e.seq) ? " (undone)" : ""}</td></tr>`)
    .join("");
  const table = (head: string[], rows: string) =>
    rows ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>` : `<div class="pad muted">none</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`${rec.scenarioId} run summary - ${rec.trainee || "trainee"} ${rec.date}`)}</title>
<style>${SUMMARY_CSS}</style></head><body>
<h1>${esc(rec.scenarioId)} | ${mdHtml(rec.scenarioTitle)} - run summary</h1>
<div class="meta"><span><b>Trainee:</b> ${esc(rec.trainee || "-")}</span><span><b>Evaluator:</b> ${esc(rec.evaluator || "-")}</span><span><b>Date:</b> ${esc(rec.date)}</span><span><b>Result:</b> ${esc(result)}</span><span><b>Checklist:</b> ${comp.done}/${comp.total} (${comp.pct}%)</span><span class="muted">${esc(rec.scenarioVersion)} | sha256 ${esc(rec.scenarioHash.slice(0, 12))} | run ${esc(rec.runId.slice(0, 8))}</span></div>
${missed.length ? `<div class="flag">FLAGGED FOR EVALUATOR DISCRETION: ${missed.length} critical item(s) marked MISSED. Not an automatic fail.</div>` : ""}
${sec("Critical actions (instructor discretion)", table(["Status", "Item", "Time"], crit))}
${sec("Scenario flow - expected actions", `<table><tbody>${flowRows}</tbody></table>`, "time = scenario clock")}
${sec("Branches / examiner options taken", table(["Time", "Type", "IF -> THEN"], branches))}
${sec("Vitals given", table(["Time", "Stage", "Vital", "Value"], vit))}
${sec("Notes", table(["Time", "Note"], notes))}
${sec("Learn more", `<div class="pad">${esc(learnPrompt(sc.source))}<br><span class="muted">OpenEvidence: https://www.openevidence.com</span></div>`)}
${sec("Event log", table(["#", "Time", "Event"], log))}
<footer>${esc(FOOTER)}</footer>
</body></html>`;
}

export function fileStem(rec: RunRecord): string {
  const who = (rec.trainee || "trainee").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${rec.scenarioId || "scenario"}_${who}_${rec.date}_${rec.runId.slice(0, 8)}`;
}

/** Parse + sanity-check an exported run file (Runs screen). */
export function parseRunFile(text: string): RunRecord {
  const r = JSON.parse(text) as RunRecord;
  if (r?.format !== "scenario-runner-run" || !Array.isArray(r.events)) throw new Error("not a Scenario Runner run file");
  return r;
}
