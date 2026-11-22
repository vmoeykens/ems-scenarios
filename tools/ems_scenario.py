#!/usr/bin/env python3
"""EMS training scenario sheet generator (B&W, print-optimized, US Letter).
Usage: python3 ems_scenario.py scenario.json out.pdf
Pages: 1 = setup/patient/vitals, 2 = flow/critical/differentials/notes, 3 = decision flowchart, 4 = provider actions
(needs ../schema/actions.json; skipped if absent), 5+ = handouts & show cards (+ learn-more card), last = moulage tags.
Requires segno (pip install segno) for QR codes.
Requires Graphviz `dot` on PATH (apt install graphviz).
"""
import json, sys, os, re, tempfile
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph, Table, TableStyle,
                                Spacer, PageBreak, Flowable, Image, KeepTogether, NextPageTemplate)

PW, PH = letter
M = 0.4 * inch
W = PW - 2 * M
BLACK, GREY, LIGHT = colors.black, colors.Color(.55, .55, .55), colors.Color(.88, .88, .88)
F, FB, FI = "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"

def st(name, size=7.4, font=F, lead=None, **kw):
    return ParagraphStyle(name, fontName=font, fontSize=size, leading=lead or size * 1.2, **kw)
S = st("s"); SB = st("sb", font=FB); SI = st("si", font=FI); SS = st("ss", 6.4)
SH = st("sh", 7, FB, textColor=colors.white); STITLE = st("t", 13, FB, 15)
SBIG = st("big", 11, F, 13.5); SBIGB = st("bigb", 13, FB, 16)

def md(t):
    t = str(t if t is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"(?<!\*)\*\*(?!\*)(.+?)(?<!\*)\*\*(?!\*)", r"<b>\1</b>", t)
    return t.replace("-&gt;", "&#8594;").replace("\n", "<br/>")

def P(t, s=S): return Paragraph(md(t), s)

class Box(Flowable):
    """Empty checkbox."""
    def __init__(self, s=6.5): super().__init__(); self.s = s; self.width = self.height = s
    def draw(self): self.canv.setLineWidth(.6); self.canv.rect(0, 0, self.s, self.s)

class Lines(Flowable):
    """Ruled writing lines; fills remaining frame height when h is None."""
    def __init__(self, h=None, gap=13, minh=40, label=None):
        super().__init__(); self.h, self.gap, self.minh, self.label = h, gap, minh, label
    def wrap(self, aw, ah):
        self.width = aw; self.height = self.h if self.h else max(self.minh, ah - 2); return self.width, self.height
    def draw(self):
        c = self.canv; c.setStrokeColor(GREY); c.setLineWidth(.35)
        y = self.height - self.gap
        while y >= 0: c.line(0, y, self.width, y); y -= self.gap
        c.setStrokeColor(BLACK); c.setLineWidth(.6); c.rect(0, 0, self.width, self.height)
        if self.label: c.setFont(FB, 6.5); c.drawString(3, self.height - 8, self.label)

BASE = [("FONT", (0, 0), (-1, -1), F, 7.4), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
        ("TOPPADDING", (0, 0), (-1, -1), 1.3), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6)]

def grid(data, widths, header=False, extra=(), zebra=False):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    s = BASE + [("GRID", (0, 0), (-1, -1), .4, BLACK)]
    if header: s += [("BACKGROUND", (0, 0), (-1, 0), LIGHT), ("FONT", (0, 0), (-1, 0), FB, 6.8)]
    if zebra:
        s += [("BACKGROUND", (0, r), (-1, r), colors.Color(.95, .95, .95)) for r in range(2 if header else 1, len(data), 2)]
    t.setStyle(TableStyle(s + list(extra))); return t

def section(title, body, width=W, right=None):
    """Black header bar + body flowable(s)."""
    head = [Paragraph(md(title).upper(), SH)]
    if right: head = [Table([[Paragraph(md(title).upper(), SH), Paragraph(md(right), st("hr", 6.4, FI, textColor=colors.white, alignment=2))]],
                            colWidths=[width * .5 - 3, width * .5 - 3], style=BASE + [("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)])]
    body = body if isinstance(body, list) else [body]
    t = Table([head] + [[b] for b in body], colWidths=[width])
    t.setStyle(TableStyle(BASE + [("BACKGROUND", (0, 0), (-1, 0), BLACK), ("BOX", (0, 0), (-1, -1), .8, BLACK),
                                  ("LEFTPADDING", (0, 1), (-1, -1), 0), ("RIGHTPADDING", (0, 1), (-1, -1), 0),
                                  ("TOPPADDING", (0, 1), (-1, -1), 0), ("BOTTOMPADDING", (0, 1), (-1, -1), 0),
                                  ("TOPPADDING", (0, 0), (-1, 0), 1.5), ("BOTTOMPADDING", (0, 0), (-1, 0), 1.8)]))
    return t

def kv(rows, w, lw=.95 * inch, box=False):
    """label | value [| checkbox] rows."""
    if not rows: return Spacer(1, 0)
    if box:
        data = [[Box(), P(k, SB), P(v)] for k, v in rows]; widths = [11, lw, w - lw - 11]
    else:
        data = [[P(k, SB), P(v)] for k, v in rows]; widths = [lw, w - lw]
    t = Table(data, colWidths=widths)
    t.setStyle(TableStyle(BASE + [("LINEBELOW", (0, 0), (-1, -2), .3, GREY)]))
    return t

def pad(fl, p=3):
    t = Table([[fl]], colWidths=[None]); t.setStyle(TableStyle(BASE + [("LEFTPADDING", (0, 0), (-1, -1), p), ("RIGHTPADDING", (0, 0), (-1, -1), p), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)])); return t

def _txt(i):
    """Checklist item: plain string or {id, text} (Scenario Runner format)."""
    return i.get("text", "") if isinstance(i, dict) else i

def checklist(items, w):
    data = [[Box(), P(_txt(i))] for i in items]
    t = Table(data, colWidths=[11, w - 11]); t.setStyle(TableStyle(BASE + [("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2)])); return t

def two_col(left, right, wl=None, gap=5):
    wl = wl or (W - gap) / 2; wr = W - gap - wl
    t = Table([[left, "", right]], colWidths=[wl, gap, wr]); t.setStyle(TableStyle(BASE + [("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)])); return t, wl, wr

# ---------------------------------------------------------------- ECG / capnography (simulated)
LEADS = {  # R, S, T amplitude (mV), P amp
    "I": (.6, .1, .2, .1), "II": (1.0, .1, .3, .15), "III": (.5, .15, .1, .07), "aVR": (.1, .6, -.2, -.1),
    "aVL": (.35, .2, .1, .05), "aVF": (.7, .1, .2, .1), "V1": (.15, .9, -.05, .05), "V2": (.3, 1.1, .3, .07),
    "V3": (.6, .6, .4, .07), "V4": (1.1, .3, .4, .08), "V5": (1.2, .15, .35, .08), "V6": (1.0, .1, .3, .08)}
FS = 500

def g(t, mu, sd): return np.exp(-((t - mu) ** 2) / (2 * sd ** 2))

def beat_times(kind, rate, dur, rng):
    if kind in ("vf", "asystole"): return []
    rr = 60.0 / max(rate, 1)
    if kind == "afib":
        ts, t = [], .3
        while t < dur: ts.append(t); t += rr * rng.uniform(.6, 1.45)
        return ts
    return list(np.arange(.25, dur, rr))

def ecg(kind="sinus", rate=75, dur=10.0, lead="II", stmm=0.0, seed=1, pr=.16, wide=False, p_rate=None):
    """Returns t, mV.  kind: sinus|afib|svt|vt|vf|asystole|chb|avb1|flutter.  stmm: ST shift in mm (+ elevation)."""
    rng = np.random.default_rng(seed)
    t = np.arange(0, dur, 1 / FS); y = np.zeros_like(t)
    R, Sa, T, Pa = LEADS.get(lead, LEADS["II"])
    stv = stmm / 10.0
    wide = wide or kind == "vt"
    if kind == "vf":
        for f, a in ((4.1, .25), (5.3, .2), (6.7, .12), (3.2, .15)):
            y += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * (0.7 + .3 * np.sin(2 * np.pi * .3 * t + rng.uniform(0, 6)))
        return t, y + rng.normal(0, .01, t.size)
    if kind == "asystole":
        return t, .03 * np.sin(2 * np.pi * .2 * t) + rng.normal(0, .006, t.size)
    beats = beat_times(kind, rate, dur, rng)
    pr_ = pr * (1.9 if kind == "avb1" else 1)
    show_p = kind in ("sinus", "avb1")
    for b in beats:
        qw = (.045 if kind == "vt" else .03) if wide else .009
        if show_p: y += Pa * g(t, b - pr_, .022)
        y += -.08 * R * g(t, b - .018, .006) if not wide else 0
        if wide:
            y += (R * .9 + .4) * g(t, b, qw) - (Sa + .5) * g(t, b + .07, .03)
            y += -.35 * np.sign(R - Sa + 1e-6) * g(t, b + .22, .06)
        else:
            y += (R + (.15 if stv > .05 else 0)) * g(t, b, qw) - Sa * g(t, b + .022, .008)
            # ST segment + T
            with np.errstate(over="ignore"):
                win = 1 / (1 + np.exp(-(t - (b + .035)) / .004)) * (1 / (1 + np.exp((t - (b + .30)) / .03)))
            y += stv * win
            y += (T + .6 * stv) * g(t, b + .26, .045)
    if kind == "chb":
        pr2 = 60.0 / (p_rate or 80)
        for p in np.arange(.1, dur, pr2): y += Pa * g(t, p, .022)
    if kind == "afib": y += .04 * np.sin(2 * np.pi * 6.5 * t) + .025 * np.sin(2 * np.pi * 8.3 * t + 1) + rng.normal(0, .012, t.size)
    if kind == "flutter": y += .18 * (2 * ((t * (p_rate or 300) / 60) % 1) - 1)
    return t, y + rng.normal(0, .005, t.size)

def _grid(ax, w_mm, h_mm):
    for x in np.arange(0, w_mm + .01, 1): ax.axvline(x, color=".85" if x % 5 else ".55", lw=.25 if x % 5 else .5, zorder=0)
    for yy in np.arange(-h_mm / 2, h_mm / 2 + .01, 1): ax.axhline(yy, color=".85" if round(yy) % 5 else ".55", lw=.25 if round(yy) % 5 else .5, zorder=0)
    ax.set_xlim(0, w_mm); ax.set_ylim(-h_mm / 2, h_mm / 2); ax.axis("off")

def strip_png(path, kind="sinus", rate=75, lead="II", stmm=0, seconds=8, label=None, width_in=7.6, height_in=1.05, **kw):
    t, y = ecg(kind, rate, seconds, lead, stmm, **kw)
    w_mm, h_mm = seconds * 25, 26
    fig = plt.figure(figsize=(width_in, height_in), dpi=300); ax = fig.add_axes([0, 0, 1, 1])
    _grid(ax, w_mm, h_mm); ax.plot(t * 25, y * 10 - 2, color="k", lw=.8)
    ax.text(1.5, h_mm / 2 - 4, label or lead, fontsize=7, weight="bold", bbox=dict(fc="white", ec="none", pad=.5))
    fig.savefig(path); plt.close(fig)

def twelve_png(path, kind="sinus", rate=75, st=None, width_in=7.6, height_in=3.3, **kw):
    st = st or {}
    order = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]]
    w_mm, row_h = 250, 28
    fig = plt.figure(figsize=(width_in, height_in), dpi=300); ax = fig.add_axes([0, 0, 1, 1])
    H = row_h * 4
    for x in np.arange(0, w_mm + .01, 1): ax.axvline(x, color=".85" if x % 5 else ".55", lw=.22 if x % 5 else .45, zorder=0)
    for yy in np.arange(0, H + .01, 1): ax.axhline(yy, color=".85" if yy % 5 else ".55", lw=.22 if yy % 5 else .45, zorder=0)
    for r, row in enumerate(order):
        base = H - row_h * (r + .55)
        for c, ld in enumerate(row):
            t, y = ecg(kind, rate, 10, ld, st.get(ld, 0), **kw)
            m = (t >= c * 2.5) & (t < (c + 1) * 2.5)
            ax.plot(t[m] * 25, y[m] * 10 + base, color="k", lw=.7)
            ax.text(c * 62.5 + 1.5, base + 7, ld, fontsize=7, weight="bold")
            if c: ax.plot([c * 62.5] * 2, [base - 3, base + 3], color="k", lw=.7)
    t, y = ecg(kind, rate, 10, "II", st.get("II", 0), **kw)
    ax.plot(t * 25, y * 10 + row_h * .45, color="k", lw=.7); ax.text(1.5, row_h * .45 + 7, "II", fontsize=7, weight="bold")
    ax.set_xlim(0, w_mm); ax.set_ylim(0, H); ax.axis("off")
    fig.savefig(path); plt.close(fig)

def capno_png(path, pattern="normal", etco2=38, rr=14, seconds=16, width_in=3.7, height_in=1.15):
    t = np.arange(0, seconds, 1 / 100); y = np.zeros_like(t); per = 60 / max(rr, 1)
    for b in np.arange(.5, seconds, per):
        exp_ = per * .5; ph = (t - b)
        m = (ph >= 0) & (ph < exp_)
        if pattern == "shark":
            y[m] = etco2 * (1 - np.exp(-ph[m] / (exp_ * .45)))
        elif pattern == "cpr":
            y[m] = etco2 * np.clip(ph[m] / .25, 0, 1) * (1 - .1 * ph[m] / exp_) + 1.5 * np.sin(2 * np.pi * 1.8 * ph[m])
        else:
            y[m] = etco2 * np.clip(ph[m] / .15, 0, 1) * (1 + .06 * ph[m] / exp_)
        d = (ph >= exp_) & (ph < exp_ + .2); y[d] = np.maximum(y[d], etco2 * (1 - (ph[d] - exp_) / .2))
    fig = plt.figure(figsize=(width_in, height_in), dpi=300); ax = fig.add_axes([.09, .08, .89, .86])
    ax.plot(t, y, color="k", lw=.9)
    for lv in (0, 25, 50): ax.axhline(lv, color=".7", lw=.4, ls="--")
    ax.set_ylim(-2, 55); ax.set_xlim(0, seconds); ax.set_yticks([0, 25, 50]); ax.set_xticks([])
    ax.tick_params(labelsize=6, length=2)
    for s_ in ax.spines.values(): s_.set_linewidth(.5)
    fig.savefig(path); plt.close(fig)


# ---------------------------------------------------------------- decision flowchart (Graphviz)
import subprocess, textwrap, html as _html

def _h(t, width):
    """escape + wrap + **bold** for Graphviz HTML labels"""
    t = re.sub(r"\*\*\*", "", str(t))
    lines = textwrap.wrap(t, width, break_long_words=False, break_on_hyphens=False) or [""]
    out = []
    for ln in lines:
        ln = _html.escape(ln).replace("-&gt;", "&#8594;")
        ln = re.sub(r"\*\*(.+?)\*\*", r"<B>\1</B>", ln).replace("**", "")
        out.append(ln)
    return "<BR/>".join(out)

def _stage_row(sc, txt, goto=None):
    m = re.search(r"Stage \*\*([A-Z])\*\*", txt) or re.search(r"Stage ([A-Z])\b", txt)
    letter = goto or (m.group(1) if m else None)
    if not letter: return None, None
    for r in sc.get("vitals", []):
        if (r["key"].upper() == letter) if r.get("key") else r.get("stage", "").strip().upper().startswith(letter):
            keys = [k for k in ("HR", "BP", "RR", "SpO2", "EtCO2", "GCS") if r.get(k) not in (None, "", "-")]
            v = "  ".join(f"{k} {re.sub(r'[*]', '', str(r[k]))}" for k in keys[:5])
            return letter, v
    return letter, None

def flowchart_png(sc, path):
    """Grid layout: col 1 = phase spine, col 2 = decision diamond, col 3 = outcome. One row per branch."""
    L = ['digraph G {', 'graph [rankdir=TB, nodesep=0.22, ranksep=0.16, margin=0, newrank=true, splines=true];',
         'node [fontname="Helvetica", fontsize=9, penwidth=1, margin="0.06,0.03"];', 'edge [arrowsize=0.6, penwidth=0.9, fontname="Helvetica"];']
    flow = sc.get("flow", [])
    L.append(f'start [shape=box, group=s, width=2.7, style="rounded,filled", fillcolor=black, fontcolor=white, label=<<B>{_h("DISPATCH: " + sc.get("patient", {}).get("cc", ""), 40)}</B>>];')
    prev = "start"
    for i, ph in enumerate(flow):
        n = f"p{i}"
        acts = "".join(f'<TR><TD ALIGN="LEFT" BALIGN="LEFT"><FONT POINT-SIZE="8">&#9633; {_h(_txt(a), 40)}</FONT></TD></TR>' for a in ph.get("expected", [])[:3])
        L.append(f'{n} [shape=plain, group=s, label=<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="2" WIDTH="190">'
                 f'<TR><TD ALIGN="LEFT" WIDTH="186" BGCOLOR="#DDDDDD"><B>{_h(ph.get("time", ""), 10)} min  |  {_h(ph.get("phase", ""), 30)}</B></TD></TR>{acts}</TABLE>>];')
        L.append(f'{prev} -> {n} [penwidth=1.8, weight=20];')
        prev = n
        for j, br in enumerate(sorted(ph.get("branches", []), key=lambda b: b.get("type") == "inject")):
            row = n
            if j:  # extra branch rows hang off an invisible point on the spine
                row = f"x{i}_{j}"
                L.append(f'{row} [shape=point, width=0.01, group=s, style=invis];')
                L.append(f'{prev} -> {row} [penwidth=1.8, weight=20, arrowhead=none];')
                prev = row
            d, o = f"d{i}_{j}", f"o{i}_{j}"
            inj = br.get("type") == "inject"
            crit = "critical" in (br["if"] + br["then"]).lower()
            if inj:
                L.append(f'{d} [shape=hexagon, group=d, style=filled, fillcolor="#EEEEEE", margin="0.02,0.02", fontsize=8, label=<<FONT POINT-SIZE="6.5"><B>EXAMINER OPTION</B></FONT><BR/>{_h(br["if"], 24)}>];')
            else:
                L.append(f'{d} [shape=diamond, group=d, margin="0.01,0.01", fontsize=8, label=<{_h(br["if"], 24)}>];')
            stg, vit = _stage_row(sc, br["then"], br.get("goto_stage"))
            body = _h(br["then"].replace("critical (evaluator discretion)", "**critical\u00a0(evaluator\u00a0discretion)**"), 34)
            if vit: body += f'<BR/><FONT POINT-SIZE="7.5"><I>{_h(vit, 40)}</I></FONT>'
            if crit and "critical" not in br["then"].lower(): body = "<B>CRITICAL</B> <I>(discretion)</I><BR/>" + body
            sty = 'style="bold,rounded", penwidth=2.4' if crit else 'style="rounded"'
            L.append(f'{o} [shape=box, group=o, {sty}, fontsize=8, label=<{body}>];')
            L.append(f'{row} -> {d} [style={"dotted" if inj else "dashed"}];')
            L.append(f'{d} -> {o} [label=<<FONT POINT-SIZE="7"> {"GIVE" if inj else "YES"} </FONT>>];')
            L.append("{rank=same; " + f"{row}; {d}; {o};" + "}")
    L.append('end [shape=box, group=s, style="rounded,filled", fillcolor=black, fontcolor=white, label=<<B>HANDOFF / DEBRIEF</B>>];')
    L.append(f'{prev} -> end [penwidth=1.8, weight=20];')
    L.append("}")
    subprocess.run(["dot", "-Tpng", "-Gdpi=300", "-o", path], input="\n".join(L).encode(), check=True)
    return path

def flowchart_page(sc, tmp):
    path = flowchart_png(sc, os.path.join(tmp, "flow.png"))
    img = Image(path); iw, ih = img.imageWidth, img.imageHeight
    maxw, maxh = W - 8, (PH - 2 * M) * .80
    sc_ = min(maxw / iw, maxh / ih); img.drawWidth, img.drawHeight = iw * sc_, ih * sc_
    legend = P("Solid spine = expected path. Diamond = crew action/error (IF) -> outcome. Shaded hexagon = **examiner option** you may inject regardless of crew actions. Outcome boxes show stage vitals. **Bold box = critical item (evaluator discretion).** Details: Scenario flow table, p.2.", SS)
    t = Table([[img], [legend]], colWidths=[W]); t.setStyle(TableStyle(BASE + [("ALIGN", (0, 0), (-1, 0), "CENTER")]))
    return [section("Decision flowchart", t), Spacer(1, 3), Lines(minh=30, label="NOTES")]



# ---------------------------------------------------------------- post-scenario learning (OpenEvidence) + moulage tags
OE_URL = "https://www.openevidence.com"

def learn_prompt(sc):
    lm = sc.get("learn_more", {})
    if lm.get("prompt"): return lm["prompt"]
    topic = lm.get("topic") or sc.get("title", "")
    focus = f" Focus: {lm['focus']}." if lm.get("focus") else ""
    return (f"Vermont AEMT, post-training review: {topic}. For an AEMT audience: pathophysiology, key field assessment and pitfalls, "
            f"evidence-based prehospital care within AEMT scope, and EMS research from the last 5 years.{focus} Cite sources; under 400 words.")

def qr_png(data, path, scale=6):
    import segno
    segno.make(data, error="l", micro=False).save(path, scale=scale, border=2)
    return path

def learn_card(sc, tmp, w):
    prompt = learn_prompt(sc)
    q1 = Image(qr_png(prompt, os.path.join(tmp, "qr_prompt.png")), width=1.45 * inch, height=1.45 * inch)
    q2 = Image(qr_png(OE_URL, os.path.join(tmp, "qr_oe.png")), width=0.8 * inch, height=0.8 * inch)
    txt = [P("AFTER THE SCENARIO - LEARN MORE", st("lm", 9, FB, 11)),
           P("Paste this into **OpenEvidence** (free with a US clinician NPI account), or any evidence tool. Verify against VT protocols.", SS),
           Spacer(1, 2), P(prompt, st("lp", 7.6, F, 9.4))]
    qrs = Table([[q1, q2], [P("Scan: prompt text", SS), P("Scan: openevidence.com", SS)]], colWidths=[1.55 * inch, 0.95 * inch])
    qrs.setStyle(TableStyle(BASE + [("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
    t = Table([[txt, qrs]], colWidths=[w - 2.6 * inch, 2.55 * inch])
    t.setStyle(TableStyle(BASE + [("BOX", (0, 0), (-1, -1), 1, BLACK), ("LEFTPADDING", (0, 0), (-1, -1), 4)]))
    return t

def moulage_page(sc, tmp):
    """Last page: moulage tags (if any) + the learn-more card for the trainee."""
    tags = sc.get("moulage_tags", [])
    learn = [Spacer(1, 6), KeepTogether([CutLine(), learn_card(sc, tmp, W)])]
    if not tags: return learn
    CUE = st("cue2", 6.4, FI, textColor=colors.Color(.25, .25, .25))
    n, gap = 3, 8
    tw = (W - gap * (n - 1)) / n
    def tag(t):
        inner = [P(t["region"].upper(), st("tr", 7, FB, 8.5, textColor=colors.Color(.3, .3, .3))), P(t["text"], st("tt", 10.5, F, 12.6))]
        f = Table([[x] for x in inner], colWidths=[tw])
        f.setStyle(TableStyle(BASE + [("BOX", (0, 0), (-1, -1), 1, BLACK), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, -1), (-1, -1), 5)]))
        return f
    out = [section("Moulage tags", pad(P("Cut out; tape each tag on the matching body area (or hand over when the crew assesses it). "
                                          "Instructor notes print above the cut line, never on the tag.", SS)), W), Spacer(1, 4)]
    for i in range(0, len(tags), n):
        row = tags[i:i + n]; row_cells, cue_cells = [], []
        for k in range(n):
            t = row[k] if k < len(row) else None
            row_cells += [tag(t) if t else "", ""]; cue_cells += [P("INSTRUCTOR: " + t["cue"], CUE) if t and t.get("cue") else "", ""]
        widths = sum([[tw, gap] for _ in range(n)], [])[:-1]
        row_cells, cue_cells = row_cells[:-1], cue_cells[:-1]
        block = []
        if any(c for c in cue_cells):
            ct = Table([cue_cells], colWidths=widths); ct.setStyle(TableStyle(BASE + [("LEFTPADDING", (0, 0), (-1, -1), 1), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
            block += [ct, CutLine()]
        rt = Table([row_cells], colWidths=widths); rt.setStyle(TableStyle(BASE + [("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
        block += [rt, CutLine()]
        out.append(KeepTogether(block))
    return out + learn

# ---------------------------------------------------------------- provider-action catalog (schema/actions.json)
def load_actions():
    """Shared provider-action catalog next to the generator in the repo; None if absent (standalone use)."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "schema", "actions.json")
    try:
        with open(p, encoding="utf-8") as fh: return json.load(fh)
    except (OSError, ValueError): return None

ACTIONS = load_actions()
ACTION_IDS = {a["id"] for a in ACTIONS["actions"]} if ACTIONS else None

# ---------------------------------------------------------------- validation
RHYTHMS = {"sinus", "afib", "svt", "vt", "vf", "asystole", "chb", "avb1", "flutter"}
def validate(sc):
    """Return list of problems; build refuses to run if any."""
    errs = []
    # stage letter = optional vitals[].key, else first char of stage (Scenario Runner format; keep in sync with schema/ + src/lib/validate)
    letters = [str(v.get("key") or str(v.get("stage", "?"))[:1]).upper() for v in sc.get("vitals", [])]
    if len(set(letters)) != len(letters): errs.append(f"duplicate vitals stage letters: {letters}")
    flow_ids = [str(f.get("id") or f"p{i}") for i, f in enumerate(sc.get("flow", []))]
    if len(set(flow_ids)) != len(flow_ids): errs.append(f"duplicate flow ids: {flow_ids}")
    for i in sc.get("critical", []):
        if isinstance(i, dict) and not i.get("text"): errs.append("critical item object needs text")
    for f in sc.get("flow", []):
        pfx = f"flow '{f.get('phase')}'"
        if not f.get("expected"): errs.append(f"{pfx}: no expected actions")
        for i in f.get("expected", []) or []:
            if isinstance(i, dict) and not i.get("text"): errs.append(f"{pfx}: expected item object needs text")
            if isinstance(i, dict) and i.get("action") and ACTION_IDS is not None and i["action"] not in ACTION_IDS: errs.append(f"{pfx}: unknown action {i['action']!r}")
        for b in f.get("branches", []):
            BK = {"if", "then", "type", "goto_stage", "goto_phase", "id"}
            if set(b) - BK: errs.append(f"{pfx}: unknown branch keys {set(b) - BK}")
            if b.get("type") not in (None, "inject"): errs.append(f"{pfx}: branch type must be omitted or 'inject'")
            if not b.get("if") or not b.get("then"): errs.append(f"{pfx}: branch missing if/then"); continue
            if re.match(r"\s*(stage\b|advanced option)", b["if"], re.I): errs.append(f"{pfx}: IF '{b['if']}' is not a condition (use type:inject for examiner choices)")
            if len(b["if"]) > 75: errs.append(f"{pfx}: IF text > 75 chars")
            refs = []
            for m in re.findall(r"Stage \*\*([A-Z])\*\*|Stage ([A-Z])\b", b["then"]):
                L_ = (m[0] or m[1]); refs.append(L_)
                if L_ not in letters: errs.append(f"{pfx}: references Stage {L_} but vitals has {letters}")
            if "goto_stage" in b:
                g_ = b["goto_stage"]
                if g_ not in letters: errs.append(f"{pfx}: goto_stage {g_} is not a vitals stage {letters}")
                elif refs and g_ not in refs: errs.append(f"{pfx}: goto_stage {g_} disagrees with THEN text Stage {refs}")
            if "goto_phase" in b and b["goto_phase"] not in flow_ids: errs.append(f"{pfx}: goto_phase {b['goto_phase']} is not a flow id {flow_ids}")
            if re.search(r"critical fail|miss = fail", b["then"], re.I): errs.append(f"{pfx}: use 'critical (evaluator discretion)'")
    for a in sc.get("provider_actions", []):
        if ACTION_IDS is not None and a not in ACTION_IDS: errs.append(f"provider_actions: unknown action {a!r}")
    LEAK = re.compile(r"\b(if |show when|after |overbag|over-bag|rosc|pea\b|no pulse|stage |normal wave|square|shark|instructor|recheck|use vitals|t\+\d|good |during |analysis)", re.I)
    for c in sc.get("show_cards", []):
        face = " ".join(str(c.get(k, "")) for k in ("title", "caption", "body"))
        if LEAK.search(face): errs.append(f"show card '{c.get('title')}': instructor hint on card face ({LEAK.search(face).group(0)!r}) - move to 'cue'")
        if c.get("type") not in ("12lead", "strip", "capno", "text", "image"): errs.append(f"show card type {c.get('type')}")
        if c.get("type") in ("12lead", "strip") and c.get("rhythm", "sinus") not in RHYTHMS: errs.append(f"bad rhythm {c.get('rhythm')}")
    if "safety" in sc.get("scene", {}): errs.append("scene.safety present - scene safety is trained outside scenarios; remove it")
    for t in sc.get("moulage_tags", []):
        if not t.get("region") or not t.get("text"): errs.append("moulage tag needs region + text")
        elif LEAK.search(t["text"]): errs.append(f"moulage tag '{t['region']}': instructor hint on tag ({LEAK.search(t['text']).group(0)!r}) - move to 'cue'")
    if len(learn_prompt(sc)) > 480: errs.append(f"learn_more prompt {len(learn_prompt(sc))} chars > 480 (QR too dense to scan) - shorten focus")
    return errs

# ---------------------------------------------------------------- provider actions page (p.4)
def _action_options(a):
    """Circle-one choices / write-in blanks for an action's fields, e.g. 'Device: NC · NRB · BVM ... | ____ L/min'."""
    parts, fs = [], a.get("fields", [])
    for f in fs:
        k = f.get("kind")
        if k in ("select", "multi"):
            lab = f"**{f.get('label', '')}:** " if len(fs) > 1 else ""
            parts.append(lab + "  \u00b7  ".join(f.get("options", [])))
        elif k == "number": parts.append(f"____ {f.get('unit', '')}".rstrip())
        else: parts.append(f"{f.get('label', '')}: ________")
    return "  |  ".join(parts)

def relevant_action_ids(sc):
    """Scenario actions: ids linked from flow[].expected[] (flow order) + provider_actions (same rule as the app)."""
    ids = [i["action"] for f in sc.get("flow", []) for i in f.get("expected", []) if isinstance(i, dict) and i.get("action")]
    ids += sc.get("provider_actions", [])
    out = []
    for i in ids:
        if i in ACTION_IDS and i not in out: out.append(i)
    return out

def actions_page(sc):
    """PROVIDER ACTIONS: checkbox | action | options to circle | 3 time blanks | notes. Scenario actions, then common
    ones, then blank write-in rows - as many as fit one page (fonts stay at the sheet's normal sizes)."""
    by_id = {a["id"]: a for a in ACTIONS["actions"]}
    rel = relevant_action_ids(sc)
    common = [a["id"] for a in ACTIONS["actions"] if a.get("common") and a["id"] not in rel]
    widths = [11, 1.3 * inch, 0, .42 * inch, .42 * inch, .42 * inch, .95 * inch]
    widths[2] = W - sum(widths)
    head = [[P(h, st("pah", 6.6, FB)) for h in ("", "Action", "Circle what was done / write values", "Time", "Time", "Time", "Notes")]]
    def row(aid):
        a = by_id[aid]
        return [Box(), P(a["label"], SB), P(_action_options(a), SS), "", "", "", ""]
    def sub(t): return [P(t, st("pas", 6.6, FB)), "", "", "", "", "", ""]
    def table(rows, subs):
        ex = [("BACKGROUND", (0, r), (-1, r), LIGHT) for r in subs] + [("SPAN", (0, r), (-1, r)) for r in subs] + [("VALIGN", (0, 1), (0, -1), "MIDDLE")]
        return grid(head + rows, widths, header=True, extra=ex)
    avail = PH - 2 * M - 46  # frame minus section bar, legend and notes strip
    rows, subs = [], []
    def fits(r, s):
        return table(r, s).wrap(W, avail)[1] <= avail
    rows.append(sub("THIS SCENARIO")); subs.append(len(rows))
    for aid in rel: rows.append(row(aid))
    if common:
        r2, s2 = rows + [sub("COMMON ACTIONS")], subs + [len(rows) + 1]
        if fits(r2, s2):
            rows, subs = r2, s2
            for aid in common:
                if not fits(rows + [row(aid)], subs): break
                rows.append(row(aid))
    blank = [Box(), "", "", "", "", "", ""]
    r2, s2 = rows + [sub("OTHER (WRITE IN)")], subs + [len(rows) + 1]
    if fits(r2 + [blank], s2):
        rows, subs = r2, s2
        while fits(rows + [blank], subs): rows.append(blank)
    legend = P("Check the box when done; circle the options used and write values; one time per occurrence (actions can repeat). "
               "Intercept/MD rows = given by the paramedic / ordered by Medical Direction, not AEMT actions. "
               "The Scenario Runner logs the same actions with timestamps.", SS)
    return [section("Provider actions", [table(rows, subs), pad(legend)], right="check = done; circle what was done")]

# ---------------------------------------------------------------- page decoration
def deco(sc, role):
    def draw(c, doc):
        c.saveState(); c.setFont(FB, 7)
        c.drawString(M, PH - M + 6, f"{sc.get('id', '')}  |  {sc.get('title', '')}")
        c.drawRightString(PW - M, PH - M + 6, f"{role}  -  p.{doc.page}")
        c.setFont(F, 5.8); c.setFillColor(GREY)
        c.drawString(M, M - 12, "Simulated training material. Not for patient care. Verify all treatment against current VT Statewide EMS Protocols & agency SOPs.")
        c.drawRightString(PW - M, M - 12, sc.get("version", ""))
        c.restoreState()
    return draw

class CutLine(Flowable):
    def __init__(self, w=W): super().__init__(); self.width, self.height = w, 8
    def draw(self):
        c = self.canv; c.setDash(3, 2); c.setLineWidth(.5); c.line(0, 4, self.width, 4); c.setDash()
        c.setFont(F, 5.5); c.setFillColor(GREY); c.drawRightString(self.width, 6, "cut")

# ---------------------------------------------------------------- builders
def header_block(sc):
    meta = [("Type", sc.get("category", "")), ("Level", sc.get("level", "")), ("Run time", sc.get("run_time", "")),
            ("Difficulty", sc.get("difficulty", "")), ("Crew", sc.get("crew", ""))]
    cells = [Paragraph(f"<b>{md(k)}:</b> {md(v)}", S) for k, v in meta if v]
    top = Table([[Paragraph(md(sc["title"]), STITLE)] + cells], colWidths=[W * .40] + [W * .60 / max(len(cells), 1)] * len(cells))
    top.setStyle(TableStyle(BASE + [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, 0), 1.4, BLACK)]))
    rows = []
    if sc.get("protocols"): rows.append(("Protocols", " | ".join(sc["protocols"])))
    if sc.get("objectives"): rows.append(("Objectives", "  ".join(f"({i+1}) {o}" for i, o in enumerate(sc["objectives"]))))
    if sc.get("resources"): rows.append(("Resources", sc["resources"]))
    return [top, kv(rows, W, .75 * inch), Spacer(1, 3)]

def page1(sc):
    out = header_block(sc)
    pt, sn = sc.get("patient", {}), sc.get("scene", {})
    left_w = W * .52 - 2.5
    L = []
    L.append(section("Dispatch (read aloud)", pad(P(sc.get("dispatch", ""), SB)), left_w))
    L.append(Spacer(1, 3))
    srows = [(k.replace("_", " ").title(), v) for k, v in sn.items()]
    L.append(section("Scene / setup", kv(srows, left_w, .7 * inch), left_w))
    L.append(Spacer(1, 3))
    prow = [("Patient", f"{pt.get('name','')}  {pt.get('age','')} {pt.get('sex','')}  {pt.get('weight_kg','')} kg".strip()),
            ("Chief complaint", pt.get("cc", "")), ("On arrival", pt.get("on_arrival", ""))]
    L.append(section("Patient", kv([r for r in prow if r[1]], left_w, .78 * inch), left_w))
    hx = sc.get("history", {})
    right_w = W - 5 - left_w
    R = [section("SAMPLE (give when asked)", kv(hx.get("SAMPLE", []), right_w, .62 * inch), right_w), Spacer(1, 3),
         section("OPQRST", kv(hx.get("OPQRST", []), right_w, .62 * inch), right_w)]
    tc, _, _ = two_col(L, R, left_w)
    out += [tc, Spacer(1, 3)]
    out.append(section("Primary assessment", kv(sc.get("primary", []), W, .95 * inch, box=True), right="check = crew assessed"))
    out.append(Spacer(1, 3))
    sec = sc.get("secondary", [])
    if sec:
        half = (len(sec) + 1) // 2; hw = (W - 0.0) / 2
        a = kv(sec[:half], hw, .8 * inch, box=True); b = kv(sec[half:], hw, .8 * inch, box=True)
        t = Table([[a, b]], colWidths=[hw, hw]); t.setStyle(TableStyle(BASE + [("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0), ("LINEAFTER", (0, 0), (0, 0), .4, BLACK)]))
        out += [section("Secondary / focused exam", t, right="check = crew assessed"), Spacer(1, 3)]
    out += [vitals_block(sc), Spacer(1, 3), Lines(minh=26, label="SETUP / VITALS NOTES")]
    return out

VCOLS = [("Stage", .62), ("Trigger / when", 1.32), ("HR", .36), ("BP", .52), ("RR", .32), ("SpO2", .4), ("EtCO2", .4),
         ("BGL", .34), ("Temp", .4), ("Pain", .32), ("GCS", .32), ("Pupils", .5)]

def vitals_block(sc):
    used = sum(w for _, w in VCOLS) * inch
    widths = [w * inch for _, w in VCOLS] + [W - used]
    head = [P(c, st("vh", 6.6, FB)) for c, _ in VCOLS] + [P("Skin / lungs / ECG / other", st("vh", 6.6, FB))]
    data = [head]
    for r in sc.get("vitals", []):
        data.append([P(r.get("stage", ""), SB), P(r.get("trigger", ""), SS)] +
                    [P(r.get(k, "-"), st("vc", 7.4, FB if k in r.get("bold", []) else F)) for k, _ in VCOLS[2:]] + [P(r.get("other", ""), SS)])
    for _ in range(sc.get("blank_vitals_rows", 2)): data.append([P("ad lib", SS)] + [""] * (len(widths) - 1))
    t = grid(data, widths, header=True, zebra=True, extra=[("ROWBACKGROUNDS", (0, len(data) - sc.get("blank_vitals_rows", 2)), (-1, -1), [colors.white]), ("TOPPADDING", (0, 1), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 1), (-1, -1), 2.2)])
    note = sc.get("vitals_note", "Give a value only when the crew obtains it. Bold = abnormal / key change.")
    return section("Vitals progression", [t], right=note)

def flow_block(sc):
    widths = [.5 * inch, 1.2 * inch, 2.75 * inch, 2.65 * inch]; widths.append(W - sum(widths))
    data = [[P(h, st("fh", 6.6, FB)) for h in ("Time", "Phase / trigger", "Instructor: say / give / branch", "Expected crew actions", "Time / init")]]
    for ph in sc.get("flow", []):
        give = [P(ph.get("give", ""))]
        for br in sorted(ph.get("branches", []), key=lambda b: b.get("type") == "inject"):
            tag = "<b>EXAMINER OPTION:</b>" if br.get("type") == "inject" else "<b>IF</b>"
            give.append(Paragraph(f"{tag} {md(br['if'])} <b>&rarr;</b> {md(br['then'])}", st("br", 7, F, leftIndent=6, firstLineIndent=-6)))
        exp = checklist(ph.get("expected", []), widths[3] - 5)
        data.append([P(ph.get("time", ""), SB), P(ph.get("phase", ""), SB), give, exp, ""])
    return section("Scenario flow", grid(data, widths, header=True, extra=[("LEFTPADDING", (3, 1), (3, -1), 1)]),
                   right="Advance on crew action OR clock, whichever first")

def page2(sc):
    out = [flow_block(sc), Spacer(1, 3)]
    cw = W * .42
    crit = section("Critical actions (instructor discretion)", checklist(sc.get("critical", []), cw - 4), cw)
    dx = sc.get("differentials", [])
    dw = W - cw - 5
    dwid = [.95 * inch, (dw - .95 * inch) * .5, (dw - .95 * inch) * .5]
    dt = grid([[P("Differential", st("x", 6.6, FB)), P("Supports", st("x", 6.6, FB)), P("Against / rule-out", st("x", 6.6, FB))]] +
              [[P(d[0], SB), P(d[1], SS), P(d[2], SS)] for d in dx], dwid, header=True)
    t, _, _ = two_col(crit, section("Differentials", dt, dw), cw)
    out += [t, Spacer(1, 3)]
    deb = sc.get("debrief", [])
    db = section("Debrief prompts", pad(P("\n".join(f"- {q}" for q in deb), S)), cw) if deb else Spacer(1, 0)
    res = Table([[Box(), P("Pass", SB), Box(), P("Remediate", SB), Box(), P("Fail", SB)],
                 [P("Trainee: ____________________   Evaluator: ____________________   Date: ________", S), "", "", "", "", ""]],
                colWidths=[11, .5 * inch, 11, .75 * inch, 11, dw - 33 - 1.25 * inch])
    res.setStyle(TableStyle(BASE + [("SPAN", (0, 1), (-1, 1)), ("TOPPADDING", (0, 1), (-1, 1), 5)]))
    t2, _, _ = two_col(db, section("Result", res, dw), cw)
    out += [t2, Spacer(1, 3), Lines(label="NOTES")]
    return out

def show_card(c, tmp, idx, full_w):
    kind = c.get("type", "text")
    title = c.get("title", "")
    if kind == "text":
        body = [P(title, SBIGB), Spacer(1, 2), P(c.get("body", ""), SBIG)]
        return body, c.get("width", "half")
    path = os.path.join(tmp, f"card{idx}.png")
    if kind == "12lead":
        twelve_png(path, c.get("rhythm", "sinus"), c.get("rate", 75), c.get("st", {}), width_in=full_w / inch - .1, height_in=2.8,
                   **{k: c[k] for k in ("p_rate",) if k in c})
        img = Image(path, width=full_w - 7, height=2.8 * inch * (full_w - 7) / (full_w - .1 * inch)); wd = "full"
    elif kind == "strip":
        wd = c.get("width", "full"); wi = (full_w if wd == "full" else full_w / 2 - 6) / inch - .1
        strip_png(path, c.get("rhythm", "sinus"), c.get("rate", 75), c.get("lead", "II"), c.get("st", 0), c.get("seconds", 8 if wd == "full" else 4),
                  width_in=wi, height_in=1.0, **{k: c[k] for k in ("p_rate",) if k in c})
        img = Image(path, width=wi * inch - 4, height=1.0 * inch * (wi * inch - 4) / (wi * inch))
    elif kind == "capno":
        wd = c.get("width", "half"); wi = (full_w if wd == "full" else full_w / 2 - 6) / inch - .1
        capno_png(path, c.get("pattern", "normal"), c.get("etco2", 38), c.get("rr", 14), width_in=wi, height_in=1.1)
        img = Image(path, width=wi * inch - 4, height=1.1 * inch * (wi * inch - 4) / (wi * inch))
    elif kind == "image":
        wd = c.get("width", "half"); img = Image(c["path"]); r = img.imageHeight / img.imageWidth
        iw = (full_w if wd == "full" else full_w / 2 - 6) - 6; img.drawWidth, img.drawHeight = iw, iw * r
    cap = [P(title, st("ct", 9, FB, 11))]
    if c.get("caption"): cap.append(P(c["caption"], SS))
    return cap + [img], wd

def card_frame(content, w):
    t = Table([[c] for c in content], colWidths=[w]); t.setStyle(TableStyle(BASE + [("BOX", (0, 0), (-1, -1), 1, BLACK), ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)])); return t

def handouts(sc, tmp):
    """Cut pieces carry only what the device/scene would show. Instructor-only `cue` text prints in a scrap strip
    ABOVE the dashed cut line, never on the piece handed to the crew."""
    out = []
    hw = (W - 10) / 2
    CUE = st("cue", 6.6, FI, textColor=colors.Color(.25, .25, .25))
    crew = sc.get("crew_card", {})
    cc = [P("CREW CARD", st("cc", 8, FB)), P(crew.get("dispatch", sc.get("dispatch", "")), SBIG)]
    if crew.get("on_arrival"): cc += [Spacer(1, 3), P("On arrival", st("oa", 8, FB)), P(crew["on_arrival"], SBIG)]
    act = sc.get("actor_card", {})
    ac = [P("PATIENT ACTOR CARD", st("ac", 8, FB))]
    for k, v in act.items(): ac.append(Paragraph(f"<b>{md(k)}:</b> {md(v)}", st("a", 8, F, 10)))
    t = Table([[card_frame(cc, hw), "", card_frame(ac, hw)]], colWidths=[hw, 10, hw])
    t.setStyle(TableStyle(BASE + [("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    out += [t, CutLine()]

    def cue_p(c):
        return P("INSTRUCTOR (not on card): " + c["cue"], CUE) if c and c.get("cue") else ""

    def emit(cards, full):
        """cards: list of (frame, card_json). Returns flowables: [cue strip + cut] + card row + cut."""
        rows = []
        if any(c.get("cue") for _, c in cards):
            if full: cues = Table([[cue_p(cards[0][1])]], colWidths=[W])
            else:
                cs = [cue_p(c) for _, c in cards] + [""] * (2 - len(cards))
                cues = Table([[cs[0], "", cs[1]]], colWidths=[hw, 10, hw])
            cues.setStyle(TableStyle(BASE + [("LEFTPADDING", (0, 0), (-1, -1), 1), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
            rows += [cues, CutLine()]
        rows += [cards[0][0] if full else half_row([f for f, _ in cards], hw), CutLine()]
        return [KeepTogether(rows)]

    pending = []
    for i, c in enumerate(sc.get("show_cards", [])):
        body, wd = show_card(c, tmp, i, W)
        if wd == "full":
            if pending: out += emit(pending, False); pending = []
            out += emit([(card_frame(body, W), c)], True)
        else:
            pending.append((card_frame(body, hw), c))
            if len(pending) == 2: out += emit(pending, False); pending = []
    if pending: out += emit(pending, False)
    return out

def half_row(cards, hw):
    cards = cards + [""] * (2 - len(cards))
    t = Table([[cards[0], "", cards[1]]], colWidths=[hw, 10, hw]); t.setStyle(TableStyle(BASE + [("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)])); return t

def build(sc, out_pdf):
    tmp = tempfile.mkdtemp()
    doc = BaseDocTemplate(out_pdf, pagesize=letter, leftMargin=M, rightMargin=M, topMargin=M, bottomMargin=M,
                          title=sc.get("title", "Scenario"), author="EMS scenario generator")
    fr = lambda: [Frame(M, M, W, PH - 2 * M, 0, 0, 0, 0)]
    doc.addPageTemplates([PageTemplate("inst", fr(), onPage=deco(sc, "INSTRUCTOR")),
                          PageTemplate("hand", fr(), onPage=deco(sc, "HANDOUTS & SHOW CARDS - cut on dashed lines"))])
    acts = [PageBreak()] + actions_page(sc) if ACTIONS else []  # p.4 when schema/actions.json is present
    story = page1(sc) + [PageBreak()] + page2(sc) + [PageBreak()] + flowchart_page(sc, tmp) + acts + [NextPageTemplate("hand"), PageBreak()] + handouts(sc, tmp) + [PageBreak()] + moulage_page(sc, tmp)
    doc.build(story)
    return doc.page

if __name__ == "__main__":
    sc = json.load(open(sys.argv[1]))
    problems = validate(sc)
    if problems: sys.exit("VALIDATION FAILED:\n  " + "\n  ".join(problems))
    n = build(sc, sys.argv[2])
    print(f"wrote {sys.argv[2]} ({n} pages)")
