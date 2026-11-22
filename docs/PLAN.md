# Scenario Runner - Plan

Status: **Phases 0, 1 and 2 done** (branch `app-phase-1-2`). User decisions recorded in SPEC.md "User decisions"; section 11 questions resolved below.
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
| `vitals[]` | `{stage (req), key?, trigger, HR, BP, RR, SpO2, EtCO2, BGL, Temp, Pain, GCS, Pupils, other, bold[], monitor?}` | cells string or number; `key` `^[A-Z]$` (default = first char of `stage`); `bold` items from the column enum |
| `vitals[].monitor` | `{rhythm (req), rate (req), p_rate?, st?, capno?: {pattern, etco2, rr}}` | student-display monitor only; rhythm enum = generator RHYTHMS; `st` = lead II mm; schema-only (generator ignores it, PDFs pixel-identical) |
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
| `review_notes` | string[] | optional author/coordinator notes (`VERIFY: ...`); not printed, never on the student display; instructor pre-brief + import preview only |

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
- New `tools/build_pdfs.py` (npm run pdf): builds every scenario to `out/` and checks 5 pages / p.3 "DECISION FLOWCHART" / p.4 "HANDOUTS" (since the provider-actions page: 6 pages, p.4 "PROVIDER ACTIONS", p.5 "HANDOUTS").

## 5. Visual design - "paper on the web" (SPEC.md "Visual design")

- Tailwind v4 theme in `src/index.css` (`@theme`): default colors, shadows, fonts and radii are reset (`--color-*: initial` etc.), so only these exist: greyscale `paper / ink / rule / head (#e0e0e0) / zebra (#f2f2f2) / cue`, accents `alert` (MISSED, flagged run, import errors), `live` (running clock only), `active` (current phase/stage marker), `pushed` (item currently on the student display), and `monitor-bg / monitor-fg` + the `zoll-*` parameter colors (SPEC.md) for the `/display` MONITOR view only. Font: Helvetica/Arial. Radius: `xs` = 2 px only.
- Component classes reproduce the PDF primitives: `.section` + `.section-bar` (black bar, white uppercase title, optional right-hand italic note as in `section(right=...)`), `.sheet-table` (+ `.zebra`), `.box` (square checkbox), `.cut` (dashed cut line), `.cue` (italic dark-grey instructor text), `.sheet-btn` (flat, bordered, >= 44 px).
- Screens follow the sheet's sections and order: Pre-brief = p.1 top (header strip, Protocols/Objectives/Resources, Dispatch, Scene/setup, Patient | SAMPLE + OPQRST); Run = p.1 Primary / Secondary / Vitals progression + p.2 Scenario flow, Critical actions | Differentials; Flowchart view = p.3 (render the same Graphviz-style layout as an interactive SVG: tap a diamond/hexagon = log branch); Handouts = p.4 (crew card, actor card, show cards with cue above a dashed cut line); Moulage + Learn more = p.5; Debrief = p.2 bottom (Debrief prompts | Result).
- Interactions stay flat: tap-to-reveal vital = dashed grey cell -> solid value in the vitals table row; checked items get a small timestamp in the "Time / init" column like the paper; branch rows are the IF -> THEN lines turned into bordered buttons; examiner options keep the `head` shading; modals = bordered boxes with a black title bar.
- Print stylesheet (`@media print`): letter, 0.4 in margins, accents forced to black + bold, `.no-print` chrome hidden; the debrief HTML export uses it.

## 6. Phase 1 - Instructor console (routes + components)

Router: hash routes (static hosting, no server rewrites). Offline: hand-written network-first service worker `public/sw.js` (vite-plugin-pwa not used; simpler with the relative base).

As built: `src/lib/run/` (types, reducer, actions, describe, export), `src/state/` (RunContext, autosave), `src/screens/` (Library, ScenarioShell, Prebrief, RunTab, run/VitalsTable, Debrief, Runs, Display), `src/ui/` (primitives, Clock, QR, waves, CardFace, LiveTrace). Run tab = control strip (phase prev/next, current stage, display view + ECG/CO2 toggles, undo) -> Vitals progression table (tap cell = reveal, tap stage = switch, ad-lib row) -> two columns: Scenario flow + Critical | Show cards, Moulage tags, Notes, SAMPLE/OPQRST/Primary/Secondary. Not built: the interactive p.3 flowchart view and a separate Handouts tab (cards/tags live on the Run tab, crew/actor cards on Pre-brief).

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

`#/display` opened via `window.open` from the console. Two views, switchable by the crew (large tabs) and by the instructor: MONITOR - the one deliberate exception to the paper look: black (`monitor-bg/fg`, per-parameter `zoll-*` colors), numerals for **revealed** vitals only (others "--"), live ECG lead II + SpO2 pleth + capno sweeps on `<canvas>`, or a live 12-lead (layout toggle); INFO / CARDS - paper: crew card + pushed cards/tags newest first (static renders). Everything labelled "SIMULATED". ECG/capno come from the current stage's `vitals[].monitor`; a pushed strip/capno card overrides until the next stage change; traces switch on when HR / EtCO2 is first given (or by the console toggles).
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
type SyncMessage =
  | { type: "state"; snapshot: DisplaySnapshot }  // full state: sent after every change + on hello (idempotent, late joiners ok)
  | { type: "hello"; role: "display" }            // display -> console, asks for snapshot
  | { type: "bye"; role: "display" };
interface DisplaySnapshot {                       // src/lib/display/toDisplay.ts
  v: 1; run: string; view: "monitor" | "info"; viewSeq: number;
  vitals: Partial<Record<VitalKey, string>>;      // latest revealed value per vital, markup stripped
  ecg: { rhythm; rate; p_rate?; st? } | null;     // stage monitor or pushed strip card
  capno: { pattern; etco2; rr } | null;
  crewCard: { dispatch: string; on_arrival: string };
  cards: DisplayCard[];                           // pushed show-card faces + moulage tags, newest first; no scenario title
}
```
v1 implements `BroadcastChannelTransport` only (same browser, second window). Snapshots rather than deltas keep a later WebSocket/Supabase room (6-digit code) trivial.

## 10. Tests

- Phase 0 (done): vitest - all 10 pass; 21 bad fixtures fail with the exact Python messages; Python cross-check on all 33 files (rule errors + learn prompt); normalize defaults/explicit ids; every branch target resolves.
- Phase 1/2 (done): `tests/run.test.ts` (clock, branch navigation, undo/event log, exports), `tests/display.test.ts` (leak test over every scenario, monitor follows stage/override, monitor block on every bundled stage), `tests/waveforms.test.ts` (shapes, ST shift, capno patterns); monitor schema fixtures in `validator.test.ts`. Playwright smoke `npm run e2e` (not in CI; uses $CHROME_PATH or /usr/bin/google-chrome): load scenario, start clock, reveal BP, push card, display window updates, branch switches stage, export JSON; autosave resume.

## 10b. Protocol viewer (commit f)

See SPEC.md "Protocol viewer". Files: `src/lib/protocols/{refs,locate,pdf}.ts`, `src/state/ProtocolContext.tsx`, `src/ui/ProtocolDrawer.tsx`, `src/data/protocol-index.json`, `scripts/build-protocol-index.ts`, `tests/protocols.test.ts`, `e2e/fixtures/protocols-sample.pdf` (6-page test fixture, not the real protocols). Status: index seeded (titles, `page: null`); page step has not run on the real PDF yet (file not in `public/protocols/`).

## 10c. Provider actions

See SPEC.md "Provider actions". Catalog `schema/actions.json` (65 actions, 10 groups); scenario links (165 expected items in 19 scenarios); run event `action`; reducer sync `linkedItemFor()`; UI `src/screens/run/ProviderActions.tsx`; PDF p.4 `actions_page()` in `tools/ems_scenario.py`. Tests: `tests/actions.test.ts`, provider-action blocks in `tests/run.test.ts` / `tests/display.test.ts`, Playwright smoke.

## 11. Open questions - resolved (Nov 2026)

1. Strictness: **keep** - app validator stricter than the generator (no `jsonschema` pip dependency).
2. IF length: **keep 75** in both.
3. Outcome-vitals branches: **done** in content (CARD-01 Stage F, ARR-03 Stage G) with `goto_stage`.
4. Inject branches with `goto_stage`: **yes**, tapping switches the vitals stage.
5. Explicit ids: **no**; index ids + scenario sha-256 + version stored in each run record.
6. `goto_phase`: **no auto phase advance**; instructor advances (goto_phase honoured if an author adds one).
7. Live monitor: **(a)** optional `vitals[].monitor`, populated for all stages.
8. `other` column never sent to the display; **no scenario title** on the display.
9. Image cards: bundle under `public/scenario-assets/` (data: URIs also accepted); none used yet.
10. Trainee/evaluator names: staff names only, kept in the autosave until export/discard; no retention rule set.
11. Hosting: GitHub Pages via Actions.
12. Bundle/CSP: ajv still compiles at runtime (no strict CSP planned); revisit if a CSP is added.
13. Student display: **monitor look confirmed**, plus a paper INFO / CARDS view.
14. Accents: **keep all four**.

Still open: see the Phase 1/2 report (interactive flowchart view not built; ARR-03 Stage B "PEA rate 50s" taken as 50; MED-02 D/E capno pattern).
