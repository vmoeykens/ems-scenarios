# ems-scenarios

AEMT crew-chief-in-training scenarios (UVM Rescue, VT Statewide EMS Protocols 2025): scenario JSON, a print PDF generator, and the Scenario Runner web app (instructor console + student display window; see `docs/SPEC.md`, `docs/PLAN.md`).

## Scenario Runner in one minute

Library -> pick a scenario -> Pre-brief (read dispatch, brief the actor, place moulage) -> Run (start the clock, tap vitals as the crew obtains them, tap branches, check expected actions, mark critical MET/MISSED, push cards) -> Debrief (result, learn-more QR, export JSON/CSV/HTML). "Student screen" opens `#/display` in a second window (projector/second monitor): MONITOR and INFO / CARDS views. "Other device" streams the same display to a second device by room code / QR (Supabase Realtime relay, see `docs/remote-display.md`). Nothing is stored on a server; the in-progress run is autosaved in this browser until exported.

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
| `npm run dev` / `npm run build` | Run / build the web app (`npm run preview` serves `dist/`) |
| `npm run protocol-index` | Fill protocol page numbers in `src/data/protocol-index.json` from `public/protocols/vt-ems-protocols-2025.pdf` (skips if absent; also runs before every build) |
| `npm run e2e` | Playwright smoke test (not in CI; needs Chrome/Chromium: `$CHROME_PATH`, `/usr/bin/google-chrome`, or `npx playwright install chromium`) |

## Protocols PDF (optional)

Put the official VT protocols PDF at `public/protocols/vt-ems-protocols-2025.pdf` and commit it. Protocol numbers in scenario text then open an in-app viewer at the right page (`npm run build` runs `npm run protocol-index` first to record each protocol's page in `src/data/protocol-index.json`; commit the updated index). Without the file, the links open the official PDF on healthvermont.gov in a new tab.

## Adding a scenario

Write `scenarios/<ID>_<slug>.json` following `docs/scenario-authoring-standard.md`, then `npm run validate` and `npm run pdf`. Fix the JSON, not the validator.

## One format, two outputs

The same JSON drives the PDF (`tools/ems_scenario.py`) and the app. Optional Runner fields (`vitals[].key`, `vitals[].monitor`, `flow[].id`, `{id, text}` checklist items, branch `goto_stage` / `goto_phase` / `id`) are accepted by both; the PDF renders `{id, text}` items by their text and ignores `monitor` (student-display ECG/capno for that stage).

Simulated training material. Not for patient care. Verify against current VT Statewide EMS Protocols & agency SOPs.
