// Print moulage tags on a Zebra (ZPL) label printer. Instructor-only: opened from the Pre-brief.
// Prints region + finding only; the instructor cue is never put on a label.
import { useEffect, useMemo, useState } from "react";
import type { MoulageTag } from "../lib/scenario/types.ts";
import {
  buildLabels,
  clampOptions,
  DPIS,
  LIMITS,
  labelFileName,
  loadLabelSettings,
  PRESETS,
  saveLabelSettings,
  type Dpi,
  type LabelLayout,
  type LabelOptions,
} from "../lib/labels/zpl.ts";
import { findPrinters, sendZpl, type BPStatus } from "../lib/labels/browserPrint.ts";
import { Box, download, Modal } from "./primitives.tsx";

const PX_PER_IN = 72;

function LabelPreview({ l, dpi, testId }: { l: LabelLayout; dpi: number; testId?: string }) {
  const s = PX_PER_IN / dpi;
  return (
    <svg
      width={l.w * s}
      height={l.h * s}
      viewBox={`0 0 ${l.w} ${l.h}`}
      className="bg-paper"
      style={{ outline: "1px dashed var(--color-rule)" }}
      role="img"
      aria-label={l.texts.map((t) => t.text).join(" ")}
      data-testid={testId}
    >
      {l.border && <rect x={1} y={1} width={l.w - 2} height={l.h - 2} fill="none" stroke="black" strokeWidth={Math.max(2, l.w / 200)} />}
      {l.rules.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.t} fill="black" />
      ))}
      {l.texts.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={t.y + t.size * 0.82}
          fontSize={t.size}
          fontFamily='"Arial Narrow", "Helvetica Neue Condensed", Helvetica, Arial, sans-serif'
          fontWeight={700}
          textAnchor={t.anchorEnd ? "end" : "start"}
        >
          {t.text}
        </text>
      ))}
    </svg>
  );
}

function presetId(o: LabelOptions): string {
  return PRESETS.find((p) => p.widthIn === o.widthIn && p.heightIn === o.heightIn)?.id ?? "custom";
}

export function LabelPrintModal({ tags, scenarioId, onClose }: { tags: MoulageTag[]; scenarioId?: string; onClose: () => void }) {
  const [opts, setOpts] = useState<LabelOptions>(() => loadLabelSettings());
  const [custom, setCustom] = useState(() => presetId(opts) === "custom");
  const [picked, setPicked] = useState<boolean[]>(() => tags.map(() => true));
  const [bp, setBp] = useState<BPStatus | null>(null);
  const [printerUid, setPrinterUid] = useState<string>("");
  const [status, setStatus] = useState<{ kind: "info" | "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (p: Partial<LabelOptions>) => setOpts((o) => clampOptions({ ...o, ...p }));
  useEffect(() => saveLabelSettings(opts), [opts]);

  const chosen = useMemo(() => tags.filter((_, i) => picked[i]), [tags, picked]);
  const job = useMemo(() => buildLabels(chosen, opts), [chosen, opts]);
  const count = chosen.length * opts.copies;
  const sizeId = custom ? "custom" : presetId(opts);

  const connect = async () => {
    setBusy(true);
    setStatus({ kind: "info", text: "Looking for Zebra Browser Print on this computer..." });
    try {
      const st = await findPrinters();
      setBp(st);
      const uid = st.defaultUid ?? st.printers[0]?.uid ?? "";
      setPrinterUid(uid);
      setStatus(st.printers.length ? { kind: "ok", text: `Browser Print found: ${st.printers.length} printer(s).` } : { kind: "error", text: "Browser Print is running but has no printers. Add one in Browser Print settings." });
    } catch (e) {
      setBp(null);
      setStatus({ kind: "error", text: `${e instanceof Error ? e.message : String(e)}. Use Download .zpl or Copy ZPL instead.` });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const dev = bp?.printers.find((p) => p.uid === printerUid);
    if (!bp || !dev) return;
    setBusy(true);
    setStatus({ kind: "info", text: `Sending ${count} label(s) to ${dev.name}...` });
    try {
      await sendZpl(bp.base, dev, job.zpl);
      setStatus({ kind: "ok", text: `Sent ${count} label(s) to ${dev.name}.` });
    } catch (e) {
      setStatus({ kind: "error", text: `Send failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(job.zpl);
      setStatus({ kind: "ok", text: "ZPL copied to the clipboard." });
    } catch {
      setStatus({ kind: "error", text: "Clipboard not available here; use Download .zpl." });
    }
  };

  const numField = (label: string, key: "widthIn" | "heightIn", max: number) => (
    <label className="flex items-center gap-1 text-sm">
      {label}
      <input
        className="field w-20 text-center"
        type="number"
        inputMode="decimal"
        step={0.25}
        min={LIMITS.minIn}
        max={max}
        value={opts[key]}
        onChange={(e) => {
          const x = Number.parseFloat(e.target.value);
          if (Number.isFinite(x)) set({ [key]: x } as Partial<LabelOptions>);
        }}
        aria-label={`Label ${label.toLowerCase()} (inches)`}
        data-testid={`zpl-${key}`}
      />
      in
    </label>
  );

  return (
    <Modal title="Print moulage tags (ZPL label printer)" onClose={onClose} wide>
      <div className="flex flex-col gap-2 text-sm" data-testid="zpl-modal">
        <div className="flex flex-wrap items-center gap-1">
          <b className="w-20">Label size</b>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${sizeId === p.id ? "chip-on" : ""}`}
              aria-pressed={sizeId === p.id}
              onClick={() => {
                setCustom(false);
                set({ widthIn: p.widthIn, heightIn: p.heightIn });
              }}
              data-testid={`zpl-size-${p.id}`}
            >
              {p.name}
            </button>
          ))}
          <button type="button" className={`chip ${sizeId === "custom" ? "chip-on" : ""}`} aria-pressed={sizeId === "custom"} onClick={() => setCustom(true)} data-testid="zpl-size-custom">
            Custom
          </button>
          {sizeId === "custom" && (
            <span className="flex flex-wrap items-center gap-2 ml-1">
              {numField("Width", "widthIn", LIMITS.maxWidthIn)}
              {numField("Height", "heightIn", LIMITS.maxHeightIn)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <b className="w-20">Printer dpi</b>
          {DPIS.map((d) => (
            <button key={d} type="button" className={`chip ${opts.dpi === d ? "chip-on" : ""}`} aria-pressed={opts.dpi === d} onClick={() => set({ dpi: d as Dpi })} data-testid={`zpl-dpi-${d}`}>
              {d}
            </button>
          ))}
          <span className="cue ml-1">203 = most desktop Zebras (ZD220/ZD421); 300 = "-300" models</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <b className="w-20">Options</b>
          {(
            [
              ["region", "Region header"],
              ["simulated", '"SIMULATED" marker'],
              ["border", "Border"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={`chip ${opts[k] ? "chip-on" : ""}`} aria-pressed={opts[k]} onClick={() => set({ [k]: !opts[k] } as Partial<LabelOptions>)}>
              {label}
            </button>
          ))}
          <label className="flex items-center gap-1 ml-2">
            Copies of each
            <input
              className="field w-16 text-center"
              type="number"
              min={1}
              max={LIMITS.maxCopies}
              value={opts.copies}
              onChange={(e) => set({ copies: Number.parseInt(e.target.value, 10) || 1 })}
              aria-label="Copies of each label"
            />
          </label>
        </div>

        <div className="border border-ink">
          <div className="flex items-center justify-between bg-head px-1.5 min-h-8 font-bold text-xs">
            <span>
              TAGS ({chosen.length}/{tags.length}) - preview, approximate
            </span>
            <span className="flex gap-1">
              <button type="button" className="underline" onClick={() => setPicked(tags.map(() => true))}>
                all
              </button>
              <button type="button" className="underline" onClick={() => setPicked(tags.map(() => false))}>
                none
              </button>
            </span>
          </div>
          <div className="flex flex-wrap gap-2 p-2 max-h-[45vh] overflow-auto bg-zebra">
            {tags.map((t, i) => {
              const k = chosen.indexOf(t);
              const l = k >= 0 ? job.layouts[k] : buildLabels([t], opts).layouts[0];
              return (
                <button
                  key={i}
                  type="button"
                  className={`flex flex-col items-start gap-1 p-1 border ${picked[i] ? "border-ink bg-paper" : "border-rule opacity-50"}`}
                  aria-pressed={!!picked[i]}
                  aria-label={`Print tag: ${t.region}`}
                  onClick={() => setPicked((p) => p.map((v, j) => (j === i ? !v : v)))}
                  data-testid={`zpl-tag-${i}`}
                >
                  <span className="flex items-center gap-1 text-xs">
                    <Box checked={!!picked[i]} /> {t.region}
                    {l.overflow && <span className="text-alert font-bold">text cut - use a larger label</span>}
                  </span>
                  <LabelPreview l={l} dpi={opts.dpi} testId={`zpl-preview-${i}`} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="sheet-btn font-bold"
            disabled={!chosen.length}
            onClick={() => {
              download(labelFileName(scenarioId, opts), job.zpl, "application/octet-stream");
              setStatus({ kind: "ok", text: `Downloaded ${count} label(s).` });
            }}
            data-testid="zpl-download"
          >
            Download .zpl
          </button>
          <button type="button" className="sheet-btn" disabled={!chosen.length} onClick={copy} data-testid="zpl-copy">
            Copy ZPL
          </button>
          <span className="flex-1" />
          {!bp ? (
            <button type="button" className="sheet-btn" disabled={busy} onClick={connect} data-testid="zpl-connect">
              Find printer (Zebra Browser Print)
            </button>
          ) : (
            <>
              <select className="field w-56" value={printerUid} onChange={(e) => setPrinterUid(e.target.value)} aria-label="Printer" data-testid="zpl-printer">
                {bp.printers.map((p) => (
                  <option key={p.uid} value={p.uid}>
                    {p.name}
                    {p.connection ? ` (${p.connection})` : ""}
                  </option>
                ))}
              </select>
              <button type="button" className="sheet-btn font-bold" disabled={busy || !printerUid || !chosen.length} onClick={send} data-testid="zpl-send">
                Print {count} label{count === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
        {status && (
          <div className={`text-sm ${status.kind === "error" ? "text-alert" : ""}`} role="status" data-testid="zpl-status">
            {status.text}
          </div>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer font-bold">How to print</summary>
          <ul className="list-disc pl-5 py-1">
            <li>
              <b>Direct:</b> install Zebra Browser Print (free, Windows/macOS) on this computer with the printer connected (USB, network or
              Bluetooth), then Find printer.
            </li>
            <li>
              <b>Network printer, no agent:</b> Download .zpl, open the printer's web page (its IP address), and use "Directly Write" / upload
              file; or from a terminal: <code>nc PRINTER_IP 9100 &lt; file.zpl</code> (macOS/Linux), or <code>lp -d PRINTER -o raw file.zpl</code> for a
              raw CUPS queue.
            </li>
            <li>
              <b>Tablet:</b> Download or Copy, then send with the Zebra Printer Setup app or a computer.
            </li>
            <li>Set the dpi and label size to match the printer and loaded media; labels print one per tag with no instructor cues.</li>
          </ul>
        </details>
      </div>
    </Modal>
  );
}
