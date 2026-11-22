// Minimal in-test stand-in for a Supabase Realtime server (Phoenix protocol, serializer vsn 2.0.0):
// acknowledges joins / heartbeats and relays user broadcasts to the other sockets on the same topic.
// Enough to drive the real supabase-js client across two browser contexts (two "devices").
import type { BrowserContext, WebSocketRoute } from "@playwright/test";

type Frame = string | Buffer;

export class FakeRealtime {
  private topics = new Map<WebSocketRoute, Set<string>>();
  readonly relayed: { topic: string; payload: unknown }[] = [];
  /** set to drop all relaying (simulates a broker outage) */
  paused = false;

  async attach(ctx: BrowserContext): Promise<void> {
    await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      this.topics.set(ws, new Set());
      ws.onMessage((m) => this.onFrame(ws, m as Frame));
      ws.onClose(() => this.topics.delete(ws));
    });
  }

  private reply(ws: WebSocketRoute, joinRef: string | null, ref: string | null, topic: string, response: unknown = {}) {
    ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response }]));
  }

  private onFrame(ws: WebSocketRoute, m: Frame) {
    if (typeof m === "string") {
      const [joinRef, ref, topic, event] = JSON.parse(m) as [string | null, string | null, string, string, unknown];
      if (event === "phx_join") {
        this.topics.get(ws)?.add(topic);
        this.reply(ws, joinRef, ref, topic, { postgres_changes: [] });
      } else if (event === "phx_leave") {
        this.topics.get(ws)?.delete(topic);
        this.reply(ws, joinRef, ref, topic);
      } else this.reply(ws, joinRef, ref, topic); // heartbeat, access_token, ...
      return;
    }
    // binary user broadcast push: kind 3, then lengths: joinRef, ref, topic, event, meta; encoding; fields; payload
    const b = Buffer.from(m);
    if (b[0] !== 3) return;
    const [jl, rl, tl, el, ml, enc] = [b[1], b[2], b[3], b[4], b[5], b[6]];
    let o = 7;
    const take = (n: number) => b.subarray(o, (o += n)).toString("utf8");
    take(jl);
    take(rl);
    const topic = take(tl);
    const event = take(el);
    const meta = take(ml);
    const payload = b.subarray(o);
    if (enc === 1) this.relayed.push({ topic, payload: JSON.parse(payload.toString("utf8")) });
    if (this.paused) return;
    // server -> client user broadcast: kind 4, topic len, event len, meta len, encoding, topic, event, meta, payload
    const t = Buffer.from(topic);
    const e = Buffer.from(event);
    const mt = Buffer.from(meta);
    const out = Buffer.concat([Buffer.from([4, t.length, e.length, mt.length, enc]), t, e, mt, payload]);
    for (const [other, joined] of this.topics) if (other !== ws && joined.has(topic)) other.send(out);
  }
}
