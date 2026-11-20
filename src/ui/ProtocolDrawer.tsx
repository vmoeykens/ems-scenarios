// Protocol viewer: right-side drawer on wide screens, full-screen sheet on tablets. pdf.js is loaded on first open.
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { LOCAL_PDF_PATH, PROTOCOL_INDEX } from "../lib/protocols/refs.ts";

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

export default function ProtocolDrawer({ num, onClose }: { num: string; onClose: () => void }) {
  const entry = PROTOCOL_INDEX[num];
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("Loading protocols PDF...");
  const canvas = useRef<HTMLCanvasElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const lib = useRef<typeof import("../lib/protocols/pdf.ts") | null>(null);

  // load pdf.js + document, then find the protocol's first page
  useEffect(() => {
    let live = true;
    setPage(null);
    setStatus("Loading protocols PDF...");
    (async () => {
      try {
        lib.current ??= await import("../lib/protocols/pdf.ts");
        const d = await lib.current.loadPdf(LOCAL_PDF_PATH);
        if (!live) return;
        setDoc(d);
        if (!entry?.page) setStatus(`Finding ${num} in the PDF...`);
        const p = await lib.current.findPage(d, num, entry?.title ?? "", entry?.page ?? null);
        if (live) setPage(p);
      } catch (e) {
        if (live) setStatus(`Could not open the protocols PDF: ${(e as Error).message}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [num, entry]);

  // render current page
  useEffect(() => {
    if (!doc || !page || !canvas.current || !lib.current) return;
    let live = true;
    const w = Math.max(280, (body.current?.clientWidth ?? 600) - 16);
    setStatus("");
    lib.current.renderPage(doc, page, canvas.current, w, zoom).catch((e) => live && setStatus(`Render failed: ${(e as Error).message}`));
    return () => {
      live = false;
    };
  }, [doc, page, zoom]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (!doc || !page) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") setPage(Math.min(doc.numPages, page + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setPage(Math.max(1, page - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [doc, page, onClose]);

  const zi = ZOOMS.indexOf(zoom);
  return (
    <aside className="proto-drawer no-print" role="dialog" aria-label={`Protocol ${num}`} data-testid="protocol-drawer">
      <div className="section-bar items-center min-h-10">
        <span className="truncate">
          VT protocol {num} {entry?.title}
        </span>
        <button type="button" className="text-paper px-3 min-h-10 font-bold" onClick={onClose} aria-label="Close protocol">
          X
        </button>
      </div>
      <div className="proto-toolbar">
        <button type="button" className="sheet-btn" disabled={!page || page <= 1} onClick={() => page && setPage(page - 1)} aria-label="Previous page">
          &lsaquo; Prev
        </button>
        <span className="text-sm tabular-nums px-1" data-testid="protocol-page">
          {page && doc ? `p. ${page} / ${doc.numPages}` : "p. -"}
        </span>
        <button type="button" className="sheet-btn" disabled={!page || !doc || page >= doc.numPages} onClick={() => page && setPage(page + 1)} aria-label="Next page">
          Next &rsaquo;
        </button>
        <button type="button" className="sheet-btn ml-2 w-11 text-center" disabled={zi <= 0} onClick={() => setZoom(ZOOMS[zi - 1])} aria-label="Zoom out">
          -
        </button>
        <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" className="sheet-btn w-11 text-center" disabled={zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zi + 1])} aria-label="Zoom in">
          +
        </button>
        <a className="sheet-btn flex items-center ml-auto text-sm" href={`${LOCAL_PDF_PATH}#page=${page ?? 1}`} target="_blank" rel="noopener noreferrer">
          Open full PDF
        </a>
        <button type="button" className="sheet-btn text-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="proto-body" ref={body}>
        {status && <p className="p-2 text-sm">{status}</p>}
        <canvas ref={canvas} className="block mx-auto border border-ink" aria-label={`Protocol ${num}, page ${page ?? ""}`} />
      </div>
      <div className="text-xs text-cue px-2 py-1 border-t border-ink">
        VT Statewide EMS Protocols 2025 (reproduced as permitted). Verify against the current official version.
      </div>
    </aside>
  );
}
