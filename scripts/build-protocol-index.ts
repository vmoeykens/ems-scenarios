// npm run protocol-index [pdf] [out]   (also runs as `prebuild`)
// Reads the VT protocols PDF with pdfjs-dist and fills `page` in src/data/protocol-index.json (titles come from the
// committed index, seeded from the docs/reference TOC). Skips quietly (exit 0) when the PDF is not in public/protocols/.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { locateAll } from "../src/lib/protocols/locate.ts";
import type { ProtocolIndex } from "../src/lib/protocols/refs.ts";

const pdfPath = process.argv[2] ?? "public/protocols/vt-ems-protocols-2025.pdf";
const outPath = process.argv[3] ?? "src/data/protocol-index.json";

export async function pageTexts(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fonts = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;
  const task = pdfjs.getDocument({ data, standardFontDataUrl: fonts });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join(""));
  }
  await task.destroy();
  return pages;
}

async function main() {
  if (!existsSync(pdfPath)) {
    console.log(`protocol index: ${pdfPath} not found - skipped (index keeps titles, pages stay as committed)`);
    return;
  }
  const seed = JSON.parse(readFileSync(outPath, "utf8")) as ProtocolIndex;
  const pages = await pageTexts(new Uint8Array(readFileSync(pdfPath)));
  const { index, found } = locateAll(seed, pages);
  writeFileSync(outPath, JSON.stringify(index, null, 1) + "\n");
  const missing = Object.entries(index)
    .filter(([, e]) => !e.page)
    .map(([n]) => n);
  console.log(`protocol index: ${pages.length} pages, located ${found}/${Object.keys(index).length} protocols -> ${outPath}`);
  if (missing.length)
    console.log(`  not located (${missing.length}; the viewer searches the text at open time): ${missing.slice(0, 30).join(", ")}${missing.length > 30 ? ", ..." : ""}`);
}

void main();
