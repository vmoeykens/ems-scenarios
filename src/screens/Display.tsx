// Student display (#/display), opened in its own window. Receives display-safe snapshots only (see toDisplay()).
// Two views the crew can switch between: MONITOR (patient-monitor look, the one dark screen) and INFO / CARDS (paper).
import { useEffect, useRef, useState } from "react";
import { EMPTY_SNAPSHOT, type DisplaySnapshot } from "../lib/display/toDisplay.ts";
import type { DisplayView } from "../lib/run/types.ts";
import type { VitalKey } from "../lib/scenario/types.ts";
import { BroadcastChannelTransport, DEFAULT_ROOM } from "../lib/sync/transport.ts";
import { FOOTER } from "../lib/scenario/constants.ts";
import { CardFace } from "../ui/CardFace.tsx";
import { LiveTrace } from "../ui/LiveTrace.tsx";

const WAVE = "#22c55e"; // --color-monitor-wave

export function useDisplaySnapshot(): DisplaySnapshot {
  const [snap, setSnap] = useState<DisplaySnapshot>(EMPTY_SNAPSHOT);
  useEffect(() => {
    const t = new BroadcastChannelTransport();
    let off = () => {};
    void t.connect(DEFAULT_ROOM).then(() => {
      off = t.onMessage((m) => m.type === "state" && setSnap(m.snapshot));
      t.send({ type: "hello", role: "display" });
    });
    const bye = () => t.send({ type: "bye", role: "display" });
    window.addEventListener("pagehide", bye);
    return () => {
      bye();
      window.removeEventListener("pagehide", bye);
      off();
      t.close();
    };
  }, []);
  return snap;
}

export default function Display() {
  const snap = useDisplaySnapshot();
  const [view, setView] = useState<DisplayView>("monitor");
  const lastViewSeq = useRef(-1);
  const [seenCards, setSeenCards] = useState(0);

  // follow the instructor's view changes; the crew can still switch locally
  useEffect(() => {
    if (snap.viewSeq !== lastViewSeq.current) {
      lastViewSeq.current = snap.viewSeq;
      setView(snap.view);
    }
  }, [snap.viewSeq, snap.view]);
  useEffect(() => {
    if (view === "info") setSeenCards(snap.cards.length);
  }, [view, snap.cards.length]);
  useEffect(() => {
    document.title = "Student display - SIMULATED";
  }, []);

  const unseen = Math.max(0, snap.cards.length - seenCards);
  return (
    <div className={`display ${view === "monitor" ? "display-monitor" : "display-info"}`} data-testid="display" data-view={view}>
      <nav className="display-tabs" aria-label="Display views">
        <button type="button" className={`dtab ${view === "monitor" ? "dtab-on" : ""}`} aria-pressed={view === "monitor"} onClick={() => setView("monitor")} data-testid="dtab-monitor">
          MONITOR
        </button>
        <button type="button" className={`dtab ${view === "info" ? "dtab-on" : ""}`} aria-pressed={view === "info"} onClick={() => setView("info")} data-testid="dtab-info">
          INFO / CARDS{unseen > 0 && view !== "info" ? ` (${unseen} new)` : ""}
        </button>
        <span className="display-sim">SIMULATED - training only</span>
      </nav>
      {view === "monitor" ? <MonitorView snap={snap} /> : <InfoView snap={snap} />}
      <footer className="display-footer">{FOOTER}</footer>
    </div>
  );
}

const show = (snap: DisplaySnapshot, k: VitalKey) => snap.vitals[k] || "--";

function useViewportHeight(): number {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const f = () => setH(window.innerHeight);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return h;
}

function MonitorView({ snap }: { snap: DisplaySnapshot }) {
  const vh = useViewportHeight();
  const ecgH = Math.max(160, Math.round(vh * 0.36));
  const co2H = Math.max(110, Math.round(vh * 0.22));
  return (
    <main className="monitor" data-testid="monitor">
      <div className="monitor-waves">
        <LiveTrace kind="ecg" ecg={snap.ecg} span={6} color={WAVE} label="II  x1  25 mm/s" height={ecgH} />
        <LiveTrace kind="capno" capno={snap.capno} span={16} color={WAVE} label="CO2 mmHg" height={co2H} />
        <div className="monitor-sim">SIMULATED</div>
      </div>
      <div className="monitor-nums">
        <Num label="HR" unit="bpm" value={show(snap, "HR")} big testId="num-HR" />
        <Num label="SpO2" unit="%" value={show(snap, "SpO2").replace(/%.*$/, "")} sub={/%\s*(.+)$/.exec(snap.vitals.SpO2 ?? "")?.[1]} big testId="num-SpO2" />
        <Num label="NIBP" unit="mmHg" value={show(snap, "BP")} testId="num-BP" />
        <Num label="RR" unit="/min" value={show(snap, "RR")} testId="num-RR" />
        <Num label="EtCO2" unit="mmHg" value={show(snap, "EtCO2")} testId="num-EtCO2" />
      </div>
      <div className="monitor-row">
        <Num label="BGL" unit="mg/dL" value={show(snap, "BGL")} small testId="num-BGL" />
        <Num label="Temp" unit="F" value={show(snap, "Temp")} small testId="num-Temp" />
        <Num label="GCS" unit="" value={show(snap, "GCS")} small testId="num-GCS" />
        <Num label="Pain" unit="/10" value={show(snap, "Pain")} small testId="num-Pain" />
        <Num label="Pupils" unit="" value={show(snap, "Pupils")} small testId="num-Pupils" />
      </div>
    </main>
  );
}

function Num({ label, unit, value, sub, big, small, testId }: { label: string; unit: string; value: string; sub?: string; big?: boolean; small?: boolean; testId: string }) {
  return (
    <div className={`num ${big ? "num-big" : ""} ${small ? "num-small" : ""}`} data-testid={testId}>
      <div className="num-label">
        {label} <span className="num-unit">{unit}</span>
      </div>
      <div className="num-value tabular-nums">{value}</div>
      {sub && <div className="num-unit">{sub}</div>}
    </div>
  );
}

function InfoView({ snap }: { snap: DisplaySnapshot }) {
  const cc = snap.crewCard;
  return (
    <main className="info" data-testid="info">
      <section className="info-crew">
        <div className="section">
          <div className="section-bar">
            <span>Crew card</span>
          </div>
          <div className="p-3">
            <div className="text-sm font-bold">DISPATCH</div>
            <p className="text-2xl leading-snug" data-testid="crew-dispatch">
              {cc.dispatch || "Waiting for the instructor..."}
            </p>
            {cc.on_arrival && (
              <>
                <div className="text-sm font-bold mt-3">ON ARRIVAL</div>
                <p className="text-2xl leading-snug">{cc.on_arrival}</p>
              </>
            )}
          </div>
        </div>
      </section>
      <section className="info-cards" aria-label="Cards shown by the instructor, newest first">
        {snap.cards.length === 0 && <p className="text-xl text-cue p-4">Cards and findings shown by the instructor appear here (newest first).</p>}
        {snap.cards.map((c, i) => (
          <div key={c.key} className={`info-card ${i === 0 ? "info-card-new" : ""}`}>
            <CardFace card={c} large />
          </div>
        ))}
      </section>
    </main>
  );
}
