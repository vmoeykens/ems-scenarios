import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLabels, clampOptions, labelFileName, layoutTag, PRESETS, wrap, zplEscape, DEFAULT_OPTIONS, type Dpi } from "../src/lib/labels/zpl.ts";
import { findPrinters, sendZpl } from "../src/lib/labels/browserPrint.ts";
import type { Scenario } from "../src/lib/scenario/types.ts";
import { stripMarkup } from "../src/lib/scenario/text.ts";
import { readJson, scenarioFiles } from "./helpers.ts";

const scenarios = scenarioFiles().map((f) => ({ name: basename(f), sc: readJson(f) as Scenario }));
const tag = { region: "R forehead", text: "2 cm **laceration**, oozing", cue: "INSTRUCTOR ONLY place at T+5" };

describe("ZPL structure", () => {
  it("one ^XA..^XZ block per tag with size in dots", () => {
    const job = buildLabels([tag, { region: "Chest", text: "Clear" }], { widthIn: 2, heightIn: 1, dpi: 203 });
    expect(job.zpl.match(/\^XA/g)).toHaveLength(2);
    expect(job.zpl.match(/\^XZ/g)).toHaveLength(2);
    expect(job.zpl).toContain("^PW406");
    expect(job.zpl).toContain("^LL203");
    expect(job.zpl).toContain("^CI28");
    expect(job.zpl).toContain("^PQ1");
  });

  it("scales with dpi and preset", () => {
    for (const p of PRESETS)
      for (const dpi of [203, 300, 600] as Dpi[]) {
        const z = buildLabels([tag], { widthIn: p.widthIn, heightIn: p.heightIn, dpi }).zpl;
        expect(z).toContain(`^PW${Math.round(p.widthIn * dpi)}`);
        expect(z).toContain(`^LL${Math.round(p.heightIn * dpi)}`);
      }
  });

  it("prints region uppercase + text without markup, never the cue", () => {
    const z = buildLabels([tag], DEFAULT_OPTIONS).zpl;
    expect(z).toContain("R FOREHEAD");
    expect(z).not.toContain("**");
    expect(z).toContain("laceration");
    expect(z).not.toMatch(/INSTRUCTOR|T\+5/);
  });

  it("options: region off, border, simulated off, copies", () => {
    const z = buildLabels([tag], { ...DEFAULT_OPTIONS, region: false, border: true, simulated: false, copies: 3 }).zpl;
    expect(z).not.toContain("R FOREHEAD");
    expect(z).not.toContain("SIMULATED");
    expect(z).toMatch(/\^FO0,0\^GB406,203,\d+\^FS/);
    expect(z).toContain("^PQ3");
  });

  it("escapes ZPL control characters", () => {
    expect(zplEscape("a^b~c_d")).toBe("a_5Eb_7Ec_5Fd");
    const z = buildLabels([{ region: "x", text: "BP ^ 90 ~ ok" }], DEFAULT_OPTIONS).zpl;
    const data = z.split("\n").filter((l) => l.includes("^FD"));
    for (const l of data) expect(l.slice(l.indexOf("^FD") + 3, -3)).not.toMatch(/[\^~]/);
  });

  it("clamps bad options", () => {
    const o = clampOptions({ widthIn: 99, heightIn: 0, dpi: 999 as Dpi, copies: -4 });
    expect(o.widthIn).toBe(4.25);
    expect(o.heightIn).toBe(0.75);
    expect(o.dpi).toBe(203);
    expect(o.copies).toBe(1);
  });

  it("file name", () => {
    expect(labelFileName("CARD-01", clampOptions({ widthIn: 4, heightIn: 3, dpi: 300 }))).toBe("CARD-01_moulage_4x3in_300dpi.zpl");
  });
});

describe("layout", () => {
  it("wraps words and hard-splits long ones", () => {
    expect(wrap("one two three", 7)).toEqual(["one two", "three"]);
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("all text stays inside the label", () => {
    for (const p of PRESETS) {
      const l = layoutTag({ region: "Back (lung sounds)", text: "Coarse crackles both bases, worse on the right, faint wheeze" }, { ...DEFAULT_OPTIONS, widthIn: p.widthIn, heightIn: p.heightIn });
      for (const t of l.texts) {
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.y + t.size).toBeLessThanOrEqual(l.h);
        if (!t.anchorEnd) expect(t.x + t.text.length * t.size * 0.56).toBeLessThanOrEqual(l.w + 1);
      }
    }
  });

  it("short text prints larger on the large label", () => {
    const s = layoutTag({ region: "Ankles", text: "No swelling" }, { ...DEFAULT_OPTIONS, widthIn: 2, heightIn: 1 });
    const L = layoutTag({ region: "Ankles", text: "No swelling" }, { ...DEFAULT_OPTIONS, widthIn: 4, heightIn: 3 });
    expect(L.texts.at(-1)!.size).toBeGreaterThan(s.texts.at(-1)!.size);
  });

  it("very long text on a tiny label is cut and flagged", () => {
    const job = buildLabels([{ region: "x", text: "word ".repeat(200) }], { ...DEFAULT_OPTIONS, widthIn: 1, heightIn: 0.75 });
    expect(job.overflow).toEqual([0]);
    expect(job.zpl).toContain("...");
  });
});

describe("bundled scenarios", () => {
  it.each(scenarios)("$name: every tag fits both presets at 203 dpi, cue never printed", ({ sc }) => {
    const tags = sc.moulage_tags ?? [];
    for (const p of PRESETS) {
      const job = buildLabels(tags, { ...DEFAULT_OPTIONS, widthIn: p.widthIn, heightIn: p.heightIn });
      expect(job.layouts).toHaveLength(tags.length);
      expect(job.overflow, `${p.id}: ${job.overflow.map((i) => tags[i].text).join(" | ")}`).toEqual([]);
      const printed = job.layouts.flatMap((l) => l.texts.map((t) => t.text)).join(" ").toLowerCase();
      for (const t of tags) {
        if (!t.cue) continue;
        const cue = stripMarkup(t.cue).toLowerCase();
        // a cue may coincidentally share a word with a finding; check the whole cue string
        expect(printed.includes(cue)).toBe(false);
      }
      expect(job.zpl.toLowerCase()).not.toContain("instructor");
    }
  });
});

describe("Zebra Browser Print client", () => {
  const ok = (body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });

  it("finds printers + default and posts ZPL as text/plain", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const dev = { name: "ZD421", uid: "ZD421-1", connection: "usb", deviceType: "printer" };
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/available")) return ok({ printer: [dev] });
      if (url.includes("/default")) return ok(dev);
      return ok("");
    }) as typeof fetch;
    const st = await findPrinters(f);
    expect(st.base).toBe("http://127.0.0.1:9100");
    expect(st.printers).toEqual([dev]);
    expect(st.defaultUid).toBe("ZD421-1");
    await sendZpl(st.base, dev, "^XA^XZ", f);
    const w = calls.at(-1)!;
    expect(w.url).toBe("http://127.0.0.1:9100/write");
    expect(w.init?.method).toBe("POST");
    expect((w.init?.headers as Record<string, string>)["Content-Type"]).toMatch(/^text\/plain/);
    expect(JSON.parse(String(w.init?.body))).toEqual({ device: dev, data: "^XA^XZ" });
  });

  it("falls back to the https port, then reports not found", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(findPrinters(f)).rejects.toThrow(/Browser Print not found/);
    expect(seen.some((u) => u.startsWith("https://127.0.0.1:9101"))).toBe(true);
  });
});
