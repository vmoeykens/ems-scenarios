import { useRun } from "../state/RunContext.tsx";
import { Box, KV, Md, Section } from "../ui/primitives.tsx";
import { VitalsTable } from "./run/VitalsTable.tsx";
import { fmtT } from "../lib/run/reducer.ts";
import { href } from "../lib/router.ts";

/** Pre-brief = PDF p.1 top + handouts the instructor needs before starting (actor card, crew card, moulage setup). */
export default function Prebrief() {
  const { sc, state, dispatch, run } = useRun();
  if (!sc || !state || !run) return null;
  const s = sc.source;
  const pt = s.patient ?? {};
  const meta: [string, string | undefined][] = [
    ["Type", s.category],
    ["Level", s.level],
    ["Run time", s.run_time],
    ["Difficulty", s.difficulty],
    ["Crew", s.crew],
  ];
  const head: [string, string][] = [];
  if (s.protocols?.length) head.push(["Protocols", s.protocols.join(" | ")]);
  if (s.objectives?.length) head.push(["Objectives", s.objectives.map((o, i) => `(${i + 1}) ${o}`).join("  ")]);
  if (s.resources) head.push(["Resources", s.resources]);
  const tags = s.moulage_tags ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="sheet-headblock">
          <h1 className="sheet-title">{s.title}</h1>
          <div className="flex flex-wrap gap-x-3 text-sm">
            {meta
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <span key={k}>
                  <b>{k}:</b> {v}
                </span>
              ))}
          </div>
        </div>
        <KV rows={head} labelWidth="6rem" />
      </div>

      <div className="grid-2">
        <div className="flex flex-col gap-2">
          <Section title="Dispatch (read aloud)">
            <p className="read-aloud">
              <Md text={s.dispatch} />
            </p>
          </Section>
          <Section title="Scene / setup">
            <KV rows={Object.entries(s.scene ?? {}).map(([k, v]) => [k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), v])} labelWidth="5.5rem" />
          </Section>
          <Section title="Patient">
            <KV
              rows={(
                [
                  ["Patient", `${pt.name ?? ""}  ${pt.age ?? ""} ${pt.sex ?? ""}  ${pt.weight_kg ?? ""} kg`.trim()],
                  ["Chief complaint", pt.cc ?? ""],
                  ["On arrival", pt.on_arrival ?? ""],
                ] as [string, string][]
              ).filter(([, v]) => v)}
              labelWidth="7rem"
            />
          </Section>
        </div>
        <div className="flex flex-col gap-2">
          <Section title="Patient actor card" right="brief the actor">
            <KV rows={Object.entries(s.actor_card ?? {})} labelWidth="7.5rem" />
          </Section>
          <Section title="Crew card" right="shown on the student screen (Info) from the start">
            <div className="p-1.5 text-base">
              <Md text={s.crew_card?.dispatch ?? s.dispatch} />
              {s.crew_card?.on_arrival && (
                <>
                  <div className="font-bold text-sm mt-1">On arrival</div>
                  <Md text={s.crew_card.on_arrival} />
                </>
              )}
            </div>
          </Section>
        </div>
      </div>

      {tags.length > 0 && (
        <Section title="Moulage tags - setup" right="check = placed on the patient">
          <table className="sheet-table zebra">
            <thead>
              <tr>
                <th className="w-12">Placed</th>
                <th className="w-40">Region</th>
                <th>Tag text (crew sees)</th>
                <th>Instructor cue</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((t, i) => {
                const done = state.setup[i];
                return (
                  <tr key={i}>
                    <td className="p-0">
                      <button
                        type="button"
                        className="check-cell"
                        aria-pressed={!!done}
                        aria-label={`Placed: ${t.region}`}
                        onClick={() => dispatch({ kind: "setup", tagIndex: i, done: !done })}
                      >
                        <Box checked={!!done} />
                      </button>
                    </td>
                    <td className="font-bold">{t.region}</td>
                    <td>
                      <Md text={t.text} />
                    </td>
                    <td className="cue">{t.cue ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Vitals progression" right={s.vitals_note ?? "Give a value only when the crew obtains it. Bold = abnormal / key change."}>
        <VitalsTable interactive={false} />
      </Section>

      <div className="flex justify-end">
        <a className="sheet-btn font-bold flex items-center" href={href.scenario(run.entry.key, "run")}>
          Go to Run {state.clock.started ? `(${fmtT(state.clock.accMs)})` : ""}
        </a>
      </div>
    </div>
  );
}
