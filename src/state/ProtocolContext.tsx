// Protocol links on instructor screens -> drawer with the local VT protocols PDF (pdf.js), or, when the local copy
// is not installed (public/protocols/ missing the PDF), a plain link to the official PDF in a new tab.
// Not provided on the student display, so Md() there never creates links.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LOCAL_PDF_PATH, OFFICIAL_PDF_URL, PROTOCOL_INDEX } from "../lib/protocols/refs.ts";
import ProtocolDrawer from "../ui/ProtocolDrawer.tsx";

type Availability = "unknown" | "local" | "missing";

interface ProtoCtx {
  availability: Availability;
  open(num: string): void;
  /** link target for a protocol: local PDF page (new tab fallback) or the official PDF */
  hrefFor(num: string): string;
}

const Ctx = createContext<ProtoCtx | null>(null);
export const useProtocols = () => useContext(Ctx);

let availabilityCache: Promise<Availability> | null = null;
/** One same-origin HEAD request (no external calls): is the PDF bundled with this deployment? */
export function checkLocalPdf(): Promise<Availability> {
  availabilityCache ??= fetch(LOCAL_PDF_PATH, { method: "HEAD", cache: "no-cache" })
    .then((r) => (r.ok && /pdf/i.test(r.headers.get("content-type") ?? "") ? "local" : "missing") as Availability)
    .catch(() => "missing" as Availability);
  return availabilityCache;
}

export function ProtocolProvider({ children }: { children: ReactNode }) {
  const [availability, setAvailability] = useState<Availability>("unknown");
  const [openNum, setOpenNum] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void checkLocalPdf().then((a) => live && setAvailability(a));
    return () => {
      live = false;
    };
  }, []);
  const value: ProtoCtx = {
    availability,
    open: (num) => setOpenNum(num),
    hrefFor: (num) => (availability === "local" ? `${LOCAL_PDF_PATH}#page=${PROTOCOL_INDEX[num]?.page ?? 1}` : OFFICIAL_PDF_URL),
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {openNum && <ProtocolDrawer num={openNum} onClose={() => setOpenNum(null)} />}
    </Ctx.Provider>
  );
}

/** A protocol number rendered as a link (drawer when the local PDF exists, else the official PDF in a new tab). */
export function ProtocolLink({ num, children }: { num: string; children: ReactNode }) {
  const ctx = useProtocols();
  const entry = PROTOCOL_INDEX[num];
  if (!ctx || !entry) return <>{children}</>;
  return (
    <a
      className="proto-link"
      href={ctx.hrefFor(num)}
      target="_blank"
      rel="noopener noreferrer"
      title={`VT protocol ${num} ${entry.title}`}
      data-protocol={num}
      onClick={(e) => {
        e.stopPropagation();
        if (ctx.availability === "local") {
          e.preventDefault();
          ctx.open(num);
        }
      }}
    >
      {children}
    </a>
  );
}
