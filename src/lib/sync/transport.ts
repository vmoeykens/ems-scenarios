// Console <-> student display sync. v1 = BroadcastChannel (same browser, second window).
// WebSocket / Supabase Realtime (6-digit room) can implement the same interface later.
import type { DisplaySnapshot } from "../display/toDisplay.ts";

export type SyncMessage =
  | { type: "state"; snapshot: DisplaySnapshot } // console -> display; full snapshot after every change (idempotent)
  | { type: "hello"; role: "display" } // display -> console: please send a snapshot
  | { type: "bye"; role: "display" };

export interface SyncTransport {
  readonly kind: "broadcast" | "websocket" | "supabase";
  connect(room: string): Promise<void>;
  send(msg: SyncMessage): void;
  /** returns unsubscribe */
  onMessage(cb: (msg: SyncMessage) => void): () => void;
  close(): void;
}

export const DEFAULT_ROOM = "local";
export const channelName = (room: string) => `scenario-runner:${room}`;

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
