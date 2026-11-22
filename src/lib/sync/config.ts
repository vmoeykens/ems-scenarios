// Remote-display broker settings and room codes.
// Precedence: settings saved in this browser > build-time env (VITE_SUPABASE_URL / VITE_SUPABASE_KEY).
// The key is Supabase's public "publishable" / anon key: it is meant to ship in front-end code.
// Pairing links carry the broker config only when it differs from the build default, so a display device
// can join a self-hosted or overridden broker without a rebuild.

export interface BrokerConfig {
  kind: "supabase";
  /** e.g. https://abcd.supabase.co, or a self-hosted Realtime base URL */
  url: string;
  key: string;
}

const STORE_KEY = "scenario-runner:sync-config";
const ROOM_KEY = "scenario-runner:room";

function env(name: string): string {
  const e = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (e?.[name] ?? "").trim();
}

export function buildDefault(): BrokerConfig | null {
  const url = env("VITE_SUPABASE_URL");
  const key = env("VITE_SUPABASE_KEY") || env("VITE_SUPABASE_ANON_KEY");
  return url && key ? { kind: "supabase", url: normalizeUrl(url), key } : null;
}

export function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

export function validConfig(c: unknown): c is BrokerConfig {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (o.kind !== "supabase" || typeof o.url !== "string" || typeof o.key !== "string" || !o.key) return false;
  try {
    const p = new URL(o.url);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function savedConfig(): BrokerConfig | null {
  try {
    const raw = storage()?.getItem(STORE_KEY);
    const c = raw ? JSON.parse(raw) : null;
    return validConfig(c) ? c : null;
  } catch {
    return null;
  }
}

export function saveConfig(c: BrokerConfig | null): void {
  const s = storage();
  try {
    if (!c) s?.removeItem(STORE_KEY);
    else s?.setItem(STORE_KEY, JSON.stringify({ ...c, url: normalizeUrl(c.url) }));
  } catch {
    /* storage unavailable: config just isn't remembered */
  }
}

export function activeConfig(): BrokerConfig | null {
  return savedConfig() ?? buildDefault();
}

const same = (a: BrokerConfig | null, b: BrokerConfig | null) => !!a && !!b && a.kind === b.kind && a.url === b.url && a.key === b.key;

// --- pairing-link encoding (base64url JSON, short keys) ---
export function encodeConfig(c: BrokerConfig): string {
  const json = JSON.stringify({ k: c.kind, u: c.url, a: c.key });
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeConfig(s: string): BrokerConfig | null {
  try {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (ch) => ch.charCodeAt(0))));
    const c = { kind: o.k, url: normalizeUrl(String(o.u ?? "")), key: o.a };
    return validConfig(c) ? c : null;
  } catch {
    return null;
  }
}

/** Hash route for a display joining `room` (relative: prefix with the page URL to share). */
export function displayHash(room: string, c: BrokerConfig | null = activeConfig()): string {
  const b = c && !same(c, buildDefault()) ? `?b=${encodeConfig(c)}` : "";
  return `#/display/${room}${b}`;
}

// --- room codes ---
export const ROOM_RE = /^\d{6}$/;

export function newRoom(rand: () => number = secureRandom): string {
  return String(Math.floor(rand() * 1_000_000)).padStart(6, "0");
}

function secureRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

/** Console keeps its room across reloads so a paired device stays paired. */
export function savedRoom(): string | null {
  const r = storage()?.getItem(ROOM_KEY) ?? null;
  return r && ROOM_RE.test(r) ? r : null;
}

export function saveRoom(r: string | null): void {
  try {
    if (r) storage()?.setItem(ROOM_KEY, r);
    else storage()?.removeItem(ROOM_KEY);
  } catch {
    /* ignore */
  }
}
