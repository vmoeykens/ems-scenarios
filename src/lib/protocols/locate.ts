// Find the PDF page where each protocol starts, from per-page text. Shared by scripts/build-protocol-index.ts
// (build time) and the in-app viewer (fallback when the committed index has page: null).
// Protocol pages carry the title and the number as separate header pieces (e.g. "Acute Coronary Syndrome / Adult /
// 3.0"), often without the A/P suffix, so a page matches when it has the title's first words, the Adult/Pediatric
// qualifier and the base number as a token. Table-of-contents pages are skipped.
import type { ProtocolIndex } from "./refs.ts";

/** lower-case words; keeps dots inside numbers ("3.0a"); drops dashes/punctuation */
export const normWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function isTocPage(text: string): boolean {
  return /table of contents/i.test(text);
}

export function pageMatches(num: string, title: string, pageText: string): boolean {
  const t = ` ${normWords(pageText)} `;
  const words = normWords(title).split(" ");
  const key = words.filter((w) => w !== "adult" && w !== "pediatric" && w !== "and").slice(0, 3).join(" ");
  if (!key || !t.includes(` ${key}`)) return false;
  if (words.includes("adult") && !words.includes("pediatric") && !t.includes(" adult ")) return false;
  if (words.includes("pediatric") && !words.includes("adult") && !t.includes(" pediatric ")) return false;
  const base = num.toLowerCase().replace(/[ap]$/, "").replace(".", "\\.");
  return new RegExp(` ${base}[ap]? `).test(t);
}

/** First non-TOC page (1-based) where the protocol's header appears, or null. */
export function locatePage(num: string, title: string, pages: string[]): number | null {
  for (let i = 0; i < pages.length; i++) {
    if (isTocPage(pages[i])) continue;
    if (pageMatches(num, title, pages[i])) return i + 1;
  }
  return null;
}

/** Fill page numbers for every entry; returns a new index and the count found. */
export function locateAll(index: ProtocolIndex, pages: string[]): { index: ProtocolIndex; found: number } {
  const out: ProtocolIndex = {};
  let found = 0;
  for (const [num, e] of Object.entries(index)) {
    const page = locatePage(num, e.title, pages);
    if (page) found++;
    out[num] = { title: e.title, page: page ?? e.page };
  }
  return { index: out, found };
}
