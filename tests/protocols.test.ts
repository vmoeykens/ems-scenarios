import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { linkifyProtocols, parseProtocolNumbers, PROTOCOL_INDEX, protocolRefs } from "../src/lib/protocols/refs.ts";
import { locatePage, pageMatches } from "../src/lib/protocols/locate.ts";
import { SCENARIO_DIR } from "./helpers.ts";

const refs = (s: string) => protocolRefs(s);

describe("parseProtocolNumbers", () => {
  it("parses numbers, suffixes, appendix and A/P pairs", () => {
    expect(parseProtocolNumbers("3.0A Acute Coronary Syndrome").map((r) => r.numbers)).toEqual([["3.0A"]]);
    expect(parseProtocolNumbers("per 2.24A, then (4.9) and 8.15.").map((r) => r.numbers)).toEqual([["2.24A"], ["4.9"], ["8.15"]]);
    expect(parseProtocolNumbers("seizure 2.22A/P").map((r) => r.numbers)).toEqual([["2.22A", "2.22P"]]);
    expect(parseProtocolNumbers("see A.1 algorithms").map((r) => r.numbers)).toEqual([["A.1"]]);
  });
  it("rejects doses, volumes, temps, versions, times, decimals in longer numbers", () => {
    for (const s of ["Epi 0.3 mg IM", "0.1 mg/mL", "~1.5 L on ground", "NTG 0.8 mg SL", "v1.1 | VT", "T+8.5", "1.5.2", "2.5 mm ST", "4.9%", "3.2 kg"])
      expect(parseProtocolNumbers(s), s).toEqual([]);
  });
});

describe("linkifyProtocols", () => {
  it("links only numbers in the index", () => {
    expect(linkifyProtocols("NS bolus per 2.24A, lungs reassessed")).toEqual([
      { text: "NS bolus per " },
      { text: "2.24A", ref: "2.24A" },
      { text: ", lungs reassessed" },
    ]);
    expect(refs("Naloxone 0.4-2 mg IV")).toEqual([]); // 0.4 is not a protocol
    expect(refs("7.9 and 2.99 and 12.1")).toEqual([]); // look like protocols, not in the index
    expect(refs("Temp 95.8, 98.2, BP 112/74 at 07:14")).toEqual([]);
  });
  it("splits A/P pairs into two links", () => {
    expect(linkifyProtocols("(2.22A/P)")).toEqual([
      { text: "(" },
      { text: "2.22A", ref: "2.22A" },
      { text: "/" },
      { text: "P", ref: "2.22P" },
      { text: ")" },
    ]);
  });
  it("keeps the text intact", () => {
    const s = "Switch to 3.2A: AED, CPR (3.6); 4.9 risk factor; epi 0.3 mg";
    expect(linkifyProtocols(s).map((x) => x.text).join("")).toBe(s);
    expect(refs(s)).toEqual(["3.2A", "3.6", "4.9"]);
  });
  it("real scenarios: every protocols[] entry links to its own number; no dose/temp/version ever links", () => {
    for (const f of readdirSync(SCENARIO_DIR).filter((x) => x.endsWith(".json"))) {
      const sc = JSON.parse(readFileSync(join(SCENARIO_DIR, f), "utf8"));
      for (const p of sc.protocols ?? []) expect(refs(p)[0], `${f}: ${p}`).toBe(p.split(" ")[0]);
      const all: string[] = [];
      const walk = (x: unknown) => (typeof x === "string" ? all.push(x) : x && typeof x === "object" && Object.values(x).forEach(walk));
      walk(sc);
      for (const s of all)
        for (const seg of linkifyProtocols(s))
          if (seg.ref) {
            expect(PROTOCOL_INDEX[seg.ref], seg.ref).toBeDefined();
            expect(seg.text).toMatch(/^(\d{1,2}\.\d{1,2}[AP]?|[AP]|A\.\d)$/);
          }
      expect(refs(sc.version ?? "")).toEqual([]);
    }
  });
});

describe("protocol index", () => {
  it("seeded from the reference TOC: titles for every section, pages filled only by the build script", () => {
    expect(Object.keys(PROTOCOL_INDEX).length).toBeGreaterThan(120);
    expect(PROTOCOL_INDEX["3.0A"].title).toMatch(/^Acute Coronary Syndrome/);
    expect(PROTOCOL_INDEX["5.4"].title).toMatch(/CPAP/);
    expect(PROTOCOL_INDEX["A.8"].title).toBe("BEFAST");
    for (const e of Object.values(PROTOCOL_INDEX)) expect(e.page === null || Number.isInteger(e.page)).toBe(true);
  });
});

describe("locate protocol pages", () => {
  const pages = [
    "Vermont Statewide EMS Protocols 2025 - Table of Contents\n3.0A Acute Coronary Syndrome - Adult\n2.24A Shock - Adult\n2.24P Shock - Pediatric",
    "Preface ...",
    "Acute Coronary Syndrome\nAdult\n2013\n3.0\nAEMT ...",
    "Shock\nAdult\n2.24\n...",
    "Shock\nPediatric\n2.24\n...",
  ];
  it("skips the TOC; matches title + Adult/Pediatric + base number token", () => {
    expect(locatePage("3.0A", "Acute Coronary Syndrome – Adult", pages)).toBe(3);
    expect(locatePage("2.24A", "Shock – Adult", pages)).toBe(4);
    expect(locatePage("2.24P", "Shock – Pediatric", pages)).toBe(5);
    expect(locatePage("4.9", "Trauma Triage and Transport Decision", pages)).toBeNull();
    expect(pageMatches("3.0A", "Acute Coronary Syndrome – Adult", "acute coronary syndrome adult 13.0")).toBe(false);
  });
});
