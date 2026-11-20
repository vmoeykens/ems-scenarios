// Protocol references in scenario text ("3.0A Acute Coronary Syndrome", "(2.8A)", "per 2.24A", "2.22A/P") ->
// links, but only for numbers that exist in the VT protocol index (avoids "0.3 mg", "1.5 L", "98.2", BP, times).
import indexJson from "../../data/protocol-index.json" with { type: "json" };

export interface ProtocolEntry {
  title: string;
  /** 1-based page in the PDF where the protocol starts; null until scripts/build-protocol-index.ts has run */
  page: number | null;
}
export type ProtocolIndex = Record<string, ProtocolEntry>;

export const PROTOCOL_INDEX: ProtocolIndex = indexJson as ProtocolIndex;

export const OFFICIAL_PDF_URL = "https://www.healthvermont.gov/sites/default/files/document/eprip-2025-EMS-Protocols_0.pdf";
/** Local copy (relative to the app; works from the GitHub Pages sub-path). Optional: may be absent. */
export const LOCAL_PDF_PATH = "protocols/vt-ems-protocols-2025.pdf";

export type Segment = { text: string; ref?: undefined } | { text: string; ref: string };

/**
 * Candidate: N.N / NN.NN with optional A|P suffix and optional "/A" or "/P" alternate (2.22A/P), or appendix A.N.
 * Not preceded by a digit, dot, letter or "+" (rejects 98.2's "8.2", "T+8", "v1.1"), not followed by a digit / dot-digit
 * (rejects "1.5.2"), and not followed by a unit ("0.4 mg", "1.5 L", "2.5 mm").
 */
const CANDIDATE =
  /(?<![\w.+/-])(\d{1,2}\.\d{1,2}[AP]?|A\.\d{1,2})(\/[AP])?(?![\w]|\.\d)(?!\s?(?:(?:mg|mcg|g|kg|mL|ml|L|l|mm|cm|in|min|sec|s|h|hr|hrs|mmHg|units?|joules?|J)\b|%))/g;

export interface RawRef {
  /** start offset in the text */
  index: number;
  /** the matched text, e.g. "2.22A/P" */
  match: string;
  /** protocol numbers it refers to, e.g. ["2.22A", "2.22P"] */
  numbers: string[];
}

/** Parse protocol-number candidates (no index check). "2.22A/P" -> 2.22A + 2.22P. */
export function parseProtocolNumbers(text: string): RawRef[] {
  const out: RawRef[] = [];
  for (const m of text.matchAll(CANDIDATE)) {
    const base = m[1];
    const nums = [base];
    if (m[2]) nums.push(base.replace(/[AP]$/, "") + m[2].slice(1));
    out.push({ index: m.index!, match: m[0], numbers: nums });
  }
  return out;
}

/** Split text into plain segments and protocol-link segments; only numbers present in `index` become links. */
export function linkifyProtocols(text: string, index: ProtocolIndex = PROTOCOL_INDEX): Segment[] {
  const segs: Segment[] = [];
  let pos = 0;
  const push = (t: string, ref?: string) => {
    if (!t) return;
    if (ref) segs.push({ text: t, ref });
    else if (segs.length && segs[segs.length - 1].ref === undefined) segs[segs.length - 1] = { text: segs[segs.length - 1].text + t };
    else segs.push({ text: t });
  };
  for (const r of parseProtocolNumbers(text)) {
    const [first, alt] = r.numbers;
    if (!index[first]) continue;
    push(text.slice(pos, r.index));
    if (alt && index[alt]) {
      // "2.22A/P" -> [2.22A] "/" [P]
      const slash = r.match.indexOf("/");
      push(r.match.slice(0, slash), first);
      push("/");
      push(r.match.slice(slash + 1), alt);
    } else {
      push(alt ? r.match.slice(0, r.match.indexOf("/")) : r.match, first);
      if (alt) push(r.match.slice(r.match.indexOf("/")));
    }
    pos = r.index + r.match.length;
  }
  push(text.slice(pos));
  return segs;
}

/** All protocol numbers (in the index) referenced by a text, in order, de-duplicated. */
export function protocolRefs(text: string, index: ProtocolIndex = PROTOCOL_INDEX): string[] {
  return [...new Set(linkifyProtocols(text, index).flatMap((s) => (s.ref ? [s.ref] : [])))];
}
