// Moulage tags as ZPL II labels for Zebra-compatible thermal printers.
// One ^XA..^XZ block per tag. Only what the crew perceives is printed: region + finding text.
// The instructor `cue` is never printed (see tests/labels.test.ts leak test).
import type { MoulageTag } from "../scenario/types.ts";
import { stripMarkup } from "../scenario/text.ts";

export type Dpi = 203 | 300 | 600;
export const DPIS: Dpi[] = [203, 300, 600];

export interface LabelSize {
  id: string;
  name: string;
  /** label width / height in inches, as loaded in the printer (width = across the print head) */
  widthIn: number;
  heightIn: number;
}

export const PRESETS: LabelSize[] = [
  { id: "small", name: 'Small 2" x 1"', widthIn: 2, heightIn: 1 },
  { id: "large", name: 'Large 4" x 3"', widthIn: 4, heightIn: 3 },
];

export interface LabelOptions {
  widthIn: number;
  heightIn: number;
  dpi: Dpi;
  /** print the body region (e.g. "R forehead") as a small header line */
  region: boolean;
  /** thin border around the label */
  border: boolean;
  /** small "SIMULATED" marker in the bottom corner */
  simulated: boolean;
  copies: number;
}

export const DEFAULT_OPTIONS: LabelOptions = {
  widthIn: PRESETS[0].widthIn,
  heightIn: PRESETS[0].heightIn,
  dpi: 203,
  region: true,
  border: false,
  simulated: true,
  copies: 1,
};

export const LIMITS = { minIn: 0.75, maxWidthIn: 4.25, maxHeightIn: 12, maxCopies: 20 };

/** A positioned text line; x/y = top-left of the field in dots (ZPL ^FO), size = font height/width in dots. */
export interface LabelText {
  x: number;
  y: number;
  size: number;
  text: string;
  bold?: boolean;
  /** right-align at x (used for the SIMULATED marker) */
  anchorEnd?: boolean;
}

export interface LabelLayout {
  w: number;
  h: number;
  texts: LabelText[];
  /** horizontal rule under the region line */
  rules: { x: number; y: number; w: number; t: number }[];
  border: boolean;
  /** body text could not fit even at the minimum size and was cut with "..." */
  overflow: boolean;
}

/** Rough average advance width of Zebra font 0 (CG Triumvirate Bold Condensed) as a fraction of its height. */
const CHAR_W = 0.56;
/** Uppercase runs wider. */
const CAPS_W = 0.64;
const LINE_H = 1.15;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function clampOptions(o: Partial<LabelOptions>): LabelOptions {
  const m = { ...DEFAULT_OPTIONS, ...o };
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    widthIn: clamp(num(m.widthIn, DEFAULT_OPTIONS.widthIn), LIMITS.minIn, LIMITS.maxWidthIn),
    heightIn: clamp(num(m.heightIn, DEFAULT_OPTIONS.heightIn), LIMITS.minIn, LIMITS.maxHeightIn),
    dpi: DPIS.includes(m.dpi) ? m.dpi : 203,
    region: !!m.region,
    border: !!m.border,
    simulated: !!m.simulated,
    copies: Math.round(clamp(num(m.copies, 1), 1, LIMITS.maxCopies)),
  };
}

/** Tag text as printed: markup removed, arrows as ASCII, whitespace collapsed. */
export function labelText(s: string): string {
  return stripMarkup(s).replace(/->|→/g, "->").replace(/\s+/g, " ").trim();
}

/** Greedy word wrap to maxChars per line; words longer than a line are hard-split. */
export function wrap(text: string, maxChars: number): string[] {
  const n = Math.max(1, Math.floor(maxChars));
  const lines: string[] = [];
  let cur = "";
  for (let word of text.split(" ").filter(Boolean)) {
    while (word.length > n) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(word.slice(0, n));
      word = word.slice(n);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= n) cur += " " + word;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Largest font that fits `text` in a box; returns lines + size. */
function fit(text: string, boxW: number, boxH: number, maxSize: number, minSize: number): { size: number; lines: string[]; overflow: boolean } {
  for (let size = Math.floor(maxSize); size >= minSize; size -= 1) {
    const lines = wrap(text, boxW / (size * CHAR_W));
    if (lines.length * size * LINE_H - (LINE_H - 1) * size <= boxH) return { size, lines, overflow: false };
  }
  const size = Math.ceil(minSize);
  const maxLines = Math.max(1, Math.floor((boxH + (LINE_H - 1) * size) / (size * LINE_H)));
  const lines = wrap(text, boxW / (size * CHAR_W));
  if (lines.length <= maxLines) return { size, lines, overflow: false };
  const cut = lines.slice(0, maxLines);
  const maxChars = Math.floor(boxW / (size * CHAR_W));
  cut[maxLines - 1] = cut[maxLines - 1].slice(0, Math.max(1, maxChars - 3)).trimEnd() + "...";
  return { size, lines: cut, overflow: true };
}

export function layoutTag(tag: MoulageTag, opts: LabelOptions): LabelLayout {
  const { dpi } = opts;
  const w = Math.round(opts.widthIn * dpi);
  const h = Math.round(opts.heightIn * dpi);
  const m = Math.round(0.07 * dpi);
  const gap = Math.round(0.035 * dpi);
  const texts: LabelText[] = [];
  const rules: LabelLayout["rules"] = [];
  const innerW = w - 2 * m;
  let top = m;

  const small = clamp(Math.round(h * 0.13), Math.round(0.085 * dpi), Math.round(0.15 * dpi));
  if (opts.region) {
    const region = labelText(tag.region).toUpperCase();
    // shrink a long region a little before cutting it
    const rs = Math.max(Math.round(0.065 * dpi), Math.min(small, Math.floor(innerW / (Math.max(1, region.length) * CAPS_W))));
    const maxChars = innerW / (rs * CAPS_W);
    const r = region.length > maxChars ? region.slice(0, Math.max(1, Math.floor(maxChars) - 3)) + "..." : region;
    texts.push({ x: m, y: top + (small - rs), size: rs, text: r, bold: true });
    top += small + gap;
    const t = Math.max(2, Math.round(0.01 * dpi));
    rules.push({ x: m, y: top, w: innerW, t });
    top += t + gap;
  }

  let bottom = h - m;
  if (opts.simulated) {
    const fs = Math.max(Math.round(0.07 * dpi), Math.round(small * 0.75));
    texts.push({ x: w - m, y: h - m - fs, size: fs, text: "SIMULATED", anchorEnd: true });
    bottom -= fs + gap;
  }

  const bodyH = Math.max(1, bottom - top);
  const maxSize = Math.min(Math.round(0.4 * dpi), bodyH);
  const minSize = Math.round(0.075 * dpi);
  const f = fit(labelText(tag.text), innerW, bodyH, maxSize, minSize);
  f.lines.forEach((ln, i) => texts.push({ x: m, y: Math.round(top + i * f.size * LINE_H), size: f.size, text: ln }));

  return { w, h, texts, rules, border: opts.border, overflow: f.overflow };
}

/** ^FD data with ^FH hex escapes for the ZPL control characters (^ ~) and the escape char itself (_). */
export function zplEscape(s: string): string {
  return s.replace(/_/g, "_5F").replace(/\^/g, "_5E").replace(/~/g, "_7E");
}

export function layoutToZpl(l: LabelLayout, copies = 1): string {
  const out = ["^XA", "^CI28", `^PW${l.w}`, `^LL${l.h}`, "^LH0,0"];
  if (l.border) {
    const t = Math.max(2, Math.round(l.w / 200));
    out.push(`^FO0,0^GB${l.w},${l.h},${t}^FS`);
  }
  for (const r of l.rules) out.push(`^FO${r.x},${r.y}^GB${r.w},${r.t},${r.t}^FS`);
  for (const t of l.texts) {
    if (t.anchorEnd) {
      // ^FB right-justified field block ending at x
      const bw = Math.max(1, t.x);
      out.push(`^FO0,${t.y}^A0N,${t.size},${t.size}^FB${bw},1,0,R,0^FH^FD${zplEscape(t.text)}^FS`);
    } else out.push(`^FO${t.x},${t.y}^A0N,${t.size},${t.size}^FH^FD${zplEscape(t.text)}^FS`);
  }
  out.push(`^PQ${Math.max(1, Math.round(copies))}`, "^XZ");
  return out.join("\n");
}

export interface LabelJob {
  zpl: string;
  layouts: LabelLayout[];
  /** indexes (into the tags passed in) whose text had to be cut */
  overflow: number[];
}

/** ZPL for a set of tags; one label per tag, `copies` of each. */
export function buildLabels(tags: MoulageTag[], options: Partial<LabelOptions>): LabelJob {
  const opts = clampOptions(options);
  const layouts = tags.map((t) => layoutTag(t, opts));
  return {
    zpl: layouts.map((l) => layoutToZpl(l, opts.copies)).join("\n") + "\n",
    layouts,
    overflow: layouts.flatMap((l, i) => (l.overflow ? [i] : [])),
  };
}

export const labelFileName = (scenarioId: string | undefined, o: LabelOptions) =>
  `${(scenarioId || "scenario").replace(/[^A-Za-z0-9_-]+/g, "_")}_moulage_${o.widthIn}x${o.heightIn}in_${o.dpi}dpi.zpl`;

// ---------------------------------------------------------------- settings (one small localStorage key)
export const LABEL_SETTINGS_KEY = "scenario-runner:zpl-labels";

export function loadLabelSettings(): LabelOptions {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(LABEL_SETTINGS_KEY);
    return clampOptions(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveLabelSettings(o: LabelOptions): void {
  try {
    localStorage.setItem(LABEL_SETTINGS_KEY, JSON.stringify(o));
  } catch {
    /* storage unavailable: settings just aren't remembered */
  }
}
