# ems-scenarios

AEMT crew-chief-in-training scenarios (UVM Rescue, VT Statewide EMS Protocols 2025): scenario JSON, a print PDF generator, and the Scenario Runner web app (in progress, see `docs/PLAN.md`).

## Setup

```
npm install
pip install --break-system-packages reportlab segno matplotlib numpy   # PDF generator
apt-get install -y graphviz poppler-utils                              # dot, pdftotext/pdfinfo
```

## Commands

| Command | What it does |
|---|---|
| `npm run validate` | Schema (`schema/scenario.schema.json`) + content rules on every `scenarios/*.json`; exit 1 on problems |
| `npm test` | vitest: validator (incl. cross-check against the Python validator), normalization |
| `npm run pdf` | Build every scenario PDF to `out/` and check 5 pages / p.3 flowchart / p.4 handouts |
| `python3 tools/ems_scenario.py scenarios/X.json X.pdf` | Build one PDF (validates first) |
| `npm run dev` / `npm run build` | Run / build the web app (Phase 0: placeholder page) |

## Adding a scenario

Write `scenarios/<ID>_<slug>.json` following `docs/scenario-authoring-standard.md`, then `npm run validate` and `npm run pdf`. Fix the JSON, not the validator.

## One format, two outputs

The same JSON drives the PDF (`tools/ems_scenario.py`) and the app. Optional Runner fields (`vitals[].key`, `flow[].id`, `{id, text}` checklist items, branch `goto_stage` / `goto_phase` / `id`) are accepted by both; the PDF renders `{id, text}` items by their text.

Simulated training material. Not for patient care. Verify against current VT Statewide EMS Protocols & agency SOPs.
