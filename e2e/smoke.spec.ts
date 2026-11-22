import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("load scenario, start clock, reveal BP, push card, display updates, export", async ({ page, context }) => {
  await page.goto("./");
  await page.getByTestId("lib-CARD-01").click();
  await expect(page.getByText("Dispatch (read aloud)")).toBeVisible();
  await page.getByRole("link", { name: "Run", exact: true }).click();

  // student display window
  const [display] = await Promise.all([context.waitForEvent("page"), page.getByTestId("open-display").click()]);
  await display.waitForLoadState();
  await expect(display.getByTestId("monitor")).toBeVisible();
  await expect(display.getByTestId("num-BP")).toContainText("--");
  await expect(page.getByTestId("open-display")).toContainText("(on)");

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("clock-time")).not.toHaveText("T+00:00", { timeout: 5000 });

  await page.getByTestId("vital-A-BP").click();
  await expect(display.getByTestId("num-BP")).toContainText("112/74");
  await expect(display.getByTestId("num-HR")).toContainText("--"); // not revealed

  // SpO2 given -> pleth trace + cyan numeric; instructor switches the monitor to the live 12-lead and back
  await page.getByTestId("vital-A-SpO2").click();
  await expect(display.getByTestId("num-SpO2")).toContainText("95");
  await page.getByTestId("layout-12lead-btn").click();
  await expect(display.getByTestId("monitor")).toHaveAttribute("data-layout", "12lead");
  await expect(display.getByTestId("twelve-live").locator("[data-lead]")).toHaveCount(12);
  await display.getByTestId("layout-single").click(); // crew can switch locally
  await expect(display.getByTestId("monitor")).toHaveAttribute("data-layout", "single");

  // push the lung-sounds text card -> display switches to INFO and shows it
  await page.getByTestId("show-card-3").click();
  await expect(display.getByTestId("display")).toHaveAttribute("data-view", "info");
  await expect(display.getByTestId("card-face-c3")).toContainText("LUNG SOUNDS");
  await expect(display.getByTestId("crew-dispatch")).toContainText("Maple Ridge");
  // instructor-only cue never on the display
  await expect(display.locator("body")).not.toContainText("INSTRUCTOR");

  // crew branch with goto_stage switches the stage
  await page.getByTestId("phase-p3").getByRole("button").first().click(); // make 8-12 Treatment decision current
  await page.getByTestId("branch-p3.b0").click();
  await expect(page.getByTestId("current-stage")).toContainText("C Hypo");

  await page.getByRole("link", { name: "Debrief" }).click();
  await expect(page.getByTestId("event-log")).toContainText("BP 112/74");
  await page.locator("#trainee").fill("Smoke Test");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
  const rec = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  expect(rec.format).toBe("scenario-runner-run");
  expect(rec.trainee).toBe("Smoke Test");
  expect(rec.scenarioHash).toMatch(/^[0-9a-f]{64}$/);
  expect(rec.events.some((e: { kind: string; vital?: string }) => e.kind === "reveal" && e.vital === "BP")).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("scenario-runner:active-run"))).toBeNull(); // cleared on export
});

test("autosave offers resume after reload", async ({ page }) => {
  await page.goto("./#/s/MED-02_anaphylaxis/run");
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByTestId("vital-A-HR").click();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Resume run in progress?" })).toBeVisible();
  await page.getByRole("button", { name: "Resume run" }).click();
  await expect(page.getByTestId("vital-A-HR")).toHaveAttribute("aria-pressed", "true");
});

test("protocol links: official PDF when no local copy; drawer with the local copy", async ({ page }) => {
  // no local PDF in this build -> link goes to the official PDF in a new tab
  await page.goto("./#/s/CARD-01_inferior_stemi/prebrief");
  const link = page.locator('a.proto-link[data-protocol="3.0A"]').first();
  await expect(link).toHaveAttribute("href", /healthvermont\.gov\/.*eprip-2025-EMS-Protocols_0\.pdf$/);
  await expect(link).toHaveAttribute("target", "_blank");
  // doses / temps never link
  await expect(page.locator("a.proto-link", { hasText: "98.2" })).toHaveCount(0);

  // serve a small fixture PDF as the local copy -> link opens the in-app drawer at the protocol's page
  const fixture = path.join(import.meta.dirname, "fixtures", "protocols-sample.pdf");
  await page.route("**/protocols/vt-ems-protocols-2025.pdf", (r) => r.fulfill({ path: fixture, contentType: "application/pdf" }));
  await page.reload();
  const local = page.locator('a.proto-link[data-protocol="3.0A"]').first();
  await expect(local).toHaveAttribute("href", /^protocols\/vt-ems-protocols-2025\.pdf#page=/);
  await local.click();
  const drawer = page.getByTestId("protocol-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("3.0A Acute Coronary Syndrome");
  await expect(page.getByTestId("protocol-page")).toHaveText("p. 3 / 6"); // located by text search (index page is null)
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("protocol-page")).toHaveText("p. 4 / 6");
  await page.getByRole("button", { name: "Close protocol" }).click();
  await expect(drawer).toHaveCount(0);
});

test("student display never shows protocol links", async ({ page, context }) => {
  await page.goto("./#/s/MED-02_anaphylaxis/run");
  const [display] = await Promise.all([context.waitForEvent("page"), page.getByTestId("open-display").click()]);
  await page.getByTestId("show-card-0").click();
  await expect(display.getByTestId("info")).toBeVisible();
  await expect(display.locator("a")).toHaveCount(0);
});

test("provider actions: log O2 NRB 15 L/min twice -> two timestamped entries + linked expected item ticked", async ({ page }) => {
  await page.goto("./#/s/TRA-03_anticoagulated_fall_tbi/run");
  await page.getByRole("button", { name: "Start" }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("action-oxygen").first().click();
    const picker = page.getByTestId("action-picker");
    await picker.getByRole("button", { name: "NRB", exact: true }).click();
    await picker.getByRole("button", { name: "15", exact: true }).click();
    await page.getByTestId("action-log").click();
    await expect(picker).toHaveCount(0);
  }
  const log = page.getByTestId("action-log-table");
  await expect(log.locator("tbody tr")).toHaveCount(2);
  await expect(log.locator("tbody tr").first()).toContainText("NRB, 15 L/min");
  await expect(log.locator("tbody tr").first()).toContainText(/T\+\d\d:\d\d/);
  await expect(page.getByTestId("action-count-oxygen").first()).toContainText("x2");
  // linked expected item "O2 NRB; BVM if RR inadequate at 10/min" (phase 3) is ticked even though it is not the current phase
  await page.getByRole("button", { name: "expand all", exact: false }).click();
  await expect(page.getByTestId("exp-p3.e1")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("exp-p3.e1")).toContainText("logged:");
  // tapping a linked expected item opens the picker pre-filled; Skip just checks it
  await page.getByTestId("exp-p0.e1").click();
  await expect(page.getByTestId("action-picker")).toContainText("Crew roles assigned");
  await page.getByTestId("action-skip").click();
  await expect(page.getByTestId("exp-p0.e1")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Debrief" }).click();
  await expect(page.getByTestId("debrief-actions").locator("tbody tr")).toHaveCount(2);
});

test("paste JSON: live validation, copy errors, import & open", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const raw = readFileSync(path.join(import.meta.dirname, "..", "scenarios", "MED-01_hypoglycemia_refusal.json"), "utf8");
  await page.goto("./");
  const box = page.getByTestId("paste-json");
  const status = page.getByTestId("paste-status");

  // syntax error -> line/column, import disabled
  await box.fill('{\n  "id": "MED-09",\n  "title": "x",\n}');
  await expect(status).toHaveAttribute("data-state", "json-error");
  await expect(status).toContainText(/line \d+, column \d+/);
  await expect(page.getByTestId("paste-open")).toBeDisabled();

  // structurally wrong -> numbered problems, copy for the AI
  const bad = JSON.parse(raw);
  bad.scene.safety = "Scene safe";
  await box.fill(JSON.stringify(bad, null, 2));
  await expect(status).toHaveAttribute("data-state", "invalid");
  await expect(page.getByTestId("paste-errors")).toContainText("safety");
  await page.getByTestId("paste-copy-errors").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Fix these validation errors[\s\S]*safety/);

  // a whole chat reply with prose + fences -> valid, opens in the console
  const ours = JSON.parse(raw);
  ours.id = "MED-99";
  ours.title = "Pasted test scenario";
  ours.review_notes = ["VERIFY: pasted coordinator note"]; // optional, coordinator-only
  await box.fill(`Here is your scenario:\n\`\`\`json\n${JSON.stringify(ours, null, 2)}\n\`\`\`\nAnything else?`);
  await expect(status).toHaveAttribute("data-state", "valid");
  await expect(page.getByTestId("paste-valid")).toContainText("MED-99 Pasted test scenario");
  await expect(status).toContainText("Text around the JSON was ignored");
  await expect(page.getByTestId("paste-review-notes")).toContainText("VERIFY: pasted coordinator note");
  await page.getByTestId("paste-open").click();
  await expect(page.getByText("Dispatch (read aloud)")).toBeVisible();
  await expect(page.locator("#review-notes")).toContainText("Review notes (not printed)");
  await expect(page.locator("#review-notes")).toContainText("VERIFY: pasted coordinator note");
  await page.evaluate(() => (location.hash = "#/")); // in-app navigation (a reload clears session imports by design)
  await expect(page.getByTestId("lib-MED-99")).toContainText("imported");
});
