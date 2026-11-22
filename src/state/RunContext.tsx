// Active run: one in memory at a time, autosaved to a single localStorage key, mirrored to the student display.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { append, branchBodies, newRecord } from "../lib/run/actions.ts";
import { lastUndoable, reduce, type RunState } from "../lib/run/reducer.ts";
import type { RunEventBody, RunRecord } from "../lib/run/types.ts";
import { ensureHash, type LibraryEntry } from "../lib/scenario/library.ts";
import type { NormalizedScenario } from "../lib/scenario/normalize.ts";
import { toDisplay } from "../lib/display/toDisplay.ts";
import { BroadcastChannelTransport, DEFAULT_ROOM, DisplayPresence, type SyncMessage, type SyncStatus, type SyncTransport } from "../lib/sync/transport.ts";
import { SupabaseTransport } from "../lib/sync/supabase.ts";
import { activeConfig, newRoom, saveConfig, savedRoom, saveRoom, type BrokerConfig } from "../lib/sync/config.ts";
import { clearAutosave, loadAutosave, saveAutosave, type Autosave } from "./autosave.ts";

export interface ActiveRun {
  entry: LibraryEntry & { norm: NormalizedScenario };
  record: RunRecord;
  exported: boolean;
}

interface RunCtx {
  run: ActiveRun | null;
  state: RunState | null;
  sc: NormalizedScenario | null;
  start(entry: LibraryEntry): Promise<void>;
  resume(entry: LibraryEntry, record: RunRecord): void;
  dispatch(...bodies: RunEventBody[]): void;
  tapBranch(phaseId: string, branchId: string): void;
  undo(): void;
  setMeta(p: Partial<Pick<RunRecord, "trainee" | "evaluator" | "date" | "result">>): void;
  markExported(): void;
  discard(): void;
  openDisplay(): void;
  displayConnected: boolean;
  /** student display on another device (Supabase Realtime room) */
  remote: RemoteState;
  startRemote(): void;
  stopRemote(): void;
  /** new room code; any paired device has to re-pair */
  rotateRoom(): void;
  /** null = back to the build default */
  setBroker(c: BrokerConfig | null): void;
  /** push-to-display auto-switches the display to the info view */
  autoSwitch: boolean;
  setAutoSwitch(v: boolean): void;
  /** autosaved run found on load and not yet resumed/discarded; scenario routes wait for the decision */
  pendingResume: Autosave | null;
  clearPendingResume(discardSaved: boolean): void;
}

export interface RemoteState {
  room: string | null;
  status: SyncStatus;
  detail?: string;
  /** remote displays heard from recently */
  devices: number;
  config: BrokerConfig | null;
}

const Ctx = createContext<RunCtx | null>(null);

export function useRun(): RunCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRun outside RunProvider");
  return c;
}

export function displayUrl(): string {
  return `${location.pathname}${location.search}#/display`;
}

export function RunProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [pendingResume, setPendingResume] = useState<Autosave | null>(() => loadAutosave());
  const transport = useRef<SyncTransport | null>(null);
  const runRef = useRef<ActiveRun | null>(null);
  runRef.current = run;

  const state = useMemo(() => (run ? reduce(run.entry.norm, run.record.events) : null), [run]);
  const snapshot = useMemo(() => (run && state ? toDisplay(run.entry.norm, state, run.record.runId) : null), [run, state]);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;

  // transports, console side: the local window (BroadcastChannel) always, plus a remote room when paired
  const presence = useRef(new DisplayPresence());
  const [localCount, setLocalCount] = useState(0);
  const [config, setConfig] = useState<BrokerConfig | null>(() => activeConfig());
  const [room, setRoom] = useState<string | null>(() => (activeConfig() ? savedRoom() : null));
  const [rstatus, setRstatus] = useState<{ status: SyncStatus; detail?: string }>({ status: "idle" });
  const [remoteCount, setRemoteCount] = useState(0);
  const remoteT = useRef<SyncTransport | null>(null);
  const recount = useCallback(() => {
    setLocalCount(presence.current.count("local"));
    setRemoteCount(presence.current.count("remote"));
  }, []);

  const handle = useCallback(
    (t: SyncTransport, source: "local" | "remote") => (m: SyncMessage) => {
      if (m.type === "state") return; // another console in the room: ignore
      presence.current.note(m, source);
      recount();
      if (m.type === "hello" && snapRef.current) t.send({ type: "state", snapshot: snapRef.current });
    },
    [recount],
  );

  useEffect(() => {
    const t = new BroadcastChannelTransport();
    transport.current = t;
    void t.connect(DEFAULT_ROOM);
    const off = t.onMessage(handle(t, "local"));
    return () => {
      off();
      t.close();
    };
  }, [handle]);

  useEffect(() => {
    if (!room || !config) return;
    const t = new SupabaseTransport(config);
    remoteT.current = t;
    const offMsg = t.onMessage(handle(t, "remote"));
    const offStatus = t.onStatus((status, detail) => {
      setRstatus({ status, detail });
      // (re)joined: push the current state so a display that is already waiting catches up
      if (status === "connected" && snapRef.current) t.send({ type: "state", snapshot: snapRef.current });
    });
    void t.connect(room);
    const tick = setInterval(recount, 5000); // expire silent remote displays
    return () => {
      clearInterval(tick);
      offMsg();
      offStatus();
      t.close();
      remoteT.current = null;
      presence.current.clear("remote");
      recount();
      setRstatus({ status: "idle" });
    };
  }, [room, config, handle, recount]);

  useEffect(() => {
    if (!snapshot) return;
    transport.current?.send({ type: "state", snapshot });
    remoteT.current?.send({ type: "state", snapshot });
  }, [snapshot]);
  const displayConnected = localCount + remoteCount > 0;
  const remote: RemoteState = { room, ...rstatus, devices: remoteCount, config };

  // autosave every change (single key); cleared on export/discard
  useEffect(() => {
    if (!run || run.exported) return;
    const r = run.record;
    if (!r.events.length && !r.trainee && !r.evaluator && !r.result) return; // nothing worth resuming yet
    saveAutosave({
      entryKey: run.entry.key,
      imported: run.entry.source === "import" ? { file: run.entry.file, raw: run.entry.raw } : undefined,
      record: run.record,
    });
  }, [run]);

  const update = useCallback((f: (r: ActiveRun) => ActiveRun) => setRun((r) => (r ? f(r) : r)), []);

  const value: RunCtx = {
    run,
    state,
    sc: run?.entry.norm ?? null,
    async start(entry) {
      if (!entry.norm) return;
      const hash = await ensureHash(entry);
      const source = entry.source === "bundled" ? entry.file : `import:${entry.file}`;
      setRun({ entry: entry as ActiveRun["entry"], record: newRecord(entry.norm, hash, source), exported: false });
    },
    resume(entry, record) {
      if (!entry.norm) return;
      setPendingResume(null);
      setRun({ entry: entry as ActiveRun["entry"], record, exported: false });
    },
    dispatch(...bodies) {
      update((r) => ({ ...r, exported: false, record: { ...r.record, events: append(r.entry.norm, r.record.events, bodies) } }));
    },
    tapBranch(phaseId, branchId) {
      const r = runRef.current;
      if (!r) return;
      value.dispatch(...branchBodies(r.entry.norm, phaseId, branchId));
    },
    undo() {
      const r = runRef.current;
      const last = r && lastUndoable(r.record.events);
      if (last) value.dispatch({ kind: "undo", target: last.seq });
    },
    setMeta(p) {
      update((r) => ({ ...r, exported: false, record: { ...r.record, ...p } }));
    },
    markExported() {
      clearAutosave();
      update((r) => ({ ...r, exported: true, record: { ...r.record, exportedAt: new Date().toISOString() } }));
    },
    discard() {
      clearAutosave();
      setRun(null);
    },
    openDisplay() {
      window.open(displayUrl(), "scenario-runner-display", "popup=yes,width=1280,height=800");
    },
    displayConnected,
    remote,
    startRemote() {
      if (!config) return;
      const r = savedRoom() ?? newRoom();
      saveRoom(r);
      setRoom(r);
    },
    stopRemote() {
      saveRoom(null);
      setRoom(null);
    },
    rotateRoom() {
      const r = newRoom();
      saveRoom(r);
      setRoom(r);
    },
    setBroker(c) {
      saveConfig(c);
      const next = activeConfig();
      setConfig(next);
      if (!next) {
        saveRoom(null);
        setRoom(null);
      }
    },
    autoSwitch,
    setAutoSwitch,
    pendingResume,
    clearPendingResume(discardSaved) {
      if (discardSaved) clearAutosave();
      setPendingResume(null);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
