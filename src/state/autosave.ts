// The app's only browser storage: one localStorage key holding the in-progress run (crash/refresh recovery).
// Cleared when the run is exported or discarded. No IndexedDB, no backend.
import type { RunRecord } from "../lib/run/types.ts";

export const AUTOSAVE_KEY = "scenario-runner:active-run";

export interface Autosave {
  v: 1;
  entryKey: string;
  /** imported scenarios are session-only: keep their JSON so a resumed run still has its scenario */
  imported?: { file: string; raw: string };
  record: RunRecord;
  savedAt: string;
}

export function loadAutosave(): Autosave | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Autosave;
    return a?.v === 1 && a.record?.events ? a : null;
  } catch {
    return null;
  }
}

export function saveAutosave(a: Omit<Autosave, "v" | "savedAt">): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), ...a }));
  } catch {
    /* storage full / disabled: run continues in memory */
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}
