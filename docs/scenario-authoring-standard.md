---
name: "ems-scenario-sheet"
description: "Build a standardized, print-ready B&W PDF scenario sheet (instructor flow, vitals, checklists, differentials, show cards) for AEMT crew-chief training scenarios under VT EMS protocols."
---

# EMS Scenario Sheet (AEMT Crew Chief in Training - UVM Rescue)

Output is always a **PDF** (US Letter, black and white, dense, no decoration). Each scenario is one JSON file rendered by the project's generator. The format is fixed so every trainee gets the same structure.

## Page layout (fixed)
- **p.1 Instructor**: header (type/level/run time/difficulty/crew), protocols, objectives, resources -> Dispatch (read aloud), Scene/setup, Patient | SAMPLE + OPQRST -> Primary (XABCDE w/ checkboxes) -> Secondary exam (2-col, checkboxes) -> Vitals progression table (staged + 2 blank ad-lib rows) -> notes lines.
- **p.2 Instructor**: Scenario flow (Time | Phase | Say/give + IF->THEN crew branches + EXAMINER OPTION injects | Expected actions w/ checkboxes | time/initials) -> Critical actions (instructor discretion) | Differentials -> Debrief prompts | Result (Pass/Remediate/Fail) -> notes.
- **p.3 Decision flowchart** (Graphviz, auto-built from `flow`): phase spine (top 3 expected actions), one row per branch: diamond = crew action/error, shaded hexagon = examiner option; outcome box shows the referenced stage's vitals; bold box = critical (evaluator discretion).
- **p.4 Handouts** (cut on dashed lines): Crew card, Patient actor card, Show cards. Instructor-only `cue` text prints in a scrap strip ABOVE the cut line, never on the piece handed over.
- **p.5 Moulage tags + Learn-more card**: 3-across tags (region + finding) to tape on the body, with cues above the cut line; then a cut-out "After the scenario - learn more" card for the trainee with an AEMT-scoped OpenEvidence prompt, a QR of the prompt text and a QR to openevidence.com.

Print: p.1-2 duplex (one sheet), p.3 single, p.4-5 cut apart.

## Workflow
1. Get the chief complaint / protocols to hit. Ask only if the target protocol or difficulty is truly unclear.
2. **Read the protocols**: project doc `eprip-2025-EMS-Protocols_0.pdf` (VT Statewide EMS Protocols 2025) via Projects `project_read`; grep the local text for the sections. Pull exact EMT / **ADVANCED EMT** standing orders, doses, contraindications, Pearls. Text extraction scrambles columns - if AEMT vs Paramedic ownership of an order is unclear, treat it as paramedic (intercept) and tell the user.
3. Write the scenario JSON (schema below). Read 1-2 examples under `claude/scenarios/` in the project first and match their density.
4. Get the generator: Projects `project_read` path `claude/tools/ems_scenario.py` -> write it to `ems_scenario.py` (single source of truth; never retype it). Needs reportlab, matplotlib, numpy, segno and Graphviz `dot` (`pip install --break-system-packages reportlab segno`; `apt-get install -y graphviz` if `which dot` fails).
5. Run `python3 ems_scenario.py scenario.json <ID>.pdf`. It **validates first** and refuses to build on problems (bad Stage refs, non-condition IFs, hints on card/tag faces, 'critical fail' wording, scene.safety present, prompt too long for QR). Fix the JSON, not the validator.
6. Check: 5 pages; `pdftotext -f 3 -l 3` contains "DECISION FLOWCHART" and `-f 4 -l 4` contains "HANDOUTS" (= p.1/p.2 each fit one page). Rasterize with `pdftoppm -r 75 -png` and look at every page, especially the flowchart. Optionally confirm both QR codes decode (`pip install zxing-cpp`; `zxingcpp.read_barcodes` on a 150 dpi render of p.5). If p.1/p.2 overflow, shorten text, never shrink fonts.
7. Save JSON to the project as `claude/scenarios/<ID>_<slug>.json`; if you changed the generator, write it back to `claude/tools/ems_scenario.py`. Send the PDF with SendUserFile.

## Content standards
- **Agency context (default)**: crew is **UVM Rescue** (dispatch callsign "UVM Rescue"), based ~1 min from **UVMMC** (Level 1 trauma, PCI, stroke, neurosurgery). Scenes 0-20 min from UVMMC (state time in `resources`); real-feeling Chittenden County locations. Short transports shift decisions to: direct to UVMMC vs waiting for intercept (never delay on scene), air medical generally not faster, work arrests on scene, POV/self-transport refusals. Paramedic intercept = "if available, without delaying transport".
- **No scene safety**: it is trained outside scenarios. No `scene.safety`, no BSI/hazard expected actions, objectives or critical items, no hazard-only details (running machinery, smoking, sharps disposal). Clinical scene clues (e.g., drug paraphernalia as OD evidence) are fine.
- **Scope**: AEMT-level actions only per VT 2025. Paramedic-only items (ECG interpretation, atropine, pacing, IV nitro, opioids, steroids, antihistamines unless clearly AEMT) appear as intercept / Medical Direction, never as expected AEMT actions. AEMT acts on the 12-lead **computer interpretation** (6.2) - put the machine read in the 12-lead card caption.
- Cite protocol numbers in `protocols`, flow items and critical items.
- **Vitals**: staged rows A, B, C... (unique first letters), each with a concrete trigger. Fixed columns HR, BP, RR, SpO2, EtCO2, BGL, Temp, Pain, GCS, Pupils + `other`. "-" = unchanged/not re-checked. Key abnormal values in `bold`. Physiologically consistent. Neutral stage names ("E Crash", not "E Fail").
- **Flow**: 5-8 phases with minute ranges from contact. `give` = what the instructor says/hands over. Include one decision-testing prompt (actor/bystander line). Every phase needs >= 2 expected actions.
- **Branches** (crew-driven): `{if, then}`. `if` is a crew action/condition (<= 60 chars), never "Stage X" or "Advanced option". `then` references outcomes as `Stage **X**` where a vitals stage applies.
- **Examiner options** (examiner-driven): `{type: "inject", if: <what you inject>, then: <what to give + what to expect>}`. 1-2 per scenario: deterioration that forces a protocol target (e.g. SBP drop in TBI), re-arrest, seizure; equipment failure; complications (vomiting on CPAP, infiltrated IV, TQ slipping); people (family, a document turns up). Add a vitals stage row when the inject changes vitals meaningfully.
- **Expected actions**: short, checkable. Include crew-chief items: roles, intercept vs direct, destination (UVMMC + alert type), Medical Direction, radio report, SIREN.
- **Critical actions**: 5-9 protocol-tied items, **instructor discretion** (never automatic fails). Branch outcomes say "critical (evaluator discretion)"; never "critical fail" / "miss = fail".
- **Differentials**: 5-7 real alternatives with supporting and against findings from this patient.
- **Show cards**: face (`title`, `caption`, `body`) shows ONLY what the device/scene shows: neutral titles ("CAPNOGRAPHY", "AED / MONITOR", "12-LEAD", "PUPILS"), captions = device numbers/machine text. Timing, triggers, interpretation ("if overbagging", "after ROSC", "no pulse = PEA", "normal waveform") go in `cue`.
- **Moulage tags**: 4-9 per scenario. `region` = where it goes ("R forehead", "Back (lung sounds)", "Wrist (radial)"); `text` = the finding as the crew would perceive it on exam, plain language, no diagnosis words. Time-dependent findings get a `cue` ("Place at T+15", "Swap to ... after ROSC").
- **Learn more**: `learn_more: {topic, focus}` -> the generator builds an AEMT-scoped prompt (pathophysiology, field assessment/pitfalls, evidence-based care within AEMT scope, last-5-year EMS research, + focus, cite sources). `topic` = the primary illness/injury in plain words; `focus` = 3-4 scenario-specific teaching points. Total prompt must stay <= 480 chars (QR scannability). OpenEvidence requires a US clinician NPI account and has no documented prefilled-question link; the card says so.
- Style: terse fragments, no filler, no emojis. `**bold**` only markup. `->` renders as an arrow. ASCII otherwise.
- ID prefixes: CARD-, MED-, TRA-, ARR-, PED-, OB-, ENV- + 2 digits.

## JSON schema (all keys optional except title)
```
id, title, version, category, level, run_time, difficulty, crew       strings
protocols: [str]   objectives: [str]   resources: str   dispatch: str
scene: {location, setup, moulage, roles, ...any key except safety}   (rendered in order)
patient: {name, age, sex, weight_kg, cc, on_arrival}
history: {SAMPLE: [["S",".."],...6], OPQRST: [["O",".."],...6]}
primary:   [[label, finding], ...]   (X/hemorrhage, Airway, Breathing, Circulation, Disability, Exposure, Priority / impression)
secondary: [[region, finding], ...]  (6-10 rows)
vitals: [{stage, trigger, HR, BP, RR, SpO2, EtCO2, BGL, Temp, Pain, GCS, Pupils, other, bold:[keys]}]
blank_vitals_rows: int (default 2)    vitals_note: str
flow: [{time, phase, give, expected:[str],
        branches:[{if, then} | {type:"inject", if, then}]}]
critical: [str]    differentials: [[dx, supports, against]]    debrief: [str]
crew_card: {dispatch, on_arrival}     actor_card: {label: text, ...}
show_cards: [   # every card may also have cue: "instructor-only text printed above the cut line"
  {type:"12lead", title, caption, rhythm, rate, st:{lead: mm}}           # leads I II III aVR aVL aVF V1-V6; +elev / -depr
  {type:"strip", width:"full|half", title, caption, rhythm, rate, lead, st, seconds, p_rate}
  {type:"capno", width, title, caption, pattern:"normal|shark|cpr", etco2, rr}
  {type:"text",  width, title, body}
  {type:"image", width, title, caption, path}
]
moulage_tags: [{region, text, cue?}]
learn_more: {topic, focus}   (or {prompt} to override the template; <= 480 chars)
rhythm: sinus | afib | svt | vt | vf | asystole | chb (p_rate = atrial rate) | avb1 | flutter (p_rate = flutter rate)
```

If the project is not attached (no `claude/tools/ems_scenario.py`), tell the user the generator lives in the "EMS Scenarios" project and ask them to attach it or upload the file.