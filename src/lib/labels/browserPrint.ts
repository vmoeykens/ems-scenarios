// Minimal client for Zebra Browser Print (the free Zebra agent that runs on the instructor's computer and
// relays raw ZPL to USB / network / Bluetooth Zebra printers). The app stays static: it only talks to the
// agent on this computer's loopback address. Without the agent, use Download .zpl / Copy instead.
//
// Endpoints (same ones BrowserPrint-3.x.js uses): GET /default?type=printer, GET /available, POST /write.
// Requests are text/plain so the browser sends them without a CORS preflight.

export interface BPDevice {
  name: string;
  uid: string;
  connection?: string;
  deviceType?: string;
  provider?: string;
  manufacturer?: string;
  version?: number;
}

export const BP_BASES = ["http://127.0.0.1:9100", "https://127.0.0.1:9101"];

type Fetch = typeof fetch;

async function call(base: string, path: string, init: RequestInit | undefined, f: Fetch, timeoutMs: number): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await f(base + path, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function asDevice(x: unknown): BPDevice | null {
  const d = x as Partial<BPDevice> | null;
  return d && typeof d.name === "string" && typeof d.uid === "string" ? (d as BPDevice) : null;
}

export interface BPStatus {
  base: string;
  printers: BPDevice[];
  defaultUid?: string;
}

/** Find a running Browser Print agent and its printers. Throws if none answers. */
export async function findPrinters(f: Fetch = fetch, timeoutMs = 2500): Promise<BPStatus> {
  let lastErr: unknown = null;
  for (const base of BP_BASES) {
    try {
      const avail = JSON.parse((await call(base, "/available", undefined, f, timeoutMs)) || "{}");
      const list = Array.isArray(avail?.printer) ? avail.printer : [];
      const printers = list.map(asDevice).filter((d: BPDevice | null): d is BPDevice => !!d);
      let defaultUid: string | undefined;
      try {
        const def = asDevice(JSON.parse((await call(base, "/default?type=printer", undefined, f, timeoutMs)) || "null"));
        if (def) {
          defaultUid = def.uid;
          if (!printers.some((p: BPDevice) => p.uid === def.uid)) printers.unshift(def);
        }
      } catch {
        /* no default printer set */
      }
      return { base, printers, defaultUid };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    "Zebra Browser Print not found on this computer" + (lastErr instanceof Error && lastErr.name !== "AbortError" ? ` (${lastErr.message})` : ""),
  );
}

/** Send raw ZPL to a printer through the agent. */
export async function sendZpl(base: string, device: BPDevice, zpl: string, f: Fetch = fetch, timeoutMs = 15000): Promise<void> {
  await call(base, "/write", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ device, data: zpl }) }, f, timeoutMs);
}
