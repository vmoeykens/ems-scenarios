// Human-readable event descriptions (instructor-facing: debrief timeline + exports).
import type { NormalizedScenario } from "../scenario/normalize.ts";
import { stripMarkup } from "../scenario/text.ts";
import type { RunEvent } from "./types.ts";

export function describeEvent(sc: NormalizedScenario, e: RunEvent): string {
  const phase = (id: string) => sc.phases.find((p) => p.id === id);
  const stage = (k: string) => sc.stages.find((s) => s.key === k);
  switch (e.kind) {
    case "clock":
      return `Clock ${e.action}`;
    case "phase":
      return `Phase -> ${phase(e.phaseId)?.phase ?? e.phaseId}`;
    case "stage": {
      const via = e.via ? " (via branch)" : "";
      return `Vitals stage -> ${stage(e.stageKey)?.stage ?? e.stageKey}${via}`;
    }
    case "branch": {
      const b = phase(e.phaseId)?.branchList.find((x) => x.id === e.branchId);
      return `${e.inject ? "EXAMINER OPTION" : "IF"}: ${stripMarkup(b?.if ?? e.branchId)} -> ${stripMarkup(b?.then ?? "")}`;
    }
    case "expected": {
      const item = sc.phases.flatMap((p) => p.expectedItems).find((i) => i.id === e.itemId);
      return `${e.checked ? "Done" : "Un-checked"}: ${stripMarkup(item?.text ?? e.itemId)}`;
    }
    case "reveal":
      return `${e.adlib ? "Ad-lib " : ""}${e.vital} ${stripMarkup(e.value)} (stage ${e.stageKey})`;
    case "history": {
      const src =
        e.section === "SAMPLE" || e.section === "OPQRST" ? sc.source.history?.[e.section] : e.section === "primary" ? sc.source.primary : sc.source.secondary;
      const row = src?.[e.index];
      const verb = e.section === "SAMPLE" || e.section === "OPQRST" ? "asked" : "assessed";
      return `${e.done ? "" : "Un-marked: "}${e.section} ${row ? stripMarkup(row[0]) : e.index} ${verb}`;
    }
    case "card":
      return `${e.action === "show" ? "Pushed card" : "Retracted card"}: ${stripMarkup(sc.source.show_cards?.[e.cardIndex]?.title ?? e.cardIndex)}`;
    case "tag":
      return `${e.action === "show" ? "Pushed tag" : "Retracted tag"}: ${stripMarkup(sc.source.moulage_tags?.[e.tagIndex]?.region ?? e.tagIndex)}`;
    case "setup":
      return `Moulage ${e.done ? "placed" : "removed"}: ${stripMarkup(sc.source.moulage_tags?.[e.tagIndex]?.region ?? e.tagIndex)}`;
    case "critical": {
      const c = sc.critical.find((x) => x.id === e.itemId);
      const st = e.status === "met" ? "MET" : e.status === "missed" ? "MISSED (evaluator discretion)" : "cleared";
      return `Critical ${st}: ${stripMarkup(c?.text ?? e.itemId)}`;
    }
    case "note":
      return `${e.quick ? "Quick note" : "Note"}: ${e.text}`;
    case "display": {
      const parts = [];
      if (e.view) parts.push(`view ${e.view}`);
      if (e.ecg !== undefined) parts.push(`ECG ${e.ecg ? "on" : "off"}`);
      if (e.capno !== undefined) parts.push(`capno ${e.capno ? "on" : "off"}`);
      if (e.pleth !== undefined) parts.push(`SpO2 pleth ${e.pleth ? "on" : "off"}`);
      if (e.layout) parts.push(e.layout === "12lead" ? "12-lead view" : "single-lead view");
      return `Student display: ${parts.join(", ")}`;
    }
    case "undo":
      return `Undo #${e.target}`;
  }
}
