import { useState } from "react";
import { describeEvent } from "../lib/run/describe.ts";
import { fmtT, historyKey, lastUndoable } from "../lib/run/reducer.ts";
import type { HistorySection } from "../lib/run/types.ts";
import { cardFace } from "../lib/display/toDisplay.ts";
import type { Pair } from "../lib/scenario/types.ts";
import { useRun } from "../state/RunContext.tsx";
import { CardFace } from "../ui/CardFace.tsx";
import { Box, Md, Section, useLongPress } from "../ui/primitives.tsx";
import { VitalsTable } from "./run/VitalsTable.tsx";
import { ActionPicker, ProviderActionsPanel, type PickerRequest } from "./run/ProviderActions.tsx";
import { actionById } from "../lib/actions/catalog.ts";

/** Run tab = PDF p.1 vitals + p.2 flow / critical, plus show cards, moulage tags, history and notes. */
export default function RunTab() {
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <ControlStrip />
      <Section title="Vitals progression" right="tap a value when the crew obtains it; tap a stage to switch">
        <VitalsTable />
      </Section>
      <div className="grid-run">
        <div className="flex flex-col gap-2 min-w-0">
          <FlowTimeline onPick={setPicker} />
          <CriticalPanel />
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <ProviderActionsPanel onOpen={setPicker} />
          <ShowCardsPanel />
          <TagsPanel />
          <NotesPanel />
          <HistoryPanel />
        </div>
      </div>
      {picker && <ActionPicker key={`${picker.actionId}:${picker.itemId ?? ""}`} req={picker} onClose={() => setPicker(null)} />}
    </div>
  );
}

function ControlStrip() {
  const { sc, state, run, dispatch, undo, autoSwitch, setAutoSwitch } = useRun();
  if (!sc || !state || !run) return null;
  const phase = sc.phases.find((p) => p.id === state.phaseId);
  const pi = phase ? phase.index : -1;
  const stage = sc.stages.find((s) => s.key === state.stageKey);
  const last = lastUndoable(run.record.events);
  const go = (i: number) => sc.phases[i] && dispatch({ kind: "phase", phaseId: sc.phases[i].id });
  return (
    <div className="control-strip no-print">
      <div className="cs-cell">
        <span className="cs-label">Phase</span>
        <div className="flex items-stretch gap-1">
          <button type="button" className="sheet-btn px-3" disabled={pi <= 0} onClick={() => go(pi - 1)} aria-label="Previous phase">
            &lsaquo;
          </button>
          <span className="cs-value active-mark">
            {phase?.time} | {phase?.phase}
          </span>
          <button type="button" className="sheet-btn px-3 font-bold" disabled={pi >= sc.phases.length - 1} onClick={() => go(pi + 1)} data-testid="next-phase">
            Next &rsaquo;
          </button>
        </div>
      </div>
      <div className="cs-cell">
        <span className="cs-label">Vitals stage</span>
        <span className="cs-value active-mark" data-testid="current-stage">
          {stage?.stage ?? "-"}
        </span>
      </div>
      <div className="cs-cell">
        <span className="cs-label">Student screen</span>
        <div className="flex items-stretch">
          {(["monitor", "info"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`sheet-btn seg ${state.view === v ? "seg-on" : ""}`}
              aria-pressed={state.view === v}
              onClick={() => dispatch({ kind: "display", view: v })}
              data-testid={`view-${v}`}
            >
              {v === "monitor" ? "Monitor" : "Info / cards"}
            </button>
          ))}
          <button
            type="button"
            className={`sheet-btn seg ml-1 ${state.ecgOn ? "seg-on" : ""}`}
            aria-pressed={state.ecgOn}
            onClick={() => dispatch({ kind: "display", ecg: !state.ecgOn })}
            title="ECG trace on the student monitor (auto-on when HR is given)"
          >
            ECG
          </button>
          <button
            type="button"
            className={`sheet-btn seg ${state.capnoOn ? "seg-on" : ""}`}
            aria-pressed={state.capnoOn}
            onClick={() => dispatch({ kind: "display", capno: !state.capnoOn })}
            title="Capnography trace (auto-on when EtCO2 is given)"
          >
            CO2
          </button>
          <button
            type="button"
            className={`sheet-btn seg ${state.plethOn ? "seg-on" : ""}`}
            aria-pressed={state.plethOn}
            onClick={() => dispatch({ kind: "display", pleth: !state.plethOn })}
            title="SpO2 pleth trace (auto-on when SpO2 is given; never shown without a pulse)"
          >
            SpO2
          </button>
          <button
            type="button"
            className={`sheet-btn seg ml-1 ${state.layout === "12lead" ? "seg-on" : ""}`}
            aria-pressed={state.layout === "12lead"}
            onClick={() => dispatch({ kind: "display", layout: state.layout === "12lead" ? "single" : "12lead" })}
            title="Student monitor: live 12-lead instead of lead II + SpO2 + CO2"
            data-testid="layout-12lead-btn"
          >
            12-lead
          </button>
        </div>
        <label className="flex items-center gap-1 text-xs min-h-6">
          <input type="checkbox" className="box" checked={autoSwitch} onChange={(e) => setAutoSwitch(e.target.checked)} />
          switch to Info when a card is pushed
        </label>
      </div>
      <div className="cs-cell ml-auto">
        <span className="cs-label">Undo</span>
        <button type="button" className="sheet-btn text-xs max-w-[16rem] truncate" disabled={!last} onClick={undo} title={last ? describeEvent(sc, last) : ""} data-testid="undo">
          {last ? `Undo: ${describeEvent(sc, last)}` : "Nothing to undo"}
        </button>
      </div>
    </div>
  );
}

function FlowTimeline({ onPick }: { onPick: (r: PickerRequest) => void }) {
  const { sc, state, dispatch, tapBranch } = useRun();
  const [expandAll, setExpandAll] = useState(false);
  if (!sc || !state) return null;
  return (
    <Section
      title="Scenario flow"
      right={
        <button type="button" className="underline min-h-6" onClick={() => setExpandAll(!expandAll)}>
          {expandAll ? "collapse others" : "expand all"} - advance on crew action OR clock
        </button>
      }
    >
      <div>
        {sc.phases.map((p) => {
          const current = p.id === state.phaseId;
          const open = current || expandAll;
          const done = p.expectedItems.filter((i) => state.expected[i.id]).length;
          const branches = [...p.branchList].sort((a, b) => Number(a.type === "inject") - Number(b.type === "inject"));
          return (
            <div key={p.id} className={`phase ${current ? "phase-on" : ""}`} data-testid={`phase-${p.id}`}>
              <button
                type="button"
                className="phase-head"
                onClick={() => !current && dispatch({ kind: "phase", phaseId: p.id })}
                aria-current={current ? "step" : undefined}
                title={current ? "Current phase" : "Make this the current phase"}
              >
                <span className="w-14 shrink-0 font-bold">{p.time}</span>
                <span className="flex-1 font-bold text-left">
                  <Md text={p.phase} />
                </span>
                <span className="text-xs">
                  {done}/{p.expectedItems.length}
                </span>
                {current && <span className="text-xs font-bold text-active uppercase ml-2">current</span>}
              </button>
              {open && (
                <div className="phase-body">
                  <div className="phase-give">
                    <span className="cs-label">Instructor: say / give</span>
                    <Md text={p.give} />
                  </div>
                  {branches.map((b) => {
                    const taken = state.branches.filter((x) => x.branchId === b.id);
                    const inject = b.type === "inject";
                    return (
                      <button
                        key={b.id}
                        type="button"
                        className={`branch ${inject ? "branch-inject" : ""} ${taken.length ? "branch-taken" : ""}`}
                        onClick={() => tapBranch(p.id, b.id)}
                        data-testid={`branch-${b.id}`}
                      >
                        <span>
                          <b>{inject ? "EXAMINER OPTION:" : "IF"}</b> <Md text={b.if} /> <b>&rarr;</b> <Md text={b.then} />
                        </span>
                        <span className="branch-meta">
                          {b.goto_stage && <span className="border border-ink px-1">stage {b.goto_stage}</span>}
                          {taken.map((x) => (
                            <span key={x.seq} className="font-bold">
                              {fmtT(x.t)}
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                  <div className="checklist">
                    <div className="checklist-head">
                      <span>Expected crew actions</span>
                      <span>Time</span>
                    </div>
                    {p.expectedItems.map((it) => (
                      <CheckRow
                        key={it.id}
                        text={it.text}
                        stamp={state.expected[it.id]?.t}
                        action={it.action ? actionById(it.action)?.short ?? actionById(it.action)?.label : undefined}
                        byAction={state.expected[it.id]?.byAction !== undefined}
                        onCheck={() =>
                          it.action
                            ? onPick({ actionId: it.action, prefill: it.match, itemId: it.id, itemText: it.text })
                            : dispatch({ kind: "expected", itemId: it.id, checked: true })
                        }
                        onUncheck={() => dispatch({ kind: "expected", itemId: it.id, checked: false })}
                        testId={`exp-${it.id}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** tap = check + timestamp; press-and-hold = un-check (prevents accidental un-checks on a tablet). */
function CheckRow({
  text,
  stamp,
  onCheck,
  onUncheck,
  testId,
  action,
  byAction,
}: {
  text: string;
  stamp?: number;
  onCheck: () => void;
  onUncheck: () => void;
  testId: string;
  /** linked provider action (short label): tapping opens the action picker */
  action?: string;
  /** ticked by a logged provider action */
  byAction?: boolean;
}) {
  const checked = stamp !== undefined;
  const lp = useLongPress(() => !checked && onCheck(), () => checked && onUncheck());
  return (
    <button type="button" className="check-row" aria-pressed={checked} data-testid={testId} title={checked ? "Hold to un-check" : "Tap to check"} {...lp}>
      <Box checked={checked} />
      <span className="flex-1 text-left">
        <Md text={text} />
        {action && (
          <span className="link-tag" title="Linked provider action: tap opens it">
            {byAction ? "logged: " : ""}
            {action}
          </span>
        )}
      </span>
      <span className="check-time">{checked ? fmtT(stamp) : ""}</span>
    </button>
  );
}

function CriticalPanel() {
  const { sc, state, dispatch } = useRun();
  if (!sc || !state) return null;
  const missed = sc.critical.filter((c) => state.critical[c.id]?.status === "missed").length;
  return (
    <Section title="Critical actions (instructor discretion)" right="MISSED = flag for evaluator discretion, never an automatic fail">
      {missed > 0 && (
        <div className="flag-banner" role="status">
          Flagged for evaluator discretion: {missed} critical item{missed > 1 ? "s" : ""} marked MISSED
        </div>
      )}
      <table className="sheet-table zebra">
        <tbody>
          {sc.critical.map((c) => {
            const st = state.critical[c.id];
            const set = (status: "met" | "missed") => dispatch({ kind: "critical", itemId: c.id, status: st?.status === status ? null : status });
            return (
              <tr key={c.id} data-testid={`crit-${c.id}`}>
                <td>
                  <Md text={c.text} />
                  {st && <span className="text-xs ml-1">({fmtT(st.t)})</span>}
                </td>
                <td className="p-0 w-[11rem]">
                  <div className="flex h-full">
                    <button type="button" className={`sheet-btn seg flex-1 ${st?.status === "met" ? "seg-on" : ""}`} aria-pressed={st?.status === "met"} onClick={() => set("met")}>
                      MET
                    </button>
                    <button
                      type="button"
                      className={`sheet-btn seg flex-1 ${st?.status === "missed" ? "seg-missed" : ""}`}
                      aria-pressed={st?.status === "missed"}
                      onClick={() => set("missed")}
                    >
                      MISSED
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

function ShowCardsPanel() {
  const { sc, state, dispatch, autoSwitch } = useRun();
  const [preview, setPreview] = useState<number | null>(null);
  if (!sc || !state) return null;
  const cards = sc.source.show_cards ?? [];
  if (!cards.length) return null;
  return (
    <Section title="Show cards" right="cue = instructor only; Show = push face to student screen">
      {cards.map((c, i) => {
        const shown = state.cards.find((x) => x.cardIndex === i);
        const override = state.ecgOverride === i || state.capnoOverride === i;
        return (
          <div key={i} className="item-row" data-testid={`card-${i}`}>
            <div className="flex-1 min-w-0">
              <div className="font-bold">
                {shown && <span className="pushed-dot" aria-label="on student display" />}
                {c.title || c.type} <span className="text-xs font-normal">[{c.type}]</span>
                {override && <span className="text-xs font-normal ml-1">(driving monitor)</span>}
              </div>
              {c.cue && <div className="cue">INSTRUCTOR: {c.cue}</div>}
              {preview === i && (
                <div className="mt-1 border border-ink p-1">
                  <CardFace card={cardFace(c, i)} />
                </div>
              )}
            </div>
            <div className="flex gap-1 items-stretch shrink-0">
              {shown ? (
                <button type="button" className="sheet-btn text-sm w-24" onClick={() => dispatch({ kind: "card", cardIndex: i, action: "hide" })}>
                  Retract <span className="block text-xs">shown {fmtT(shown.t)}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="sheet-btn font-bold w-24 text-center"
                  data-testid={`show-card-${i}`}
                  onClick={() =>
                    dispatch({ kind: "card", cardIndex: i, action: "show" }, ...(autoSwitch ? [{ kind: "display" as const, view: "info" as const }] : []))
                  }
                >
                  Show
                </button>
              )}
              <button type="button" className="sheet-btn text-xs w-16 text-center" onClick={() => setPreview(preview === i ? null : i)} aria-expanded={preview === i}>
                {preview === i ? "Hide" : "Preview"}
              </button>
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function TagsPanel() {
  const { sc, state, dispatch, autoSwitch } = useRun();
  if (!sc || !state) return null;
  const tags = sc.source.moulage_tags ?? [];
  if (!tags.length) return null;
  return (
    <Section title="Moulage tags" right="Show pushes region + finding (never the cue)" collapsible>
      {tags.map((t, i) => {
        const shown = state.tags.find((x) => x.tagIndex === i);
        return (
          <div key={i} className="item-row">
            <div className="flex-1 min-w-0">
              <div>
                {shown && <span className="pushed-dot" aria-label="on student display" />}
                <b className="uppercase text-xs">{t.region}</b> <Md text={t.text} />
              </div>
              {t.cue && <div className="cue">INSTRUCTOR: {t.cue}</div>}
            </div>
            {shown ? (
              <button type="button" className="sheet-btn text-sm w-24 shrink-0" onClick={() => dispatch({ kind: "tag", tagIndex: i, action: "hide" })}>
                Retract
              </button>
            ) : (
              <button
                type="button"
                className="sheet-btn font-bold w-24 shrink-0"
                onClick={() => dispatch({ kind: "tag", tagIndex: i, action: "show" }, ...(autoSwitch ? [{ kind: "display" as const, view: "info" as const }] : []))}
              >
                Show
              </button>
            )}
          </div>
        );
      })}
    </Section>
  );
}

const QUICK_NOTES = ["Good crew direction", "Prompted by instructor", "Delayed action", "Scope / protocol issue", "Communication gap", "Debrief this"];

function NotesPanel() {
  const { state, dispatch } = useRun();
  const [text, setText] = useState("");
  if (!state) return null;
  const add = () => {
    if (text.trim()) dispatch({ kind: "note", text: text.trim() });
    setText("");
  };
  return (
    <Section title="Notes" right="timestamped on the scenario clock">
      <div className="p-1 flex flex-col gap-1">
        <div className="flex gap-1">
          <textarea className="note-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Free-text note" aria-label="Note" />
          <button type="button" className="sheet-btn font-bold w-20" onClick={add}>
            Add
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {QUICK_NOTES.map((q) => (
            <button key={q} type="button" className="sheet-btn text-sm" onClick={() => dispatch({ kind: "note", text: q, quick: true })}>
              {q}
            </button>
          ))}
        </div>
        {state.notes.length > 0 && (
          <table className="sheet-table zebra">
            <tbody>
              {[...state.notes].reverse().map((n) => (
                <tr key={n.seq}>
                  <td className="w-20 text-xs">{fmtT(n.t)}</td>
                  <td>{n.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
}

function HistoryPanel() {
  const { sc } = useRun();
  if (!sc) return null;
  const s = sc.source;
  return (
    <>
      <Section title="SAMPLE (give when asked)" right="check = crew asked" collapsible>
        <HistRows section="SAMPLE" rows={s.history?.SAMPLE ?? []} />
      </Section>
      <Section title="OPQRST" right="check = crew asked" collapsible>
        <HistRows section="OPQRST" rows={s.history?.OPQRST ?? []} />
      </Section>
      <Section title="Primary assessment" right="check = crew assessed" collapsible>
        <HistRows section="primary" rows={s.primary ?? []} />
      </Section>
      {(s.secondary?.length ?? 0) > 0 && (
        <Section title="Secondary / focused exam" right="check = crew assessed" collapsible defaultOpen={false}>
          <HistRows section="secondary" rows={s.secondary ?? []} />
        </Section>
      )}
    </>
  );
}

function HistRows({ section, rows }: { section: HistorySection; rows: Pair[] }) {
  const { state, dispatch } = useRun();
  if (!state) return null;
  return (
    <div>
      {rows.map(([k, v], i) => {
        const st = state.history[historyKey(section, i)];
        return (
          <button
            key={i}
            type="button"
            className="check-row hist-row"
            aria-pressed={!!st}
            onClick={() => dispatch({ kind: "history", section, index: i, done: !st })}
          >
            <Box checked={!!st} />
            <b className="w-24 shrink-0 text-left">
              <Md text={k} />
            </b>
            <span className="flex-1 text-left">
              <Md text={v} />
            </span>
            <span className="check-time">{st ? fmtT(st.t) : ""}</span>
          </button>
        );
      })}
    </div>
  );
}
