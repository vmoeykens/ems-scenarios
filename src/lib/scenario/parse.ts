// Tolerant scenario-text parsing for the import box and file uploads.
// Trainers often paste a whole chat reply ("Here is your JSON: ```json {...} ``` Let me know..."),
// so we strip a BOM, prefer the first ``` fenced block, and otherwise take the outermost {...}.
// JSON syntax errors are reported with line/column and the offending line.

export type ParseResult =
  | { ok: true; data: unknown; json: string; cleaned: boolean }
  | { ok: false; error: string; line?: number; col?: number; snippet?: string };

/** Extract the JSON object text from pasted/uploaded text. Returns null if there is no `{`. */
export function extractJsonText(raw: string): { json: string; cleaned: boolean } | null {
  const t = raw.replace(/^﻿/, "").trim();
  if (!t) return null;
  let body = t;
  const fence = t.match(/```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/);
  if (fence && fence[1].includes("{")) body = fence[1];
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0) return null;
  const json = b > a ? body.slice(a, b + 1) : body.slice(a);
  return { json, cleaned: json.trim() !== t };
}

function lineCol(text: string, pos: number): { line: number; col: number } {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  return { line, col };
}

export function parseScenarioText(raw: string): ParseResult {
  const ex = extractJsonText(raw);
  if (!ex) return { ok: false, error: "No JSON object found - paste text that contains the scenario starting with '{'." };
  try {
    return { ok: true, data: JSON.parse(ex.json), json: ex.json, cleaned: ex.cleaned };
  } catch (e) {
    const msg = (e as Error).message;
    let line: number | undefined;
    let col: number | undefined;
    const lc = msg.match(/line (\d+) column (\d+)/);
    const pos = msg.match(/position (\d+)/);
    if (lc) {
      line = Number(lc[1]);
      col = Number(lc[2]);
    } else if (pos) {
      ({ line, col } = lineCol(ex.json, Number(pos[1])));
    } else if (/Unexpected end of JSON input/i.test(msg)) {
      ({ line, col } = lineCol(ex.json, ex.json.length));
    }
    const lines = ex.json.split("\n");
    const snippet = line && line <= lines.length ? lines[line - 1].slice(Math.max(0, (col ?? 1) - 60), (col ?? 1) + 40) : undefined;
    const clean = msg.replace(/^JSON\.parse: /, "").replace(/ in JSON at position \d+.*$/, "").replace(/ \(line \d+ column \d+\)$/, "");
    const where = line ? ` (line ${line}, column ${col})` : "";
    return { ok: false, error: `Invalid JSON${where}: ${clean}`, line, col, snippet };
  }
}
