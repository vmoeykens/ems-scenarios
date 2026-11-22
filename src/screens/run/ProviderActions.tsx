// PROVIDER ACTIONS (Run tab): log what the crew did, with an optional subset of details, timestamped and repeatable.
// Scenario-relevant actions are pinned first; the whole shared catalog is searchable below.
// Logging an action ticks the matching linked expected item (reducer: linkedItemFor); tapping a linked expected item
// opens the picker pre-filled. Instructor-only: nothing here reaches the student display.
import { useMemo, useState } from "react";
import { actionById, CATALOG, formatValues, relevantActions, type ActionDef, type ActionField, type ActionValues } from "../../lib/actions/catalog.ts";
import { fmtT } from "../../lib/run/reducer.ts";
import { useRun } from "../../state/RunContext.tsx";
import { Modal, Section } from "../../ui/primitives.tsx";

export interface PickerRequest {
  actionId: string;
  /** pre-filled values (an expected item's match) */
  prefill?: ActionValues;
  /** expected item the picker was opened from: Save ticks it, Skip just checks it */
  itemId?: string;
  itemText?: string;
}

export function ActionPicker({ req, onClose }: { req: PickerRequest; onClose: () => void }) {
  const { dispatch, state } = useRun();
  const a = actionById(req.actionId);
  const [vals, setVals] = useState<ActionValues>(() => ({ ...(req.prefill ?? {}) }));
  if (!a || !state) return null;
  const last = [...state.actions].reverse().find((x) => x.actionId === a.id);
  const set = (id: string, v: ActionValues[string] | undefined) =>
    setVals((o) => {
      const n = { ...o };
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete n[id];
      else n[id] = v;
      return n;
    });
  const log = () => {
    dispatch({ kind: "action", actionId: a.id, values: vals, ...(req.itemId ? { itemId: req.itemId } : {}) });
    onClose();
  };
  return (
    <Modal title={a.label} onClose={onClose}>
      <div className="flex flex-col gap-2" data-testid="action-picker">
        {req.itemText && (
          <p className="text-sm border border-ink p-1">
            Expected: <b>{req.itemText}</b>
          </p>
        )}
        {a.note && <p className="cue">{a.note}</p>}
        <p className="text-xs text-cue">Every detail is optional - select only what the crew did.</p>
        {a.fields.map((f) => (
          <FieldInput key={f.id} f={f} value={vals[f.id]} onChange={(v) => set(f.id, v)} />
        ))}
        {last && Object.keys(last.values).length > 0 && (
          <button type="button" className="sheet-btn text-sm" onClick={() => setVals({ ...last.values })}>
            Same as last ({fmtT(last.t)}): {formatValues(a, last.values)}
          </button>
        )}
        <div className="flex gap-1 pt-1">
          <button type="button" className="sheet-btn font-bold flex-1 text-center" onClick={log} data-testid="action-log">
            Log {a.short ?? a.label}
            {formatValues(a, vals) ? ` - ${formatValues(a, vals)}` : ""}
          </button>
          {req.itemId && (
            <button
              type="button"
              className="sheet-btn text-center"
              onClick={() => {
                dispatch({ kind: "expected", itemId: req.itemId!, checked: true });
                onClose();
              }}
              data-testid="action-skip"
            >
              Skip (just check)
            </button>
          )}
          <button type="button" className="sheet-btn text-center" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FieldInput({ f, value, onChange }: { f: ActionField; value: ActionValues[string] | undefined; onChange: (v: ActionValues[string] | undefined) => void }) {
  const head = <div className="cs-label">{f.label}</div>;
  if (f.kind === "select" || f.kind === "multi") {
    const sel = Array.isArray(value) ? value : value !== undefined ? [String(value)] : [];
    return (
      <div>
        {head}
        <div className="flex flex-wrap gap-1" role="group" aria-label={f.label}>
          {f.options.map((o) => {
            const on = sel.includes(o);
            return (
              <button
                key={o}
                type="button"
                className={`chip ${on ? "chip-on" : ""}`}
                aria-pressed={on}
                onClick={() =>
                  f.kind === "select" ? onChange(on ? undefined : o) : onChange(on ? sel.filter((x) => x !== o) : [...sel, o])
                }
              >
                {o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (f.kind === "number") {
    const n = typeof value === "number" ? value : undefined;
    const step = f.step ?? 1;
    const clamp = (x: number) => Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, Math.round(x / step) * step));
    return (
      <div>
        {head}
        <div className="flex flex-wrap items-stretch gap-1">
          {(f.presets ?? []).map((p) => (
            <button key={p} type="button" className={`chip ${n === p ? "chip-on" : ""}`} aria-pressed={n === p} onClick={() => onChange(n === p ? undefined : p)}>
              {p}
            </button>
          ))}
          <button type="button" className="chip w-11" aria-label={`${f.label} minus`} onClick={() => onChange(clamp((n ?? f.presets?.[0] ?? 0) - step))}>
            -
          </button>
          <input
            className="field w-24 text-center"
            inputMode="decimal"
            aria-label={`${f.label} (${f.unit})`}
            value={n ?? ""}
            onChange={(e) => {
              const x = Number.parseFloat(e.target.value);
              onChange(Number.isFinite(x) ? x : undefined);
            }}
          />
          <button type="button" className="chip w-11" aria-label={`${f.label} plus`} onClick={() => onChange(clamp((n ?? f.presets?.[0] ?? 0) + step))}>
            +
          </button>
          <span className="self-center text-sm">{f.unit}</span>
        </div>
      </div>
    );
  }
  return (
    <label className="block">
      {head}
      <input className="field" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-label={f.label} />
    </label>
  );
}

function ActionRow({ a, onOpen }: { a: ActionDef; onOpen: (id: string) => void }) {
  const { state } = useRun();
  const logs = state?.actions.filter((x) => x.actionId === a.id) ?? [];
  const last = logs[logs.length - 1];
  return (
    <button type="button" className="action-row" onClick={() => onOpen(a.id)} data-testid={`action-${a.id}`}>
      <span className="flex-1 text-left">{a.label}</span>
      {last && (
        <span className="text-xs text-right" data-testid={`action-count-${a.id}`}>
          <b>x{logs.length}</b> last {fmtT(last.t)}
        </span>
      )}
    </button>
  );
}

export function ProviderActionsPanel({ onOpen }: { onOpen: (r: PickerRequest) => void }) {
  const { sc, state } = useRun();
  const [q, setQ] = useState("");
  const relevant = useMemo(() => (sc ? relevantActions(sc.source) : []), [sc]);
  if (!sc || !state) return null;
  const open = (actionId: string) => onOpen({ actionId });
  const needle = q.trim().toLowerCase();
  const hit = (a: ActionDef) => !needle || `${a.label} ${a.short ?? ""} ${a.group} ${a.fields.map((f) => ("options" in f ? f.options.join(" ") : "")).join(" ")}`.toLowerCase().includes(needle);
  const log = [...state.actions].reverse();
  return (
    <Section title="Provider actions" right="tap = log with details; repeatable; timestamped">
      <div className="p-1 flex flex-col gap-1">
        <div className="cs-label">This scenario</div>
        <div className="action-grid">
          {relevant.map((id) => actionById(id)).filter((a): a is ActionDef => !!a && hit(a)).map((a) => <ActionRow key={a.id} a={a} onOpen={open} />)}
        </div>
        {log.length > 0 && (
          <table className="sheet-table zebra mt-1" data-testid="action-log-table">
            <thead>
              <tr>
                <th className="w-20">Time</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {log.map((x) => {
                const def = actionById(x.actionId);
                return (
                  <tr key={x.seq}>
                    <td className="text-xs tabular-nums">{fmtT(x.t)}</td>
                    <td className="text-sm">{def?.label ?? x.actionId}</td>
                    <td className="text-sm">{formatValues(def, x.values)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <input className="field" placeholder="Search all actions (e.g. IO, splint, naloxone)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search actions" />
        {CATALOG.groups.map((g) => {
          const acts = CATALOG.actions.filter((a) => a.group === g.id && hit(a));
          if (!acts.length) return null;
          return (
            <details key={g.id} open={!!needle} className="action-group">
              <summary className="min-h-11 flex items-center px-1.5 font-bold text-sm bg-head cursor-pointer">
                {g.title} <span className="font-normal ml-1">({acts.length})</span>
              </summary>
              <div className="action-grid p-1">
                {acts.map((a) => (
                  <ActionRow key={a.id} a={a} onOpen={open} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </Section>
  );
}
