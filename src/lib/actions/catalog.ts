// Shared provider-action catalog (schema/actions.json, validated by schema/actions.schema.json).
// Same file drives the Run tab's PROVIDER ACTIONS panel and the PDF's PROVIDER ACTIONS page.
import raw from "../../../schema/actions.json" with { type: "json" };

export type FieldKind = "select" | "multi" | "number" | "text";
export type ActionField =
  | { id: string; label: string; kind: "select" | "multi"; options: string[] }
  | { id: string; label: string; kind: "number"; unit: string; presets?: number[]; min?: number; max?: number; step?: number }
  | { id: string; label: string; kind: "text" };

export interface ActionDef {
  id: string;
  group: string;
  label: string;
  short?: string;
  protocols?: string[];
  common?: boolean;
  note?: string;
  fields: ActionField[];
}
export interface ActionGroup {
  id: string;
  title: string;
}
export interface ActionCatalog {
  version: 1;
  description?: string;
  groups: ActionGroup[];
  actions: ActionDef[];
}

/** Values recorded for one logged action: select/text -> string, multi -> string[], number -> number. All optional. */
export type ActionValues = Record<string, string | string[] | number>;

export const CATALOG = raw as unknown as ActionCatalog;
const byId = new Map(CATALOG.actions.map((a) => [a.id, a]));
export const actionById = (id: string): ActionDef | undefined => byId.get(id);

/** "NRB, 15 L/min" - values in field order, units appended, empty fields skipped. */
export function formatValues(action: ActionDef | undefined, values: ActionValues | undefined): string {
  if (!values) return "";
  const fields = action?.fields ?? Object.keys(values).map((id) => ({ id, label: id, kind: "text" }) as ActionField);
  const parts: string[] = [];
  for (const f of fields) {
    const v = values[f.id];
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (Array.isArray(v)) parts.push(v.join(" + "));
    else if (f.kind === "number") parts.push(f.unit ? `${v} ${f.unit}` : `${f.label} ${v}`);
    else if (f.kind === "text") parts.push(`${f.label}: ${v}`);
    else if (v === "Yes" || v === "No") parts.push(`${f.label}: ${v}`);
    else parts.push(String(v));
  }
  return parts.join(", ");
}

/** Does a logged action satisfy an expected item's link (same id; every `match` field equal / contained)? */
export function matchesLink(link: { action: string; match?: Record<string, string | number> }, actionId: string, values: ActionValues): boolean {
  if (link.action !== actionId) return false;
  for (const [k, want] of Object.entries(link.match ?? {})) {
    const got = values[k];
    if (Array.isArray(got) ? !got.includes(String(want)) : String(got ?? "") !== String(want)) return false;
  }
  return true;
}

/** Structural checks of expected-item links against the catalog (field exists, select value is an option). */
export function linkErrors(sc: unknown): string[] {
  const errs: string[] = [];
  const flow = (sc as { flow?: { expected?: unknown[] }[] })?.flow;
  if (!Array.isArray(flow)) return errs;
  flow.forEach((ph, i) =>
    (ph?.expected ?? []).forEach((it, j) => {
      if (typeof it !== "object" || it === null) return;
      const { action, match } = it as { action?: string; match?: Record<string, unknown> };
      const a = action ? actionById(action) : undefined;
      if (!a || !match) return;
      for (const [k, v] of Object.entries(match)) {
        const f = a.fields.find((x) => x.id === k);
        const where = `/flow/${i}/expected/${j}/match/${k}`;
        if (!f) errs.push(`${where}: action '${action}' has no field '${k}'`);
        else if ((f.kind === "select" || f.kind === "multi") && !f.options.includes(String(v))) errs.push(`${where}: '${v}' is not an option of ${action}.${k}`);
      }
    }),
  );
  return errs;
}

/** Actions relevant to a scenario: those linked from flow[].expected[] (flow order) + scenario.provider_actions. */
export function relevantActions(sc: { flow?: { expected: unknown[] }[]; provider_actions?: string[] }): string[] {
  const ids: string[] = [];
  for (const ph of sc.flow ?? [])
    for (const it of ph.expected) if (typeof it === "object" && it && (it as { action?: string }).action) ids.push((it as { action: string }).action);
  ids.push(...(sc.provider_actions ?? []));
  return [...new Set(ids)].filter((id) => byId.has(id));
}
