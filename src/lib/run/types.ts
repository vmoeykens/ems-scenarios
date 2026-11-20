// Event-sourced run log (docs/PLAN.md section 8). The run is an append-only list of events; UI state = reduce(events).
import type { VitalKey } from "../scenario/types.ts";

export type HistorySection = "SAMPLE" | "OPQRST" | "primary" | "secondary";
export type DisplayView = "monitor" | "info";

export type RunEventBody =
  | { kind: "clock"; action: "start" | "pause" | "resume" | "reset" }
  | { kind: "phase"; phaseId: string }
  | { kind: "stage"; stageKey: string; via?: string /* branch id */ }
  | { kind: "branch"; phaseId: string; branchId: string; inject: boolean }
  | { kind: "expected"; itemId: string; checked: boolean }
  | { kind: "reveal"; stageKey: string; vital: VitalKey; value: string; adlib?: boolean }
  | { kind: "history"; section: HistorySection; index: number; done: boolean }
  | { kind: "card"; cardIndex: number; action: "show" | "hide" }
  | { kind: "tag"; tagIndex: number; action: "show" | "hide" }
  | { kind: "setup"; tagIndex: number; done: boolean }
  | { kind: "critical"; itemId: string; status: "met" | "missed" | null }
  | { kind: "note"; text: string; quick?: boolean }
  | { kind: "display"; view?: DisplayView; ecg?: boolean; capno?: boolean }
  | { kind: "undo"; target: number /* seq of the undone event */ };

export type RunEvent = RunEventBody & {
  seq: number;
  /** ms on the scenario clock (pauses excluded; 0 before start) */
  t: number;
  /** wall clock, ISO 8601 */
  wall: string;
};

export type Result = "pass" | "remediate" | "fail";

export interface RunRecord {
  format: "scenario-runner-run";
  formatVersion: 1;
  runId: string;
  scenarioId: string;
  scenarioTitle: string;
  scenarioVersion: string;
  /** sha-256 (hex) of the scenario JSON text used for the run */
  scenarioHash: string;
  /** bundled file name, or "import:<name>" */
  scenarioSource: string;
  trainee: string;
  evaluator: string;
  date: string; // YYYY-MM-DD
  result: Result | null;
  events: RunEvent[];
  app: string;
  footer: string;
  createdAt: string;
  exportedAt?: string;
}

export const APP_NAME = "Scenario Runner";
export const RUN_FORMAT = "scenario-runner-run" as const;
