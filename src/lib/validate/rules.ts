// Content rules JSON Schema can't express. Line-for-line mirror of validate() in tools/ems_scenario.py:
// same checks, same order, same message text (Python str()/repr() formatting reproduced), so
// tests/validator.test.ts can compare the two validators' output exactly on the bad fixtures.
// If you change one, change the other.
import { learnPrompt, LEARN_PROMPT_MAX, pyLen } from "../scenario/learn.ts";
import catalog from "../../../schema/actions.json" with { type: "json" };

/** Provider-action ids (schema/actions.json); mirrors ACTION_IDS in the generator. */
export const ACTION_IDS = new Set((catalog as { actions: { id: string }[] }).actions.map((a) => a.id));

export const RHYTHMS = new Set(["sinus", "afib", "svt", "vt", "vf", "asystole", "chb", "avb1", "flutter"]);
export const SHOW_CARD_TYPES = ["12lead", "strip", "capno", "text", "image"];
export const BRANCH_KEYS = new Set(["if", "then", "type", "goto_stage", "goto_phase", "id"]);

/** Card/tag faces must not carry instructor hints (Python LEAK regex, re.I). */
export const LEAK =
  /\b(if |show when|after |overbag|over-bag|rosc|pea\b|no pulse|stage |normal wave|square|shark|instructor|recheck|use vitals|t\+\d|good |during |analysis)/i;
const NOT_A_CONDITION = /^\s*(stage\b|advanced option)/i;
const STAGE_REF = /Stage \*\*([A-Z])\*\*|Stage ([A-Z])\b/g;
const CRIT_FAIL = /critical fail|miss = fail/i;

// ---- Python formatting helpers ------------------------------------------------------------
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Python str(x) for JSON values. */
export function pyStr(x: unknown): string {
  if (x === null || x === undefined) return "None";
  if (x === true) return "True";
  if (x === false) return "False";
  if (Array.isArray(x)) return `[${x.map(pyRepr).join(", ")}]`;
  if (typeof x === "object") return `{${Object.entries(x).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(", ")}}`;
  return String(x);
}

/** Python repr(x) for JSON values. */
export function pyRepr(x: unknown): string {
  if (typeof x !== "string") return pyStr(x);
  const q = x.includes("'") && !x.includes('"') ? '"' : "'";
  let out = "";
  for (const ch of x) {
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += "\\" + q;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return q + out + q;
}

const pySet = (xs: string[]) => `{${[...xs].sort().map(pyRepr).join(", ")}}`; // Python set order is unspecified; sorted here
const isObj = (x: unknown): x is Record<string, Any> => typeof x === "object" && x !== null && !Array.isArray(x);
const arr = (x: unknown): Any[] => (Array.isArray(x) ? x : []);
const get = (o: unknown, k: string, d?: unknown): Any => (isObj(o) && k in o ? o[k] : d);

// ---- validate() --------------------------------------------------------------------------
export function validateRules(sc: Any): string[] {
  const errs: string[] = [];
  const vitals = arr(get(sc, "vitals", []));
  const letters = vitals.map((v) => String(get(v, "key") || String(get(v, "stage", "?")).slice(0, 1)).toUpperCase());
  if (new Set(letters).size !== letters.length) errs.push(`duplicate vitals stage letters: ${pyStr(letters)}`);
  const flow = arr(get(sc, "flow", []));
  const flowIds = flow.map((f, i) => String(get(f, "id") || `p${i}`));
  if (new Set(flowIds).size !== flowIds.length) errs.push(`duplicate flow ids: ${pyStr(flowIds)}`);
  for (const i of arr(get(sc, "critical", []))) {
    if (isObj(i) && !i.text) errs.push("critical item object needs text");
  }
  for (const f of flow) {
    const pfx = `flow '${pyStr(get(f, "phase"))}'`;
    const expected = get(f, "expected");
    if (!expected || (Array.isArray(expected) && expected.length === 0)) errs.push(`${pfx}: no expected actions`);
    for (const i of arr(expected)) {
      if (isObj(i) && !i.text) errs.push(`${pfx}: expected item object needs text`);
      if (isObj(i) && i.action && !ACTION_IDS.has(i.action)) errs.push(`${pfx}: unknown action ${pyRepr(i.action)}`);
    }
    for (const b of arr(get(f, "branches", []))) {
      if (!isObj(b)) continue;
      const extra = Object.keys(b).filter((k) => !BRANCH_KEYS.has(k));
      if (extra.length) errs.push(`${pfx}: unknown branch keys ${pySet(extra)}`);
      const type = get(b, "type", null);
      if (type !== null && type !== "inject") errs.push(`${pfx}: branch type must be omitted or 'inject'`);
      if (!b.if || !b.then) {
        errs.push(`${pfx}: branch missing if/then`);
        continue;
      }
      const ifText = String(b.if);
      const thenText = String(b.then);
      if (NOT_A_CONDITION.test(ifText))
        errs.push(`${pfx}: IF '${ifText}' is not a condition (use type:inject for examiner choices)`);
      if (pyLen(ifText) > 75) errs.push(`${pfx}: IF text > 75 chars`);
      const refs: string[] = [];
      for (const m of thenText.matchAll(STAGE_REF)) {
        const L = m[1] || m[2];
        refs.push(L);
        if (!letters.includes(L)) errs.push(`${pfx}: references Stage ${L} but vitals has ${pyStr(letters)}`);
      }
      if ("goto_stage" in b) {
        const g = b.goto_stage;
        if (!letters.includes(g)) errs.push(`${pfx}: goto_stage ${pyStr(g)} is not a vitals stage ${pyStr(letters)}`);
        else if (refs.length && !refs.includes(g))
          errs.push(`${pfx}: goto_stage ${pyStr(g)} disagrees with THEN text Stage ${pyStr(refs)}`);
      }
      if ("goto_phase" in b && !flowIds.includes(b.goto_phase))
        errs.push(`${pfx}: goto_phase ${pyStr(b.goto_phase)} is not a flow id ${pyStr(flowIds)}`);
      if (CRIT_FAIL.test(thenText)) errs.push(`${pfx}: use 'critical (evaluator discretion)'`);
    }
  }
  for (const a of arr(get(sc, "provider_actions", []))) {
    if (!ACTION_IDS.has(a)) errs.push(`provider_actions: unknown action ${pyRepr(a)}`);
  }
  for (const c of arr(get(sc, "show_cards", []))) {
    const face = ["title", "caption", "body"].map((k) => pyStr(get(c, k, ""))).join(" ");
    const m = LEAK.exec(face);
    if (m) errs.push(`show card '${pyStr(get(c, "title"))}': instructor hint on card face (${pyRepr(m[0])}) - move to 'cue'`);
    const type = get(c, "type");
    if (!SHOW_CARD_TYPES.includes(type)) errs.push(`show card type ${pyStr(type)}`);
    if ((type === "12lead" || type === "strip") && !RHYTHMS.has(get(c, "rhythm", "sinus")))
      errs.push(`bad rhythm ${pyStr(get(c, "rhythm"))}`);
  }
  if (isObj(get(sc, "scene", {})) && "safety" in get(sc, "scene", {}))
    errs.push("scene.safety present - scene safety is trained outside scenarios; remove it");
  for (const t of arr(get(sc, "moulage_tags", []))) {
    if (!get(t, "region") || !get(t, "text")) errs.push("moulage tag needs region + text");
    else {
      const m = LEAK.exec(String(t.text));
      if (m) errs.push(`moulage tag '${pyStr(t.region)}': instructor hint on tag (${pyRepr(m[0])}) - move to 'cue'`);
    }
  }
  const n = pyLen(learnPrompt(isObj(sc) ? sc : ({} as Any)));
  if (n > LEARN_PROMPT_MAX) errs.push(`learn_more prompt ${n} chars > 480 (QR too dense to scan) - shorten focus`);
  return errs;
}
