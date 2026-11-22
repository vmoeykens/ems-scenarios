// Hash routes (static hosting, no server rewrites; relative base).
import { useSyncExternalStore } from "react";

export type Route =
  | { name: "library" }
  | { name: "scenario"; key: string; tab: "prebrief" | "run" | "debrief" }
  | { name: "runs" }
  | { name: "display"; room?: string; broker?: string }
  | { name: "join" };

export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const p = path.replace(/^\/+/, "").split("/").map(decodeURIComponent);
  if (p[0] === "display") {
    const room = p[1] && /^\d{6}$/.test(p[1]) ? p[1] : undefined;
    const broker = new URLSearchParams(query).get("b") ?? undefined;
    return room ? { name: "display", room, ...(broker ? { broker } : {}) } : { name: "display" };
  }
  if (p[0] === "join") return { name: "join" };
  if (p[0] === "runs") return { name: "runs" };
  if (p[0] === "s" && p[1]) {
    const tab = p[2] === "run" || p[2] === "debrief" ? p[2] : "prebrief";
    return { name: "scenario", key: p[1], tab };
  }
  return { name: "library" };
}

export const href = {
  library: () => "#/",
  runs: () => "#/runs",
  display: () => "#/display",
  join: () => "#/join",
  scenario: (key: string, tab: "prebrief" | "run" | "debrief" = "prebrief") => `#/s/${encodeURIComponent(key)}/${tab}`,
};

export function navigate(h: string) {
  if (location.hash !== h) location.hash = h;
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseHash(hash);
}
