// pdf.js wrapper for the protocol viewer. This module is only ever loaded with import() when the drawer first
// opens, so pdf.js (and its locally bundled worker) are not part of the main bundle.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { locatePage } from "./locate.ts";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl; // relative asset URL from Vite (works with base "./")

let docPromise: Promise<PDFDocumentProxy> | null = null;
let texts: Promise<string[]> | null = null;

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  // Fetch on the main thread (same-origin, goes through the service worker cache), then hand the bytes to pdf.js.
  docPromise ??= fetch(url)
    .then((r) => {
      if (!r.ok || !/pdf/i.test(r.headers.get("content-type") ?? "")) throw new Error(`${url}: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => pdfjs.getDocument({ data: new Uint8Array(buf) }).promise);
  docPromise.catch(() => (docPromise = null));
  return docPromise;
}

async function allTexts(doc: PDFDocumentProxy): Promise<string[]> {
  texts ??= (async () => {
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out.push(tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join(""));
    }
    return out;
  })();
  return texts;
}

/** Page for a protocol: the committed index page, else a text search of the PDF (cached), else 1. */
export async function findPage(doc: PDFDocumentProxy, num: string, title: string, indexed: number | null): Promise<number> {
  if (indexed && indexed <= doc.numPages) return indexed;
  return locatePage(num, title, await allTexts(doc)) ?? 1;
}

export async function renderPage(doc: PDFDocumentProxy, n: number, canvas: HTMLCanvasElement, cssWidth: number, zoom: number) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  const scale = (cssWidth / base.width) * zoom;
  const vp = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
  canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
  await page.render({ canvas, viewport: vp }).promise;
}
