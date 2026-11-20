import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

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
