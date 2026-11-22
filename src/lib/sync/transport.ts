// Console <-> student display sync, behind one interface:
//  - BroadcastChannelTransport: same browser, second window (always on, works offline).
//  - SupabaseTransport (./supabase.ts): another device, via a Realtime broadcast channel named by a 6-digit room code.
//    Nothing is stored: broadcast messages are relayed, never persisted. A self-hosted broker later is either a
//    self-hosted Supabase Realtime (same adapter, new URL) or a new adapter implementing SyncTransport.
// Only display-safe snapshots built by toDisplay() ever cross a transport.
import type { DisplaySnapshot } from "../display/toDisplay.ts";

export type SyncRole = "display";

export type SyncMessage =
  | { type: "state"; snapshot: DisplaySnapshot } // console -> display; full snapshot after every change (idempotent)
  | { type: "hello"; role: SyncRole; id?: string } // display -> console: please send a snapshot
  | { type: "ping"; role: SyncRole; id?: string } // display -> console: still here (remote displays, every PING_MS)
  | { type: "bye"; role: SyncRole; id?: string };

export type SyncKind = "broadcast" | "websocket" | "supabase";
export type SyncStatus = "idle" | "connecting" | "connected" | "error";

export interface SyncTransport {
  readonly kind: SyncKind;
  connect(room: string): Promise<void>;
  send(msg: SyncMessage): void;
  /** returns unsubscribe */
  onMessage(cb: (msg: SyncMessage) => void): () => void;
  /** optional connection status for remote transports; returns unsubscribe */
  onStatus?(cb: (s: SyncStatus, detail?: string) => void): () => void;
  close(): void;
}

export const DEFAULT_ROOM = "local";
export const PING_MS = 10_000;
/** a remote display counts as connected if heard from within this window */
export const STALE_MS = 25_000;
export const channelName = (room: string) => `scenario-runner:${room}`;

export function isSyncMessage(m: unknown): m is SyncMessage {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  if (t === "state") return typeof (m as { snapshot?: unknown }).snapshot === "object";
  return (t === "hello" || t === "ping" || t === "bye") && (m as { role?: unknown }).role === "display";
}

export class BroadcastChannelTransport implements SyncTransport {
  readonly kind = "broadcast" as const;
  private ch: BroadcastChannel | null = null;
  private subs = new Set<(m: SyncMessage) => void>();

  async connect(room: string = DEFAULT_ROOM): Promise<void> {
    this.close();
    if (typeof BroadcastChannel === "undefined") return;
    this.ch = new BroadcastChannel(channelName(room));
    this.ch.onmessage = (ev: MessageEvent<SyncMessage>) => {
      for (const cb of this.subs) cb(ev.data);
    };
  }
  send(msg: SyncMessage): void {
    this.ch?.postMessage(msg);
  }
  onMessage(cb: (msg: SyncMessage) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  close(): void {
    this.ch?.close();
    this.ch = null;
  }
}

/** Tracks which displays are alive: local ones by hello/bye, remote ones also by ping. */
export class DisplayPresence {
  private seen = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}
  /** returns true when the set of live displays may have changed */
  note(m: SyncMessage, source: string): boolean {
    if (m.type === "state") return false;
    const key = `${source}:${m.id ?? "anon"}`;
    if (m.type === "bye") return this.seen.delete(key);
    const had = this.seen.has(key);
    this.seen.set(key, this.now());
    return !had;
  }
  /** live display count per source ("local" / "remote"); remote entries expire after STALE_MS */
  count(source?: string): number {
    const t = this.now();
    let n = 0;
    for (const [k, at] of this.seen) {
      const [src] = k.split(":");
      if (src === "remote" && t - at > STALE_MS) {
        this.seen.delete(k);
        continue;
      }
      if (!source || src === source) n++;
    }
    return n;
  }
  clear(source: string): void {
    for (const k of [...this.seen.keys()]) if (k.startsWith(`${source}:`)) this.seen.delete(k);
  }
}
