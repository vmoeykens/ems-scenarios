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
