# Scenario Runner - Plan

Status: **Phase 0 done (schema, shared validator, generator compat, goto_stage upgrade). Stopped for review before Phase 1.**
Spec: `docs/SPEC.md`. Content rules: `docs/scenario-authoring-standard.md`.

## 1. Repo layout (after Phase 0)

```
schema/scenario.schema.json      one JSON Schema (draft 2020-12) for the format
src/lib/scenario/                types.ts, normalize.ts (default ids/keys), learn.ts (OpenEvidence prompt), bundled.ts, constants.ts
src/lib/validate/                index.ts (ajv + rules), rules.ts (mirror of Python validate())
scripts/validate.ts              npm run validate
tools/ems_scenario.py            PDF generator + validator (minimal compat changes only)
tools/build_pdfs.py              npm run pdf -> out/*.pdf + page checks
tests/                           vitest: validator.test.ts, normalize.test.ts, fixtures/ (good + bad)
src/App.tsx                      Phase 0 placeholder (lists bundled scenarios + validity)
```

Commands: `npm run validate`, `npm test`, `npm run pdf`, `npm run dev`, `npm run build`.

## 2. JSON Schema outline (`schema/scenario.schema.json`)

Describes the format exactly as the 10 files use it, plus the optional Runner fields. `title` is the only required top-level key.

| Key | Shape | Notes |
|---|---|---|
| `id` | string `^(CARD\|MED\|TRA\|ARR\|PED\|OB\|ENV)-NN$` | authoring-standard prefixes |
| `title, version, category, level, run_time, difficulty, crew, resources, dispatch, vitals_note` | string | |
| `protocols, objectives, debrief` | string[] | |
| `scene` | object of strings, rendered in key order; **`safety: false`** | any key except `safety` |
| `patient` | `{name, age, sex, weight_kg, cc, on_arrival}` | age/weight string or number |
| `history` | `{SAMPLE: [[k,v]...], OPQRST: [[k,v]...]}` | |
| `primary, secondary` | `[[label, finding], ...]` | |
| `vitals[]` | `{stage (req), key?, trigger, HR, BP, RR, SpO2, EtCO2, BGL, Temp, Pain, GCS, Pupils, other, bold[]}` | cells string or number; `key` `^[A-Z]$` (default = first char of `stage`); `bold` items from the column enum |
| `blank_vitals_rows` | integer >= 0 | |
| `flow[]` | `{id?, time, phase, give, expected[] (>=1, req), branches[]}` | `id` default `p<index>` |
| `flow[].expected[]`, `critical[]` | string **or** `{id, text}` | |
| `flow[].branches[]` | `{if (<=75), then, type?: "inject", goto_stage?, goto_phase?, id?}` | `additionalProperties: false` (same as the Python key check) |
| `differentials` | `[[dx, supports, against], ...]` | exactly 3 |
| `crew_card` | `{dispatch, on_arrival}` | |
| `actor_card` | object of strings, key order | |
| `show_cards[]` | discriminated on `type`: `12lead` (rhythm, rate, p_rate, st{lead: mm}), `strip` (rhythm, rate, p_rate, lead, st mm, seconds, width), `capno` (pattern normal\|shark\|cpr, etco2, rr, width), `text` (body, width), `image` (path req, caption, width); all have `title`, `cue`; non-text have `caption` | rhythm enum = generator RHYTHMS; lead enum = 12 leads |
| `moulage_tags[]` | `{region, text, cue?}` | region + text required |
| `learn_more` | `{topic?, focus?}` **or** `{prompt}` (<= 480) | |

Objects are closed (`additionalProperties: false`) except `scene` and `actor_card` (free keys, string values).
Unknown keys are therefore rejected by the app; see open question Q1.

## 3. Shared validator (`src/lib/validate/rules.ts`)

`validateScenario(data)` = ajv schema errors (`/json/pointer: message`) + rule errors. Rules are a line-for-line mirror of `validate()` in `tools/ems_scenario.py`: **same checks, same order, same message text** (Python `str()`/`repr()` formatting reproduced). `tests/validator.test.ts` runs the real Python `validate()` and `learn_prompt()` on all 10 scenarios + 23 fixtures and asserts identical output (skips only if python3/deps are missing).

| # | Rule (Python message stem) | Also in schema? |
|---|---|---|
| 1 | `duplicate vitals stage letters: [...]` (letter = `key` or first char of `stage`) | no |
| 2 | `duplicate flow ids: [...]` (id = `id` or `p<i>`) **new** | no |
| 3 | `critical item object needs text` **new** | yes (required) |
| 4 | `flow 'X': no expected actions` | yes (required, minItems 1) |
| 5 | `flow 'X': expected item object needs text` **new** | yes |
| 6 | `unknown branch keys {...}` (allowed: if, then, type, goto_stage, goto_phase, id) | yes |
| 7 | `branch type must be omitted or 'inject'` | yes (const) |
| 8 | `branch missing if/then` | yes (required) |
| 9 | `IF '...' is not a condition` (starts with "stage" / "advanced option") | no |
| 10 | `IF text > 75 chars` | yes (maxLength) |
| 11 | `references Stage X but vitals has [...]` (regex `Stage \*\*X\*\*` or `Stage X\b` in THEN) | no |
| 12 | `goto_stage X is not a vitals stage [...]` **new** | pattern only |
| 13 | `goto_stage X disagrees with THEN text Stage [...]` **new** (only when THEN has a Stage ref) | no |
| 14 | `goto_phase X is not a flow id [...]` **new** | no |
| 15 | `use 'critical (evaluator discretion)'` (`critical fail` / `miss = fail`) | no |
| 16 | `show card '...': instructor hint on card face ('...')` (LEAK regex on title+caption+body) | no |
| 17 | `show card type X` | yes (enum) |
| 18 | `bad rhythm X` (12lead/strip) | yes (enum) |
| 19 | `scene.safety present ...` | yes (`safety: false`) |
| 20 | `moulage tag needs region + text` | yes (required) |
| 21 | `moulage tag '...': instructor hint on tag ('...')` | no |
| 22 | `learn_more prompt N chars > 480` (after templating, code-point length) | `prompt` override only |

Invariant (tested): anything Python rejects, the shared validator rejects. The reverse is not guaranteed (schema is stricter: types, unknown keys) - Q1.

## 4. Generator changes (Phase 0, `tools/ems_scenario.py`)

Minimal, no layout changes. All 50 pages of the 10 PDFs are pixel-identical at 75 dpi before/after (also after the goto_stage JSON upgrade).
- `_txt()` helper: `checklist()` and the flowchart spine render `{id, text}` items by `text`.
- `validate()`: allowed branch keys + `goto_stage`, `goto_phase`, `id`; stage letter honours `vitals[].key`; rules 2, 3, 5, 12, 13, 14 above.
- `_stage_row()`: prefers `branch.goto_stage` over the THEN regex, and matches `vitals[].key` when set. Identical output for current files (validator guarantees goto_stage == THEN ref).
- New `tools/build_pdfs.py` (npm run pdf): builds every scenario to `out/` and checks 5 pages / p.3 "DECISION FLOWCHART" / p.4 "HANDOUTS".

## 5. Visual design - "paper on the web" (SPEC.md "Visual design")

- Tailwind v4 theme in `src/index.css` (`@theme`): default colors, shadows, fonts and radii are reset (`--color-*: initial` etc.), so only these exist: greyscale `paper / ink / rule / head (#e0e0e0) / zebra (#f2f2f2) / cue`, accents `alert` (MISSED, flagged run, import errors), `live` (running clock only), `active` (current phase/stage marker), `pushed` (item currently on the student display), and `monitor-bg / monitor-fg / monitor-wave` for `/display` only. Font: Helvetica/Arial. Radius: `xs` = 2 px only.
- Component classes reproduce the PDF primitives: `.section` + `.section-bar` (black bar, white uppercase title, optional right-hand italic note as in `section(right=...)`), `.sheet-table` (+ `.zebra`), `.box` (square checkbox), `.cut` (dashed cut line), `.cue` (italic dark-grey instructor text), `.sheet-btn` (flat, bordered, >= 44 px).
- Screens follow the sheet's sections and order: Pre-brief = p.1 top (header strip, Protocols/Objectives/Resources, Dispatch, Scene/setup, Patient | SAMPLE + OPQRST); Run = p.1 Primary / Secondary / Vitals progression + p.2 Scenario flow, Critical actions | Differentials; Flowchart view = p.3 (render the same Graphviz-style layout as an interactive SVG: tap a diamond/hexagon = log branch); Handouts = p.4 (crew card, actor card, show cards with cue above a dashed cut line); Moulage + Learn more = p.5; Debrief = p.2 bottom (Debrief prompts | Result).
- Interactions stay flat: tap-to-reveal vital = dashed grey cell -> solid value in the vitals table row; checked items get a small timestamp in the "Time / init" column like the paper; branch rows are the IF -> THEN lines turned into bordered buttons; examiner options keep the `head` shading; modals = bordered boxes with a black title bar.
- Print stylesheet (`@media print`): letter, 0.4 in margins, accents forced to black + bold, `.no-print` chrome hidden; the debrief HTML export uses it.

## 6. Phase 1 - Instructor console (routes + components)

Router: hash routes (static hosting, no server rewrites). PWA via `vite-plugin-pwa` (precache all assets + bundled scenarios).

| Route | Screen | Main components |
|---|---|---|
| `#/` | Library | `CategoryGroup` (Medical / Trauma / Cardiac / Cardiac arrest), `ScenarioCard` (id, title, difficulty, run time, protocols, validity badge), `ImportDropzone` (file picker + drag-drop -> `validateScenario` -> in-memory for the session; shows schema/rule errors verbatim) |
| `#/s/:id/prebrief` | Pre-brief tab | `ReadAloud` (dispatch, large type), `SceneSetup`, `Resources`, `Objectives`, `ActorCard`, `MoulageChecklist` (tags with cues; setup checkboxes) |
| `#/s/:id/run` | Run tab | `ScenarioClock` (start/pause/reset, T+mm:ss), `FlowTimeline` (`PhaseCard`: give text, `BranchButton` crew IF->THEN, `InjectButton` examiner option visually distinct/shaded hexagon icon), `ExpectedChecklist` (tap = check+timestamp, long-press = uncheck), `VitalsPanel` (`StageSwitcher`, `VitalTile` tap-to-reveal, bold keys highlighted, `AdLibEntry`), `HistoryPanel` (SAMPLE/OPQRST/primary/secondary, tap = asked/assessed), `ShowCardList` (cue visible, "Show" pushes face), `MoulageTagList` ("Show" pushes region+text, never cue), `CriticalList` (MET / MISSED -> "evaluator discretion" flag), `Notes` + `QuickNotes`, `StudentScreenButton` |
| `#/s/:id/debrief` | Debrief tab | `EventTimeline`, `CompletionStats` (% expected checked), `CriticalMisses`, `DifferentialsTable`, `DebriefPrompts`, `ResultForm` (Pass / Remediate / Fail, trainee, evaluator, date), `LearnMoreCard` (`learnPrompt()` + copy + local QR via a JS QR lib, prompt + openevidence.com), `ExportButtons` (JSON run record, CSV events, printable B&W HTML) |
| `#/runs` | Runs | `RunFileOpener`: open exported run JSON file(s) -> read-only debrief, grouped by trainee (no stored history) |
| `#/display` | Student display (Phase 2) | see below |

Layout: tablet-first, tabs at the bottom (one-handed), touch targets >= 44 px, paper theme (section 5), `Footer` (exact footer string) on every screen and export.
Branch tap: log `branch` event; if `target_stage` (goto_stage, else Stage ref) -> set current stage (logged); if `goto_phase` -> set current phase. No automatic phase advance otherwise (instructor advances: "crew action OR clock, whichever first").

## 7. Phase 2 - Student display

`#/display` opened via `window.open` from the console. The one deliberate exception to the paper look (Q13): black monitor UI (`monitor-bg/fg`, waveforms in the single `monitor-wave` accent): numerals for **revealed** vitals only (others "--"); live ECG sweep + capno on `<canvas>`; card viewer for pushed show cards (text cards large type; 12-lead/strip/capno rendered). Everything labelled "SIMULATED".
`src/lib/waveforms/`: TS port of `ecg()`, `beat_times()`, `LEADS`, ST model, `capno` patterns from the generator; seeded RNG (port numpy's default_rng is impractical -> use a small seeded PRNG; shapes match, exact samples won't). Tests check output shape (length = dur*500, no NaN, VF/asystole have no beats, ST shift visible in V-leads).
**Only display-safe payloads cross the transport** (typed `DisplayMessage`, built by a single `toDisplay()` function): vital values, card face (`title/caption/body` + waveform params), tag `region/text`. Never: `cue`, stage names/triggers, `other`, branches, critical, differentials. A test asserts no instructor-only strings from any scenario appear in any `DisplayMessage` produced during a scripted run.

## 8. State / event-log model

Event-sourced: the run is an append-only log; UI state = `reduce(log)`. Gives timestamps, undo (append an inverse event), exports and replay for free.

```ts
type RunEvent = { seq: number; t: number /* ms since clock start (pauses excluded) */; wall: string /* ISO */ } & (
  | { kind: "clock"; action: "start" | "pause" | "resume" | "reset" }
  | { kind: "phase"; phaseId: string }
  | { kind: "stage"; stageKey: string; via?: string /* branch id */ }
  | { kind: "branch"; phaseId: string; branchId: string; inject: boolean }
  | { kind: "expected"; itemId: string; checked: boolean }
  | { kind: "reveal"; stageKey: string; vital: VitalKey; value: string; adlib?: boolean }
  | { kind: "history"; section: "SAMPLE" | "OPQRST" | "primary" | "secondary"; index: number; done: boolean }
  | { kind: "card"; cardIndex: number; action: "show" | "hide" }
  | { kind: "tag"; tagIndex: number; action: "show" | "hide" }
  | { kind: "critical"; itemId: string; status: "met" | "missed" | null }
  | { kind: "note"; text: string; quick?: boolean }
);
interface RunRecord {
  runId: string; scenarioId: string; scenarioVersion: string; scenarioHash: string; // sha-256 of the JSON used
  trainee?: string; evaluator?: string; date: string;
  result?: "pass" | "remediate" | "fail"; events: RunEvent[]; app: string; footer: string;
}
```

Ids come from `normalize()` (explicit ids where present, else `p<i>`, `p<i>.e<j>`, `p<i>.b<j>`, `crit<i>`), so logs stay meaningful if a scenario is re-ordered only when explicit ids are used (Q5).
Storage: stateless, no IndexedDB/backend (user decision). Run state in memory; the in-progress RunRecord is autosaved to a single localStorage key on every event (refresh/crash recovery, offer "resume run?" on load), cleared on export/discard. Imported scenarios are session-only. History = exported files. CSV = one row per event.
State: `useReducer` + context per run (no Redux). Clock derived from clock events + `performance.now()`.

## 9. SyncTransport

```ts
export interface SyncTransport {
  readonly kind: "broadcast" | "websocket" | "supabase";
  connect(room: string): Promise<void>;          // BroadcastChannel: channel name = `scenario-runner:${room}`
  send(msg: DisplayMessage): void;               // console -> display (display-safe payloads only)
  onMessage(cb: (msg: DisplayMessage | ControlMessage) => void): () => void; // returns unsubscribe
  close(): void;
}
type DisplayMessage =
  | { type: "state"; snapshot: DisplaySnapshot }  // full state: sent on connect + after every change (idempotent, late joiners ok)
  | { type: "hello"; role: "display" };           // display -> console, asks for snapshot
interface DisplaySnapshot {
  vitals: Partial<Record<VitalKey, string>>;      // revealed only, markup stripped
  monitor?: { rhythm: Rhythm; rate: number; p_rate?: number; capno?: { pattern: string; etco2: number; rr: number } };
  card?: { kind: ShowCard["type"]; title?: string; caption?: string; body?: string; wave?: object } | null;
  tag?: { region: string; text: string } | null;
  scenarioTitle?: string;                         // optional; Q8
}
```
v1 implements `BroadcastChannelTransport` only (same browser, second window). Snapshots rather than deltas keep a later WebSocket/Supabase room (6-digit code) trivial.

## 10. Tests

- Phase 0 (done): vitest - all 10 pass; 21 bad fixtures fail with the exact Python messages; Python cross-check on all 33 files (rule errors + learn prompt); normalize defaults/explicit ids; every branch target resolves.
- Phase 1/2: branch navigation reducer, event logging/undo, export shape, `toDisplay()` leak test, waveform shape; Playwright smoke (load scenario, start clock, reveal BP, push card, display window updates, export debrief).

## 11. Open questions for the user

1. **Strictness vs the PDF generator.** The schema rejects unknown keys and wrong types; `ems_scenario.py` silently ignores unknown keys outside branches. So a file can build a PDF but fail `npm run validate` (never the reverse). Keep it that way (catches typos like `expeted`), or should the generator also check the JSON Schema (adds a `jsonschema` pip dependency)?
2. **IF length**: authoring standard says <= 60 chars, generator enforces 75. I mirrored 75. Tighten both to 60?
3. **Branches with outcome vitals but no stage row** (left without `goto_stage`): CARD-01 "No action within 2 min" -> "BP 74/44, GCS 13" (Stage C is 82/50); ARR-03 inject "Pt re-sedates en route" -> "RR 6, SpO2 84%, EtCO2 58". Add stage rows (F) + `goto_stage`? That is a content change, so your call.
4. **Inject branches that cite stage values** ("Stage **C** values; expect ..." in TRA-01, "Stage **B** values" in TRA-02, MED-02 stridor, TRA-03 BP drop) now carry `goto_stage`, so tapping them will switch the vitals stage. Is that what you want for examiner injects?
5. **Explicit ids**: none of the files have `flow[].id` / item ids, so run logs use index ids (`p2.e1`). If you later edit a scenario that has past runs, old logs may point at the wrong item. Add explicit ids to all 10 now (structural commit), or accept index ids + store the scenario hash/version in each run (planned either way)?
6. **`goto_phase`**: nothing in the text links branches to phases, so none were added. Should a branch ever auto-advance the phase, or does the instructor always advance manually?
7. **Live monitor rhythm**: vitals rows have no rhythm/capno fields (rhythm is only in `other` text, e.g. "**VF** - shock advised"). For the Phase 2 animated monitor, either (a) add optional `vitals[].monitor: {rhythm, rate, p_rate?, capno?: {pattern, etco2}}` (structural, generator ignores it), or (b) drive the monitor only from the last pushed strip/12-lead/capno card. I recommend (a).
8. **`other` column on the student display**: it mixes patient findings with instructor notes ("Point to capno; no ROSC until fixed", "(show 12-lead card)"), so the plan never sends it to the display; skin/lung findings reach the crew via moulage tags or verbally. OK? And may the display show the scenario title (it can hint the diagnosis, e.g. "Anaphylaxis")? Default: no title.
9. **Image show cards**: unused today; `path` is a local file path the browser can't load from an imported JSON. Bundle under `public/scenario-assets/` and/or allow `data:` URIs?
10. **Trainee/evaluator names** in the autosaved run and exports: fine to store locally (staff names, no patient data)? Any retention rule?
11. ~~Hosting~~ Decided: GitHub Pages via Actions on push to `main` (vmoeykens/ems-scenarios).
12. **Bundle**: ajv compiles the schema at runtime (uses `new Function`; ~455 kB JS now). If you plan a strict Content-Security-Policy, I'll switch to ajv's precompiled standalone validator in Phase 1.
13. **Student display look**: per the paper-on-the-web direction, every screen is greyscale paper except `/display`, which I plan to keep as a patient-monitor (black background, large white numerals, waveforms in one green accent) because that is what the crew would see on a real monitor and it reads well on a projector. Confirm, or should the display also be paper-style (white background, black numerals/waveforms like the printed show cards)?
14. **Accent set**: four accents (`alert` red, `live` green, `active` blue, `pushed` amber) as tabled in SPEC.md. OK, or fewer (e.g. drop `pushed` and mark pushed items with a black outline)?
