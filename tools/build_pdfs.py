#!/usr/bin/env python3
"""Build every scenario PDF and run the page checks.
Usage: python3 tools/build_pdfs.py [scenarios_dir] [out_dir]     (npm run pdf)
Checks per PDF: 6 pages; p.3 contains "DECISION FLOWCHART"; p.4 "PROVIDER ACTIONS"; p.5 "HANDOUTS"
(= p.1/p.2 and the provider-actions page each fit one page).
Needs poppler-utils (pdfinfo, pdftotext) for the checks.
"""
import glob, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))

def page_text(pdf, n):
    return subprocess.run(["pdftotext", "-f", str(n), "-l", str(n), pdf, "-"], capture_output=True, text=True, check=True).stdout

def pages(pdf):
    info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, check=True).stdout
    return int(next(l.split()[-1] for l in info.splitlines() if l.startswith("Pages:")))

def check(pdf):
    problems = []
    n = pages(pdf)
    if n != 6: problems.append(f"{n} pages (want 6)")
    if "DECISION FLOWCHART" not in page_text(pdf, 3): problems.append('p.3 lacks "DECISION FLOWCHART"')
    if "PROVIDER ACTIONS" not in page_text(pdf, 4): problems.append('p.4 lacks "PROVIDER ACTIONS"')
    if "HANDOUTS" not in page_text(pdf, 5): problems.append('p.5 lacks "HANDOUTS"')
    return problems

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "scenarios"
    out = sys.argv[2] if len(sys.argv) > 2 else "out"
    os.makedirs(out, exist_ok=True)
    failed = 0
    files = sorted(glob.glob(os.path.join(src, "*.json")))
    for f in files:
        pdf = os.path.join(out, os.path.splitext(os.path.basename(f))[0] + ".pdf")
        r = subprocess.run([sys.executable, os.path.join(HERE, "ems_scenario.py"), f, pdf], capture_output=True, text=True)
        if r.returncode:
            failed += 1; print(f"FAIL {f}\n  {(r.stderr or r.stdout).strip()}"); continue
        problems = check(pdf)
        if problems: failed += 1; print(f"FAIL {pdf}: " + "; ".join(problems))
        else: print(f"ok   {pdf} (6 pages, p.3 flowchart, p.4 provider actions, p.5 handouts)")
    print(f"\n{len(files) - failed}/{len(files)} built and checked")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
