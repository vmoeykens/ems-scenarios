// Remote display sync: broker config, pairing links, room codes, presence, and the Supabase transport
// (against a fake Realtime client; the real one is only loaded in the browser).
import { describe, expect, it, vi } from "vitest";
import { decodeConfig, displayHash, encodeConfig, newRoom, ROOM_RE, validConfig, type BrokerConfig } from "../src/lib/sync/config.ts";
import { SupabaseTransport, type RtChannel, type RtClient } from "../src/lib/sync/supabase.ts";
import { DisplayPresence, isSyncMessage, STALE_MS, type SyncMessage } from "../src/lib/sync/transport.ts";
import { parseHash } from "../src/lib/router.ts";
import { EMPTY_SNAPSHOT } from "../src/lib/display/toDisplay.ts";

const CFG: BrokerConfig = { kind: "supabase", url: "https://abcd.supabase.co", key: "sb_publishable_test" };

describe("broker config + pairing link", () => {
  it("round-trips through the link encoding", () => {
    const enc = encodeConfig(CFG);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeConfig(enc)).toEqual(CFG);
    expect(decodeConfig(encodeConfig({ ...CFG, url: "https://rt.example.org/" }))?.url).toBe("https://rt.example.org");
  });
  it("rejects junk", () => {
    expect(decodeConfig("not-base64!!")).toBeNull();
    expect(validConfig({ kind: "supabase", url: "javascript:alert(1)", key: "x" })).toBe(false);
    expect(validConfig({ kind: "supabase", url: "https://x.co", key: "" })).toBe(false);
    expect(validConfig({ kind: "mqtt", url: "https://x.co", key: "k" })).toBe(false);
  });
  it("link carries the broker when it is not the build default (none in tests)", () => {
    const h = displayHash("042917", CFG);
    expect(h.startsWith("#/display/042917?b=")).toBe(true);
    const r = parseHash(h);
    expect(r).toMatchObject({ name: "display", room: "042917" });
    expect(r.name === "display" && decodeConfig(r.broker!)).toEqual(CFG);
  });
  it("routes", () => {
    expect(parseHash("#/display")).toEqual({ name: "display" });
    expect(parseHash("#/display/12345")).toEqual({ name: "display" }); // not 6 digits: local
    expect(parseHash("#/display/000123")).toEqual({ name: "display", room: "000123" });
    expect(parseHash("#/join")).toEqual({ name: "join" });
  });
  it("room codes are 6 digits", () => {
    expect(newRoom(() => 0)).toBe("000000");
    expect(newRoom(() => 0.999999999)).toBe("999999");
    for (let i = 0; i < 50; i++) expect(newRoom()).toMatch(ROOM_RE);
  });
});

describe("presence", () => {
  it("local by hello/bye, remote expires without pings", () => {
    let t = 0;
    const p = new DisplayPresence(() => t);
    p.note({ type: "hello", role: "display", id: "a" }, "local");
    p.note({ type: "hello", role: "display", id: "b" }, "remote");
    expect([p.count("local"), p.count("remote")]).toEqual([1, 1]);
    t = STALE_MS - 1;
    p.note({ type: "ping", role: "display", id: "b" }, "remote");
    t += STALE_MS;
    expect(p.count("remote")).toBe(1);
    t += 2;
    expect([p.count("local"), p.count("remote")]).toEqual([1, 0]); // local never expires
    p.note({ type: "bye", role: "display", id: "a" }, "local");
    expect(p.count()).toBe(0);
  });
  it("message guard", () => {
    expect(isSyncMessage({ type: "hello", role: "display" })).toBe(true);
    expect(isSyncMessage({ type: "state", snapshot: {} })).toBe(true);
    expect(isSyncMessage({ type: "hello", role: "console" })).toBe(false);
    expect(isSyncMessage("x")).toBe(false);
  });
});

/** Fake Realtime: channels with the same name on one bus see each other's broadcasts. */
function fakeBus() {
  const chans: { name: string; ch: FakeChannel }[] = [];
  class FakeChannel implements RtChannel {
    handler: ((m: { payload?: unknown }) => void) | null = null;
    statusCb: ((s: string, e?: Error) => void) | null = null;
    sent: unknown[] = [];
    constructor(public name: string) {}
    on(_t: "broadcast", _f: { event: string }, cb: (m: { payload?: unknown }) => void) {
      this.handler = cb;
      return this;
    }
    subscribe(cb: (s: string, e?: Error) => void) {
      this.statusCb = cb;
      return this;
    }
    async send(a: { type: "broadcast"; event: string; payload: unknown }) {
      this.sent.push(a.payload);
      for (const o of chans) if (o.ch !== this && o.name === this.name) o.ch.handler?.({ payload: a.payload });
      return "ok";
    }
  }
  const client: RtClient = {
    channel(name) {
      const ch = new FakeChannel(name);
      chans.push({ name, ch });
      return ch;
    },
    async removeChannel(ch) {
      const i = chans.findIndex((c) => c.ch === ch);
      if (i >= 0) chans.splice(i, 1);
      return "ok";
    },
  };
  return { chans, factory: vi.fn(async () => client) };
}

describe("SupabaseTransport", () => {
  const snap = (run: string) => ({ ...EMPTY_SNAPSHOT, run });

  it("queues until SUBSCRIBED (latest state only), then relays between devices in the same room", async () => {
    const bus = fakeBus();
    const consoleT = new SupabaseTransport(CFG, bus.factory);
    const displayT = new SupabaseTransport(CFG, bus.factory);
    const statuses: string[] = [];
    consoleT.onStatus((s) => statuses.push(s));
    await consoleT.connect("123456");
    await displayT.connect("123456");
    expect(bus.chans.map((c) => c.name)).toEqual(["scenario-runner:123456", "scenario-runner:123456"]);

    const got: SyncMessage[] = [];
    displayT.onMessage((m) => got.push(m));
    consoleT.send({ type: "state", snapshot: snap("r1") });
    consoleT.send({ type: "state", snapshot: snap("r2") });
    expect(bus.chans[0].ch.sent).toEqual([]); // not joined yet

    bus.chans[1].ch.statusCb!("SUBSCRIBED");
    bus.chans[0].ch.statusCb!("SUBSCRIBED");
    await Promise.resolve();
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(got).toEqual([{ type: "state", snapshot: snap("r2") }]);

    // malformed payloads are dropped
    bus.chans[1].ch.handler!({ payload: { type: "state" } });
    expect(got).toHaveLength(1);
  });

  it("reports errors, ignores a stale connect after close, and leaves the channel on close", async () => {
    const bus = fakeBus();
    const t = new SupabaseTransport(CFG, bus.factory);
    const st: string[] = [];
    t.onStatus((s, d) => st.push(d ? `${s}:${d}` : s));
    await t.connect("111111");
    bus.chans[0].ch.statusCb!("CHANNEL_ERROR", new Error("boom"));
    expect(st.at(-1)).toBe("error:boom");
    t.close();
    expect(st.at(-1)).toBe("idle");
    await Promise.resolve();
    expect(bus.chans).toHaveLength(0);

    const slow = new SupabaseTransport(CFG, () => new Promise((r) => setTimeout(() => r(bus.factory.mock.results[0].value), 5)) as never);
    const p = slow.connect("222222");
    slow.close();
    await p;
    expect(bus.chans).toHaveLength(0);
  });

  it("factory failure surfaces as an error status", async () => {
    const t = new SupabaseTransport(CFG, async () => {
      throw new Error("offline");
    });
    const st: string[] = [];
    t.onStatus((s, d) => st.push(`${s}:${d ?? ""}`));
    await t.connect("333333");
    expect(st).toEqual(["connecting:", "error:offline"]);
  });
});
