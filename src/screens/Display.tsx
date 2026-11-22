// Student display (#/display), opened in its own window. Receives display-safe snapshots only (see toDisplay()).
// Two views the crew can switch between: MONITOR (patient-monitor look, the one dark screen) and INFO / CARDS (paper).
import { useEffect, useRef, useState } from "react";
import { EMPTY_SNAPSHOT, type DisplaySnapshot } from "../lib/display/toDisplay.ts";
import type { DisplayView, MonitorLayout } from "../lib/run/types.ts";
import { BroadcastChannelTransport, DEFAULT_ROOM, PING_MS, type SyncStatus, type SyncTransport } from "../lib/sync/transport.ts";
import { SupabaseTransport } from "../lib/sync/supabase.ts";
import { activeConfig, decodeConfig, ROOM_RE, type BrokerConfig } from "../lib/sync/config.ts";
import { href, navigate } from "../lib/router.ts";
import { FOOTER } from "../lib/scenario/constants.ts";
import { CardFace } from "../ui/CardFace.tsx";
import { LiveTrace, TwelveLive } from "../ui/LiveTrace.tsx";

/** Monitor colors come from the --color-zoll-* tokens in src/index.css (single place to adjust). */
export function cssColor(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
}

export interface DisplayLink {
  status: SyncStatus | "no-broker";
  detail?: string;
  room?: string;
}

/** Display side: local window by default; a 6-digit room joins the console from another device. */
export function useDisplaySnapshot(room?: string, broker?: string): { snap: DisplaySnapshot; link: DisplayLink } {
  const [snap, setSnap] = useState<DisplaySnapshot>(EMPTY_SNAPSHOT);
  const cfg: BrokerConfig | null = room ? ((broker && decodeConfig(broker)) || activeConfig()) : null;
  const cfgKey = cfg ? `${cfg.url}|${cfg.key}` : "";
  const [link, setLink] = useState<DisplayLink>({ status: room ? (cfg ? "connecting" : "no-broker") : "connected", room });
  useEffect(() => {
    if (room && !cfg) {
      setLink({ status: "no-broker", room });
      return;
    }
    const id = Math.random().toString(36).slice(2, 10);
    const t: SyncTransport = room && cfg ? new SupabaseTransport(cfg) : new BroadcastChannelTransport();
    const hello = () => t.send({ type: "hello", role: "display", id });
    const off = t.onMessage((m) => m.type === "state" && setSnap(m.snapshot));
    const offStatus =
      t.onStatus?.((status, detail) => {
        setLink({ status, detail, room });
        if (status === "connected") hello(); // (re)joined: ask for the current state
      }) ?? (() => {});
    void t.connect(room ?? DEFAULT_ROOM).then(hello);
    const ping = room ? setInterval(() => t.send({ type: "ping", role: "display", id }), PING_MS) : undefined;
    const bye = () => t.send({ type: "bye", role: "display", id });
    window.addEventListener("pagehide", bye);
    return () => {
      bye();
      clearInterval(ping);
      window.removeEventListener("pagehide", bye);
      off();
      offStatus();
      t.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, cfgKey]);
  return { snap, link };
}

function LinkBadge({ link }: { link: DisplayLink }) {
  if (!link.room) return null;
  const text =
    link.status === "connected"
      ? `LINKED ${link.room}`
      : link.status === "no-broker"
        ? "NOT SET UP: open the link or QR code from the instructor console"
        : link.status === "error"
          ? `RECONNECTING ${link.room}${link.detail ? ` (${link.detail})` : ""}`
          : `CONNECTING ${link.room}`;
  return (
    <span className="display-sim" data-testid="display-link" data-status={link.status}>
      {text}
    </span>
  );
}

/** #/join: type the 6-digit code shown on the instructor console. */
export function Join() {
  const [code, setCode] = useState("");
  useEffect(() => {
    document.title = "Join student display";
  }, []);
  const ok = ROOM_RE.test(code);
  return (
    <div className="page max-w-md">
      <h1 className="sheet-title mb-2">Join student display</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) navigate(`#/display/${code}`);
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="join-code" className="text-sm">
          Enter the 6-digit code shown on the instructor console (Student screen &gt; Other device).
        </label>
        <input
          id="join-code"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          className="border border-ink min-h-14 px-2 text-3xl tracking-widest font-bold"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          data-testid="join-code"
        />
        <button type="submit" className="sheet-btn font-bold" disabled={!ok} data-testid="join-go">
          Join
        </button>
        {!activeConfig() && <p className="text-sm text-alert">This copy of the app has no broker set up. Scan the QR code from the console instead; it carries the settings.</p>}
        <a className="text-sm underline" href={href.library()}>
          Back to library
        </a>
      </form>
    </div>
  );
}

export default function Display({ room, broker }: { room?: string; broker?: string }) {
  const { snap, link } = useDisplaySnapshot(room, broker);
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
  const [layout, setLayout] = useState<MonitorLayout>("single");
  const lastLayoutSeq = useRef(-1);
  useEffect(() => {
    if (snap.layoutSeq !== lastLayoutSeq.current) {
      lastLayoutSeq.current = snap.layoutSeq;
      setLayout(snap.layout);
    }
  }, [snap.layoutSeq, snap.layout]);
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
        <LinkBadge link={link} />
        {view === "monitor" && (
          <div className="lead-toggle" role="group" aria-label="ECG layout">
            <button type="button" aria-pressed={layout === "single"} onClick={() => setLayout("single")} data-testid="layout-single">
              Lead II
            </button>
            <button type="button" aria-pressed={layout === "12lead"} onClick={() => setLayout("12lead")} data-testid="layout-12lead">
              12-lead
            </button>
          </div>
        )}
      </nav>
      {view === "monitor" ? <MonitorView snap={snap} layout={layout} /> : <InfoView snap={snap} />}
      <footer className="display-footer">{FOOTER}</footer>
    </div>
  );
}

/** "95% RA" -> ["95", "RA"]; "16 CPR" -> ["16", "CPR"]; "--" when not given. */
export function splitReading(v: string | undefined): [string, string] {
  if (!v) return ["--", ""];
  const m = /^\s*([\d.]+(?:\/[\d.]+)?)\s*%?\s*(.*)$/.exec(v);
  return m ? [m[1], m[2]] : [v, ""];
}

/** Mean arterial pressure from a revealed "SBP/DBP" (what the monitor computes and shows in parentheses). */
export function mapOf(bp: string | undefined): string {
  const m = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(bp ?? "");
  return m ? `(${Math.round((Number(m[1]) + 2 * Number(m[2])) / 3)})` : "";
}

function useViewportHeight(): number {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const f = () => setH(window.innerHeight);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return h;
}

function MonitorView({ snap, layout }: { snap: DisplaySnapshot; layout: MonitorLayout }) {
  const vh = useViewportHeight();
  const C = {
    ecg: cssColor("--color-zoll-ecg", "#00ff00"),
    spo2: cssColor("--color-zoll-spo2", "#00c8ff"),
    co2: cssColor("--color-zoll-co2", "#ffff00"),
  };
  const avail = Math.max(300, vh - 150); // minus tabs, bottom row, footer
  const [hr, hrSub] = splitReading(snap.vitals.HR);
  const [spo2, spo2Sub] = splitReading(snap.vitals.SpO2);
  const [et, etSub] = splitReading(snap.vitals.EtCO2);
  const [br] = splitReading(snap.vitals.RR);
  const [temp] = splitReading(snap.vitals.Temp);
  return (
    <main className="monitor" data-testid="monitor" data-layout={layout}>
      <div className="monitor-waves">
        {layout === "12lead" ? (
          <TwelveLive ecg={snap.ecg} leadSt={snap.leadSt} color={C.ecg} height={Math.round(avail * 0.97)} />
        ) : (
          <>
            <LiveTrace kind="ecg" ecg={snap.ecg} span={6} color={C.ecg} label="II" scale="x1.0  25 mm/s" height={Math.round(avail * 0.42)} offText="ECG --" />
            <LiveTrace kind="pleth" pleth={snap.pleth} span={6} color={C.spo2} label="SpO2" scale="25 mm/s" height={Math.round(avail * 0.26)} offText="SpO2 --" />
            <LiveTrace kind="capno" capno={snap.capno} span={16} color={C.co2} label="CO2" scale="mmHg  6.25 mm/s" height={Math.round(avail * 0.27)} offText="CO2 --" />
          </>
        )}
        <div className="monitor-sim">SIMULATED</div>
      </div>
      <div className="monitor-nums">
        <Num label="HR" unit="bpm" value={hr} sub={hrSub} big color="var(--color-zoll-ecg)" testId="num-HR" />
        <Num label="NIBP" unit="mmHg" value={splitReading(snap.vitals.BP)[0]} sub={mapOf(snap.vitals.BP)} color="var(--color-zoll-nibp)" testId="num-BP" />
        <Num label="SpO2" unit="%" value={spo2} sub={spo2Sub} big color="var(--color-zoll-spo2)" testId="num-SpO2" />
        <Num label="EtCO2" unit="mmHg" value={et} sub={etSub} color="var(--color-zoll-co2)" testId="num-EtCO2" extra={["BR", br, "num-RR"]} />
        <Num label="T1" unit="F" value={temp} color="var(--color-zoll-temp)" testId="num-Temp" />
      </div>
      <div className="monitor-row">
        <Num label="BGL" unit="mg/dL" value={splitReading(snap.vitals.BGL)[0]} small testId="num-BGL" />
        <Num label="GCS" unit="" value={snap.vitals.GCS ?? "--"} small testId="num-GCS" />
        <Num label="Pain" unit="/10" value={snap.vitals.Pain ?? "--"} small testId="num-Pain" />
        <Num label="Pupils" unit="" value={snap.vitals.Pupils ?? "--"} small testId="num-Pupils" />
      </div>
    </main>
  );
}

function Num(p: { label: string; unit: string; value: string; sub?: string; big?: boolean; small?: boolean; color?: string; testId: string; extra?: [string, string, string] }) {
  return (
    <div
      className={`num ${p.big ? "num-big" : ""} ${p.small ? "num-small" : ""}`}
      data-testid={p.testId}
      style={p.color ? ({ "--num-color": p.color } as React.CSSProperties) : undefined}
    >
      <div className="num-head">
        <span>{p.label}</span>
        <span className="num-unit">{p.unit}</span>
      </div>
      <div className="num-row">
        <span className={`num-value tabular-nums ${p.value === "--" ? "opacity-60" : ""}`}>{p.value}</span>
        {p.sub && <span className="num-sub">{p.sub}</span>}
        {p.extra && (
          <span className="ml-auto text-right" data-testid={p.extra[2]}>
            <span className="num-unit block">{p.extra[0]}</span>
            <span className="text-3xl font-bold tabular-nums">{p.extra[1]}</span>
          </span>
        )}
      </div>
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
