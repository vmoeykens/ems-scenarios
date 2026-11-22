// Supabase Realtime "broadcast" transport: relays messages between devices in a room; nothing is stored.
// The client library is loaded lazily, so it costs nothing until a remote display is used.
import type { BrokerConfig } from "./config.ts";
import { channelName, isSyncMessage, type SyncMessage, type SyncStatus, type SyncTransport } from "./transport.ts";

const EVENT = "msg";

/** The slice of supabase-js this transport uses (lets tests inject a fake). */
export interface RtChannel {
  on(type: "broadcast", filter: { event: string }, cb: (m: { payload?: unknown }) => void): RtChannel;
  subscribe(cb: (status: string, err?: Error) => void): RtChannel;
  send(args: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown>;
}
export interface RtClient {
  channel(name: string, opts: { config: { broadcast: { self: boolean; ack: boolean } } }): RtChannel;
  removeChannel(ch: RtChannel): Promise<unknown>;
}
export type ClientFactory = (cfg: BrokerConfig) => Promise<RtClient>;

const clients = new Map<string, Promise<RtClient>>();
export const supabaseClient: ClientFactory = (cfg) => {
  const k = `${cfg.url}|${cfg.key}`;
  let c = clients.get(k);
  if (!c) {
    c = import("@supabase/supabase-js").then(
      ({ createClient }) =>
        createClient(cfg.url, cfg.key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }) as unknown as RtClient,
    );
    clients.set(k, c);
  }
  return c;
};

export class SupabaseTransport implements SyncTransport {
  readonly kind = "supabase" as const;
  private client: RtClient | null = null;
  private ch: RtChannel | null = null;
  private ready = false;
  private gen = 0;
  /** sent before the channel joined: keep only the latest state plus control messages */
  private queue: SyncMessage[] = [];
  private subs = new Set<(m: SyncMessage) => void>();
  private statusSubs = new Set<(s: SyncStatus, detail?: string) => void>();
  status: SyncStatus = "idle";

  constructor(
    private cfg: BrokerConfig,
    private factory: ClientFactory = supabaseClient,
  ) {}

  private setStatus(s: SyncStatus, detail?: string) {
    this.status = s;
    for (const cb of this.statusSubs) cb(s, detail);
  }

  async connect(room: string): Promise<void> {
    this.close();
    const gen = ++this.gen;
    this.setStatus("connecting");
    let client: RtClient;
    try {
      client = await this.factory(this.cfg);
    } catch (e) {
      if (gen === this.gen) this.setStatus("error", e instanceof Error ? e.message : String(e));
      return;
    }
    if (gen !== this.gen) return; // closed or reconnected meanwhile
    this.client = client;
    const ch = client.channel(channelName(room), { config: { broadcast: { self: false, ack: false } } });
    this.ch = ch;
    ch.on("broadcast", { event: EVENT }, ({ payload }) => {
      if (!isSyncMessage(payload)) return;
      for (const cb of this.subs) cb(payload);
    });
    ch.subscribe((status, err) => {
      if (gen !== this.gen) return;
      if (status === "SUBSCRIBED") {
        this.ready = true;
        this.setStatus("connected");
        const q = this.queue;
        this.queue = [];
        for (const m of q) this.push(m);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.ready = false;
        this.setStatus("error", err?.message ?? status.toLowerCase().replace("_", " "));
      } else if (status === "CLOSED") {
        this.ready = false;
        if (this.status !== "idle") this.setStatus("connecting");
      }
    });
  }

  private push(m: SyncMessage) {
    this.ch?.send({ type: "broadcast", event: EVENT, payload: m }).catch(() => {});
  }

  send(msg: SyncMessage): void {
    if (this.ready) return this.push(msg);
    if (msg.type === "state") this.queue = this.queue.filter((m) => m.type !== "state");
    else if (msg.type === "ping") return; // a hello is sent on (re)join anyway
    this.queue.push(msg);
  }

  onMessage(cb: (msg: SyncMessage) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  onStatus(cb: (s: SyncStatus, detail?: string) => void): () => void {
    this.statusSubs.add(cb);
    return () => this.statusSubs.delete(cb);
  }

  close(): void {
    this.gen++;
    this.ready = false;
    this.queue = [];
    if (this.client && this.ch) void this.client.removeChannel(this.ch).catch(() => {});
    this.ch = null;
    this.client = null;
    if (this.status !== "idle") this.setStatus("idle");
  }
}
