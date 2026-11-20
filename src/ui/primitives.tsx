// Paper-sheet primitives: the web equivalents of section(), grid(), Box and CutLine in tools/ems_scenario.py.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FOOTER } from "../lib/scenario/constants.ts";

/** **bold** / ***bold*** + "->" arrow + newlines, like md() in the generator. */
export function Md({ text, className }: { text: unknown; className?: string }) {
  const s = String(text ?? "");
  const lines = s.split("\n");
  return (
    <span className={className}>
      {lines.map((ln, li) => (
        <span key={li}>
          {li > 0 && <br />}
          {ln.split(/(\*\*\*.+?\*\*\*|\*\*.+?\*\*)/g).map((part, i) => {
            const m = /^\*\*\*?(.+?)\*?\*\*$/.exec(part);
            const t = (m ? m[1] : part).replace(/->/g, "→");
            return m ? <b key={i}>{t}</b> : <span key={i}>{t}</span>;
          })}
        </span>
      ))}
    </span>
  );
}

export function Section({
  title,
  right,
  children,
  className = "",
  collapsible = false,
  defaultOpen = true,
  id,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${className}`} id={id}>
      {collapsible ? (
        <button type="button" className="section-bar w-full min-h-8 items-center" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>
            <span aria-hidden className="inline-block w-3">{open ? "▾" : "▸"}</span> {title}
          </span>
          {right && <span className="italic normal-case font-normal">{right}</span>}
        </button>
      ) : (
        <div className="section-bar">
          <span>{title}</span>
          {right && <span className="italic normal-case font-normal">{right}</span>}
        </div>
      )}
      {(!collapsible || open) && children}
    </section>
  );
}

export function Footer({ className = "" }: { className?: string }) {
  return <footer className={`sheet-footer ${className}`}>{FOOTER}</footer>;
}

/** label | value rows with a thin grey rule (kv() in the generator). */
export function KV({ rows, labelWidth = "7.5rem" }: { rows: [string, ReactNode][]; labelWidth?: string }) {
  return (
    <table className="kv">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}>
            <th style={{ width: labelWidth }}>
              <Md text={k} />
            </th>
            <td>{typeof v === "string" ? <Md text={v} /> : v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Square checkbox drawn like the sheet's Box (visual only; the row is the button). */
export function Box({ checked }: { checked: boolean }) {
  return <span aria-hidden className={`sq ${checked ? "sq-on" : ""}`} />;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop no-print" role="dialog" aria-modal aria-label={title}>
      <div className="section modal">
        <div className="section-bar items-center">
          <span>{title}</span>
          {onClose && (
            <button type="button" className="text-paper px-2 min-h-8" onClick={onClose} aria-label="Close">
              X
            </button>
          )}
        </div>
        <div className="p-2">{children}</div>
      </div>
    </div>
  );
}

/** Tap = onTap; press-and-hold (550 ms) = onLong. Keyboard: Enter = tap, Shift+Enter / Delete = long. */
export function useLongPress(onTap: () => void, onLong: () => void, ms = 550) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLong();
      }, ms);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (!fired.current) onTap();
      fired.current = false;
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Delete" || (e.key === "Enter" && e.shiftKey)) {
        e.preventDefault();
        onLong();
      }
    },
  };
}

export function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
