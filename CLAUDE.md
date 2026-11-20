# ems-scenarios

EMS training scenarios for AEMT crew-chief trainees (UVM Rescue, Vermont) plus the "Scenario Runner" companion web app.

## Layout
- `scenarios/*.json` - scenario content (source of truth). One file per scenario, `<ID>_<slug>.json`.
- `tools/ems_scenario.py` - PDF generator + validator. `python3 tools/ems_scenario.py scenarios/X.json out.pdf`. Needs reportlab, matplotlib, numpy, segno, Graphviz `dot`.
- `docs/SPEC.md` - web app build spec (phases, constraints). Read before working on the app.
- `docs/scenario-authoring-standard.md` - content rules and JSON schema for writing scenarios.
- `docs/reference/eprip-2025-EMS-Protocols-text.txt` - text extraction of the VT Statewide EMS Protocols 2025 (columns can be scrambled; grep it). Official PDF: `public/protocols/vt-ems-protocols-2025.pdf` once added.

## Rules
- Never change clinical content in scenario JSON unless the user asks. Structural/format upgrades are OK when the spec calls for them; keep them in their own commit.
- JSON must keep building with the PDF generator. After any schema or generator change, rebuild all 10 PDFs and check: 5 pages, p.3 has "DECISION FLOWCHART", p.4 has "HANDOUTS".
- Fix the JSON, not the validator, when content fails validation. Change the validator only to accept new optional format fields.
- Instructor-only text (`cue`, stage triggers, branches, critical items) never appears on anything shown to the crew/student.
- Critical items are "evaluator discretion", never automatic fails.
- AEMT scope only per VT 2025; paramedic-only actions appear as intercept / Medical Direction.
- Keep the footer: "Simulated training material. Not for patient care. Verify against current VT Statewide EMS Protocols & agency SOPs."
