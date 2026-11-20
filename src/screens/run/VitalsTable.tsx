import { useState } from "react";
import { fmtT } from "../../lib/run/reducer.ts";
import { VITAL_KEYS, type VitalKey } from "../../lib/scenario/types.ts";
import { useRun } from "../../state/RunContext.tsx";
import { Md } from "../../ui/primitives.tsx";

const hasValue = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "-";

/**
 * Vitals progression table (PDF p.1). Interactive: tap a stage cell = switch the current stage (logged);
 * tap a value cell = the crew obtained it -> reveal (logged + shown on the student display).
 * Unrevealed = dashed grey cell; revealed = solid black value + time. The `other` column is instructor-only.
 */
export function VitalsTable({ interactive = true }: { interactive?: boolean }) {
  const { sc, state, dispatch } = useRun();
  if (!sc || !state) return null;
  const blank = sc.source.blank_vitals_rows ?? 2;
  return (
    <div className="overflow-x-auto">
      <table className="sheet-table vitals-table">
        <thead>
          <tr>
            <th className="w-[5.5rem]">Stage</th>
            <th className="w-[9rem]">Trigger / when</th>
            {VITAL_KEYS.map((k) => (
              <th key={k}>{k}</th>
            ))}
            <th className="min-w-[10rem]">Skin / lungs / ECG / other</th>
          </tr>
        </thead>
        <tbody>
          {sc.stages.map((row, ri) => {
            const current = row.key === state.stageKey;
            const rev = state.revealed[row.key] ?? {};
            return (
              <tr key={row.key} className={`${ri % 2 ? "bg-zebra" : ""} ${current ? "row-active" : ""}`} data-testid={`stage-${row.key}`}>
                <td className="p-0">
                  {interactive ? (
                    <button
                      type="button"
                      className={`stage-cell ${current ? "stage-cell-on" : ""}`}
                      aria-pressed={current}
                      onClick={() => !current && dispatch({ kind: "stage", stageKey: row.key })}
                      title={current ? "Current stage" : "Switch to this stage"}
                    >
                      <b>{row.stage}</b>
                      {current && <span className="block text-[10px] font-bold text-active uppercase">current</span>}
                    </button>
                  ) : (
                    <b className="px-1 block">{row.stage}</b>
                  )}
                </td>
                <td className="text-xs">
                  <Md text={row.trigger} />
                </td>
                {VITAL_KEYS.map((k) => {
                  const v = row[k];
                  const bold = row.bold?.includes(k);
                  if (!hasValue(v) || !interactive)
                    return (
                      <td key={k} className={`text-center ${bold ? "font-bold" : ""}`}>
                        {hasValue(v) ? <Md text={v} /> : <span className="text-rule">-</span>}
                      </td>
                    );
                  const r = rev[k];
                  const onDisplay = !!r && state.latest[k]?.seq === r.seq;
                  return (
                    <td key={k} className="p-0">
                      <button
                        type="button"
                        className={`vital-cell ${r ? "vital-on" : "vital-off"} ${bold ? "font-bold" : ""}`}
                        data-testid={`vital-${row.key}-${k}`}
                        aria-pressed={!!r}
                        aria-label={`${k} ${String(v).replace(/\*/g, "")} stage ${row.key}${r ? " (given)" : ""}`}
                        onClick={() => dispatch({ kind: "reveal", stageKey: row.key, vital: k, value: String(v) })}
                        title={r ? "Given - tap to give again" : "Tap when the crew obtains it"}
                      >
                        <Md text={v} />
                        {r && (
                          <span className="vital-time">
                            {onDisplay && <span className="pushed-dot" aria-label="on student display" />}
                            {fmtT(r.t).slice(2)}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
                <td className={`text-xs ${row.bold?.includes("other") ? "font-bold" : ""}`}>
                  <Md text={row.other} />
                </td>
              </tr>
            );
          })}
          {interactive ? <AdLibRow /> : Array.from({ length: blank }, (_, i) => <BlankRow key={i} />)}
        </tbody>
      </table>
    </div>
  );
}

function BlankRow() {
  return (
    <tr>
      <td className="text-xs">ad lib</td>
      {Array.from({ length: VITAL_KEYS.length + 2 }, (_, i) => (
        <td key={i}>&nbsp;</td>
      ))}
    </tr>
  );
}

function AdLibRow() {
  const { state, dispatch } = useRun();
  const [vals, setVals] = useState<Partial<Record<VitalKey, string>>>({});
  if (!state) return null;
  const give = () => {
    const bodies = VITAL_KEYS.filter((k) => vals[k]?.trim()).map((k) => ({
      kind: "reveal" as const,
      stageKey: state.stageKey ?? "?",
      vital: k,
      value: vals[k]!.trim(),
      adlib: true,
    }));
    if (bodies.length) dispatch(...bodies);
    setVals({});
  };
  return (
    <tr className="adlib-row">
      <td className="text-xs font-bold">ad lib</td>
      <td className="text-xs">custom values, logged against stage {state.stageKey}</td>
      {VITAL_KEYS.map((k) => (
        <td key={k} className="p-0">
          <input
            className="adlib-input"
            aria-label={`ad lib ${k}`}
            value={vals[k] ?? ""}
            onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && give()}
          />
        </td>
      ))}
      <td className="p-0">
        <button type="button" className="sheet-btn w-full border-0 font-bold" onClick={give}>
          Give ad lib
        </button>
      </td>
    </tr>
  );
}
