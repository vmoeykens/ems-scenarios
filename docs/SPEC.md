# Scenario Runner - Build Spec

Companion web app for the EMS scenario sheets. It reads the same scenario JSON that `tools/ems_scenario.py` renders to PDF and adds interactivity for the instructor (and a student-facing display).

Origin: viability assessment + Claude Code prompt from the "EMS Scenarios" claude.ai project (Nov 2026), updated for format changes made afterwards (scene safety removed, `moulage_tags`, `learn_more` / OpenEvidence QR card, `cue` on show cards and tags, examiner `inject` branches).

## Context

- Users: instructors running AEMT crew-chief-in-training (CCIT) scenarios at **UVM Rescue** (Vermont). Scenarios follow VT Statewide EMS Protocols 2025 (text: `docs/reference/eprip-2025-EMS-Protocols-text.txt`; PDF: `public/protocols/vt-ems-protocols-2025.pdf`).
- Content source of truth: `scenarios/*.json` (CARD-01, MED-01..03, TRA-01..03, ARR-01..03).
- Print path: `python3 tools/ems_scenario.py scenarios/X.json X.pdf` (needs reportlab, matplotlib, numpy, segno, Graphviz `dot`). It **validates first** and refuses to build on problems. The PDF and the app must keep working from the same JSON.
- Authoring rules for scenario content: `docs/scenario-authoring-standard.md` (the skill used to write the scenarios). Read it before touching JSON - it defines the schema, the "no hints on card faces" rule, AEMT scope limits, stage-letter conventions, etc.

## Viability notes (decisions already made)

1. Start single-device: instructor app + "student screen" button that opens a second window (second monitor / projector). No server.
2. Branches are currently text ("-> Stage **C**"). Add machine-readable links (`goto_stage`, `goto_phase`) and IDs, backward compatible.
3. One definition of the format: a single JSON Schema in the repo; both the app and the Python generator check against it (or at least never disagree).
4. **Stateless, no backend, no database.** Static files only (GitHub Pages). Nothing is stored server-side; there is no IndexedDB. A run lives in memory; the only browser storage is one localStorage key autosaving the in-progress run (crash/refresh recovery), cleared when the run is exported or discarded. Results leave the app as export files (JSON / CSV / print).
5. No real patient data. Keep the "simulated, not for patient care" footer.
6. Phone-to-phone sync later via a pluggable transport (Supabase Realtime with a 6-digit room code is the likely choice). Not in v1.

## Stack

- Vite + React + TypeScript. Static build, deployable to any static host (GitHub Pages is fine).
- Offline after first load (training rooms / rigs have poor signal): a small network-first service worker (`public/sw.js`, registered relative to the page) instead of a full PWA plugin; no manifest/installability.
- Tailwind for styling.
- ajv (or zod generated from the schema) validating against `schema/scenario.schema.json`.

## Visual design - "paper on the web"

User requirement (Nov 2026): "The UI of the application should match the paper one relatively closely - imagine 'paper on the web'. Still add nice interactivity and other web UI tools, but keep the simple look, broadly greyscale except for very specific pointed places."

- **Instructor UI mirrors the PDF sheet** (`tools/ems_scenario.py`): white page, black text, Helvetica/Arial-style sans, dense layout; black section header bars with white UPPERCASE titles; thin black grid lines; light-grey (#e0e0e0) table header rows; zebra rows (#f2f2f2); square checkboxes; **bold** for abnormal/key values; dashed lines where the paper has cut lines. Same section names and order as the PDF pages: p.1 setup / patient / vitals, p.2 flow / critical / differentials / debrief, p.3 decision flowchart, p.4 handouts / show cards, p.5 moulage tags + learn-more.
- **Interactivity fits the paper look**: tap-to-reveal, timestamped checkboxes, clock, branch buttons, modals, tooltips, drag-drop import are all flat: no shadows, no gradients, no rounded "app" chrome beyond a minimal 2 px, no decorative color. Controls look like the sheet's own elements (a branch button = the IF -> THEN row with a border; a vital tile = a table cell).
- **Palette**: greyscale tokens only, plus a small set of named semantic accents. The Tailwind theme removes the default color palette, so nothing else is available.

  | Token | Value | Use |
  |---|---|---|
  | `paper` | #ffffff | page background |
  | `ink` | #000000 | text, grid lines, section bars, checkboxes |
  | `rule` | #8c8c8c | secondary rules, writing lines, muted text (PDF GREY) |
  | `head` | #e0e0e0 | table header rows, examiner-option shading (PDF LIGHT) |
  | `zebra` | #f2f2f2 | alternate table rows |
  | `cue` | #404040 | instructor-only cue text (italic, as in the PDF scrap strips) |

  | Accent | Value | Allowed only for |
  |---|---|---|
  | `alert` | #b91c1c | critical item marked MISSED; the run's "flagged for evaluator discretion" banner; validation errors on import |
  | `live` | #15803d | the scenario clock while running (dot + digits); nothing else |
  | `active` | #1d4ed8 | marker for the current flow phase and current vitals stage (left bar / outline) |
  | `pushed` | #b45309 | small marker on an item currently shown on the student display (vital, card, tag) |

  Revealed vs hidden vitals is greyscale first (hidden = dashed grey cell "tap", revealed = solid value); `pushed` is only added if testing shows that is ambiguous. Any new accent needs a row in this table.
- **Print**: a print stylesheet renders the screens as the paper sheet: accents become black (MISSED prints as bold "MISSED"), interactive chrome hidden, footer kept. The debrief summary export uses the same stylesheet.
- **Student display exception** (confirmed Nov 2026): the `/display` MONITOR view keeps the patient-monitor look (black background, large white numerals); waveforms use a single accent (`monitor-wave`). This is the only dark/colored screen. The display's INFO / CARDS view is paper-style.

## User decisions (Nov 2026, before Phase 1)

1. **Stateless**: no backend, no DB, no IndexedDB; static GitHub Pages (relative base + hash routes). Run state in memory + one localStorage autosave key for the in-progress run (resume prompt on load; cleared on export/discard). Imported scenarios are session-only. Runs screen = open exported run JSON files. Exports: JSON run record, CSV events, printable B&W HTML summary.
2. **Paper on the web** for all instructor screens (section names/order as the PDF), greyscale except the four accents below; print stylesheet ~= the paper sheet.
3. **Student screen** = separate window `#/display` with two crew-switchable views (large tabs): **MONITOR** (default; black monitor, large numerals for revealed vitals only, `--` otherwise, live ECG + capno sweep, labelled SIMULATED) and **INFO / CARDS** (paper: crew card from the start + pushed show cards / moulage tag findings, newest first, persisting for the run; 12-lead/strip/capno rendered static). The instructor can push a card and optionally auto-switch the display to INFO. Only `toDisplay()` builds what crosses the transport; a leak test covers every scenario.
4. **Monitor per stage**: optional `vitals[].monitor: {rhythm, rate, p_rate?, st?, capno?: {pattern, etco2, rr}}` (schema + app validator; the PDF generator ignores it). Populated for every stage of the 10 scenarios from what each already states. The display monitor follows the selected stage; pushing a strip/capno card overrides until the stage changes.
5. **Branches** with `goto_stage` switch the vitals stage when tapped, including examiner injects. No automatic phase advance (instructor advances; `goto_phase` is honoured if present).
6. Keep: IF length 75; app validator stricter than the generator; index ids + scenario sha-256 in each run record; images (if ever used) bundled under `public/scenario-assets/`.

## Protocol viewer (Nov 2026 request)

User request: "Embed the current VT EMS protocols PDF in the web app; when scenarios reference a protocol, hyperlink it to a pop-out or sidebar showing that protocol."

- **PDF**: `public/protocols/vt-ems-protocols-2025.pdf` (official file: https://www.healthvermont.gov/sites/default/files/document/eprip-2025-EMS-Protocols_0.pdf; the document permits reproduction and distribution). Not committed yet - the user adds it. The app works without it: one same-origin HEAD request at start decides; if the file is missing, protocol links are plain links to the official PDF in a new tab (the only external link; no other runtime network calls).
- **Viewer**: pdf.js (`pdfjs-dist`, worker bundled locally as a hashed asset, relative-base safe), loaded with `import()` only when the first protocol is opened. Right-side drawer on wide screens (>= 1280 px), full-screen sheet on tablets; opens at the protocol's first page; prev/next page, zoom, "Open full PDF" (new tab at that page), close (Esc). Chrome is paper/greyscale; the PDF itself renders in its own colors (its provider-level color coding matters).
- **Index**: `src/data/protocol-index.json` = `{ "<number>": { title, page } }`, seeded from the TOC of `docs/reference/eprip-2025-EMS-Protocols-text.txt` (a text extraction; 127 entries incl. 5.x, 9.x, A.1-A.8; `page: null`). `scripts/build-protocol-index.ts` (`npm run protocol-index`, also `prebuild`) reads the real PDF with pdfjs-dist and fills `page` (title words + Adult/Pediatric + base number on a non-TOC page); it skips quietly when the PDF is absent. If a page is still null, the viewer runs the same text search in the browser at open time.
- **Linkify** (`src/lib/protocols/refs.ts`): protocol numbers in any scenario text rendered through `Md` on instructor screens (protocols list, flow give/expected/branches, critical, objectives, debrief, differentials, history ...) become links: `3.0A`, `(2.8A)`, `per 2.24A`, `4.9`, `8.15`, `2.22A/P` (two links), `A.1`. Only numbers present in the index link; doses/volumes/temps/versions/times never do (unit lookahead + index check; tested on all scenario text). The student display has no protocol provider, so it never shows links.

## Deployment

- GitHub Pages, built by GitHub Actions (`.github/workflows/pages.yml`) on every push to `main`: `npm ci`, `npm run validate`, `npm test`, `npm run build`, deploy `dist/`. Also runnable manually (workflow_dispatch).
- Relative `base` + hash routes, so it works from the `/ems-scenarios/` sub-path with no server rewrites.
- Adding or editing a scenario = commit the JSON to `scenarios/` on `main`; the site redeploys automatically.

## Phase 0 - Schema (STOP for review after this phase)

1. Write `schema/scenario.schema.json` describing the current format exactly as the 10 files use it: `id, title, version, category, level, run_time, difficulty, crew, protocols, objectives, resources, dispatch, scene{...}, patient, history.SAMPLE/OPQRST, primary, secondary, vitals[], vitals_note, blank_vitals_rows, flow[] (time, phase, give, expected, branches[] with optional type:"inject"), critical, differentials, debrief, crew_card, actor_card, show_cards[] (12lead | strip | capno | text | image, each with optional cue), moulage_tags[] {region, text, cue?}, learn_more {topic, focus} | {prompt}`.
   Encode the generator's validation rules where JSON Schema can (rhythm enum, show-card type enum, branch type, no `scene.safety`). Rules it can't express (stage-letter references, card-face hint regex, learn_more prompt <= 480 chars) go in a shared TS validator that mirrors `validate()` in `tools/ems_scenario.py`.
2. Optional, backward-compatible fields:
   - `vitals[].key` (e.g. "A"); default = first char of `stage`.
   - `flow[].id`; default = index-based (`p0`, `p1`...).
   - `flow[].expected[]` items: string OR `{id, text}`.
   - `flow[].branches[].goto_stage` (vitals key), `.goto_phase` (flow id), `.id`.
   - `critical[]` items: string OR `{id, text}`.
   App auto-derives keys/ids when absent.
3. **Generator compatibility**: `validate()` in `tools/ems_scenario.py` currently rejects unknown branch keys (`set(b) - {"if","then","type"}`) and `checklist()` assumes strings. Update the generator minimally so it accepts the new optional fields (allow the new branch keys; render `{id,text}` items by their `text`; check `goto_stage` refers to a real stage letter). Do not change layout or other rules. Confirm all 10 PDFs still build and still pass the page checks (5 pages; p.3 contains "DECISION FLOWCHART"; p.4 contains "HANDOUTS").
4. `npm run validate`: validate every file in `scenarios/` against the schema + shared rules; non-zero exit on errors. Also add `npm run pdf` (or a Makefile target) that builds all PDFs to `out/`.
5. Upgrade the 10 JSONs: add `goto_stage` to branches by parsing `Stage **X**` in branch `then`. Structural change only - **no clinical content edits**. Produce a reviewable diff (commit it separately).

## Phase 1 - Instructor console (single device, tablet-first, works on laptop)

- **Library**: scenarios grouped by category (Medical / Trauma / Cardiac / Cardiac arrest), with difficulty, run time, protocols. Bundled scenarios from `scenarios/` (built into the app) + import a JSON via file picker/drag-drop (validated, held in memory for the session; to make it permanent, add it to `scenarios/` and redeploy).
- **Pre-brief tab**: dispatch (large "read aloud" text), scene/setup, resources, objectives, actor card, moulage tags checklist (with cues) for setup.
- **Run tab**:
  - Scenario clock (start/pause/reset), T+mm:ss. Every event timestamped relative to start.
  - Flow timeline: current phase highlighted; `give` text; crew branches (IF -> THEN) and **examiner option** injects visually distinct (as in the PDF). Tap = log the branch and jump to `goto_stage` / `goto_phase`.
  - Expected-action checklist per phase: tap to check (timestamp), long-press to un-check.
  - Vitals panel: current stage; each vital (HR, BP, RR, SpO2, EtCO2, BGL, Temp, Pain, GCS, Pupils, other) is a tap-to-reveal tile ("give a value only when obtained"). Reveal pushes to the student display and logs it. Manual stage switch. "Ad lib" entry for custom values. Bold keys highlighted.
  - History panel: SAMPLE/OPQRST, primary/secondary findings; tap to mark "crew asked/assessed".
  - Show cards: list with instructor `cue` visible to the instructor only; "Show" pushes the card face to the student display.
  - Moulage tags: list; "show" can push a tag's finding text (never its cue).
  - Critical actions: mark MET / MISSED. MISSED flags the run for **evaluator discretion** - never an automatic fail (match the PDF wording).
  - Notes (free text) + quick-note buttons.
- **Debrief tab**: event log timeline, checklist completion %, critical misses, differentials table, debrief prompts, result (Pass / Remediate / Fail), trainee + evaluator names, date. Learn-more card: the AEMT-scoped OpenEvidence prompt (same template as `learn_prompt()` in the generator) with copy button + QR (prompt and openevidence.com). Exports: JSON run record, CSV of events, printable B&W HTML summary.
- **Runs** screen: open one or more exported run JSON files to view a read-only debrief or compare runs per trainee. No stored history.

## Phase 2 - Student display

- "Open student screen" opens `#/display` in a new window. Sync via BroadcastChannel behind a `SyncTransport` interface so WebSocket/Supabase can drop in later (don't build those now).
- Two views (decision 3): MONITOR (black, large numerals for revealed vitals only, "--" otherwise, animated ECG lead II + capnography from the current stage's `monitor` or a pushed strip/capno card) and INFO / CARDS (paper; crew card + pushed cards/tags newest first; text in large type; 12-lead/strip/capno rendered static).
- Port ECG/capno synthesis from `tools/ems_scenario.py` (`ecg()`, `twelve_png()`, `strip_png()`, `capno_png()`) to TypeScript on `<canvas>`: same rhythms (sinus, afib, svt, vt, vf, asystole, chb with p_rate, avb1, flutter with p_rate), same per-lead R/S/T/P amplitudes and ST-shift model, same capno patterns (normal, shark, cpr). Static render for cards, scrolling sweep for the live monitor. Label everything "SIMULATED".
- The student display must never show instructor-only content: cues, stage names/triggers, the vitals `other` column, branch text, critical list, differentials, actor card, scenario title.

## Constraints

- No real patient data, no accounts, no analytics, no runtime network calls (QR codes generated locally).
- Do NOT change clinical content in the JSON except the Phase 0.5 structural upgrade.
- Accessible: touch targets >= 44 px, one-handed tablet use, high contrast, usable in daylight.
- Footer on every screen and export: "Simulated training material. Not for patient care. Verify against current VT Statewide EMS Protocols & agency SOPs."
- Tests: vitest for schema validation (all 10 files pass; known-bad fixtures fail with the same reasons as the Python validator), branch navigation, event logging, ECG generator output shape. Playwright smoke: load scenario, start clock, reveal BP, push a card, display window updates, export debrief.

## Workflow

- Read the scenarios, generator and authoring standard first. Propose the schema + component/route plan in `docs/PLAN.md`.
- Do Phase 0, commit, and **stop for the user's review** before Phase 1.
- Commit after each phase on a feature branch. README: run locally, add a scenario, validate, build PDFs, build/deploy, and how JSON maps to PDF and app.
