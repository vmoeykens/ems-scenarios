# Scenario Runner - Build Spec

Companion web app for the EMS scenario sheets. It reads the same scenario JSON that `tools/ems_scenario.py` renders to PDF and adds interactivity for the instructor (and a student-facing display).

Origin: viability assessment + Claude Code prompt from the "EMS Scenarios" claude.ai project (Nov 2026), updated for format changes made afterwards (scene safety removed, `moulage_tags`, `learn_more` / OpenEvidence QR card, `cue` on show cards and tags, examiner `inject` branches).

## Context

- Users: instructors running AEMT crew-chief-in-training (CCIT) scenarios at **UVM Rescue** (Vermont). Scenarios follow VT Statewide EMS Protocols 2025 (`docs/reference/eprip-2025-EMS-Protocols_0.pdf`).
- Content source of truth: `scenarios/*.json` (CARD-01, MED-01..03, TRA-01..03, ARR-01..03).
- Print path: `python3 tools/ems_scenario.py scenarios/X.json X.pdf` (needs reportlab, matplotlib, numpy, segno, Graphviz `dot`). It **validates first** and refuses to build on problems. The PDF and the app must keep working from the same JSON.
- Authoring rules for scenario content: `docs/scenario-authoring-standard.md` (the skill used to write the scenarios). Read it before touching JSON - it defines the schema, the "no hints on card faces" rule, AEMT scope limits, stage-letter conventions, etc.

## Viability notes (decisions already made)

1. Start single-device: instructor app + "student screen" button that opens a second window (second monitor / projector). No server.
2. Branches are currently text ("-> Stage **C**"). Add machine-readable links (`goto_stage`, `goto_phase`) and IDs, backward compatible.
3. One definition of the format: a single JSON Schema in the repo; both the app and the Python generator check against it (or at least never disagree).
4. Results saved in-browser (IndexedDB) + export files. No accounts/backend in v1.
5. No real patient data. Keep the "simulated, not for patient care" footer.
6. Phone-to-phone sync later via a pluggable transport (Supabase Realtime with a 6-digit room code is the likely choice). Not in v1.

## Stack

- Vite + React + TypeScript. Static build, deployable to any static host (GitHub Pages is fine).
- PWA, offline after first load (training rooms / rigs have poor signal).
- Tailwind for styling.
- ajv (or zod generated from the schema) validating against `schema/scenario.schema.json`.

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

- **Library**: scenarios grouped by category (Medical / Trauma / Cardiac / Cardiac arrest), with difficulty, run time, protocols. Bundled scenarios from `scenarios/` + import a JSON via file picker/drag-drop (validated, stored in IndexedDB).
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
- **Runs** screen: past runs per trainee from IndexedDB.

## Phase 2 - Student display

- "Open student screen" opens `/display` in a new window. Sync via BroadcastChannel behind a `SyncTransport` interface so WebSocket/Supabase can drop in later (don't build those now).
- Looks like a simple patient monitor: black background, large numerals for revealed vitals only (unrevealed = "--"), animated ECG and capnography when the current stage/card specifies them, plus a card viewer for pushed show cards (text cards in large type; 12-lead/strip/capno rendered).
- Port ECG/capno synthesis from `tools/ems_scenario.py` (`ecg()`, `twelve_png()`, `strip_png()`, `capno_png()`) to TypeScript on `<canvas>`: same rhythms (sinus, afib, svt, vt, vf, asystole, chb with p_rate, avb1, flutter with p_rate), same per-lead R/S/T/P amplitudes and ST-shift model, same capno patterns (normal, shark, cpr). Static render for cards, scrolling sweep for the live monitor. Label everything "SIMULATED".
- The student display must never show instructor-only content: cues, stage names/triggers, branch text, critical list, differentials.

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
