// Remote student display: console and display in separate browser contexts (two devices), joined through
// the real supabase-js client talking to a fake Realtime server.
import { expect, test } from "@playwright/test";
import { FakeRealtime } from "./fakeRealtime.ts";

test("pair another device by link, stream vitals and cards, no instructor text relayed", async ({ browser }) => {
  const rt = new FakeRealtime();
  const consoleCtx = await browser.newContext();
  const deviceCtx = await browser.newContext();
  await rt.attach(consoleCtx);
  await rt.attach(deviceCtx);
  const page = await consoleCtx.newPage();

  await page.goto("./#/s/CARD-01_inferior_stemi/run");
  await page.getByTestId("open-remote").click();
  // no build default in the e2e build: enter the broker in the app
  await page.getByTestId("broker-url").fill("https://fake-project.supabase.co/");
  await page.getByTestId("broker-key").fill("sb_publishable_e2e");
  await page.getByTestId("broker-save").click();
  await page.getByTestId("remote-start").click();
  await expect(page.getByTestId("remote-status")).toHaveAttribute("data-status", "connected");
  const room = (await page.getByTestId("remote-room").textContent())!.trim();
  expect(room).toMatch(/^\d{6}$/);
  const link = await page.getByTestId("remote-link").inputValue();
  expect(link).toContain(`#/display/${room}?b=`);

  // second device opens the link (it has no saved broker; the link carries it)
  const display = await deviceCtx.newPage();
  await display.goto(link);
  await expect(display.getByTestId("display-link")).toHaveAttribute("data-status", "connected");
  await expect(display.getByTestId("monitor")).toBeVisible();
  await expect(page.getByTestId("remote-status")).toContainText("Displays linked: 1");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("open-remote")).toContainText("(1)");
  await expect(page.getByTestId("open-display")).toContainText("(on)");

  await page.getByTestId("vital-A-BP").click();
  await expect(display.getByTestId("num-BP")).toContainText("112/74");
  await expect(display.getByTestId("num-HR")).toContainText("--");
  await page.getByTestId("show-card-3").click();
  await expect(display.getByTestId("display")).toHaveAttribute("data-view", "info");
  await expect(display.getByTestId("card-face-c3")).toContainText("LUNG SOUNDS");

  // a display that reloads re-joins and gets the current state back
  await display.reload();
  await expect(display.getByTestId("display-link")).toHaveAttribute("data-status", "connected");
  await display.getByTestId("dtab-monitor").click();
  await expect(display.getByTestId("num-BP")).toContainText("112/74");

  // the console keeps its room across a reload
  await page.reload();
  await page.getByRole("button", { name: "Resume run" }).click();
  await page.getByTestId("open-remote").click();
  await expect(page.getByTestId("remote-room")).toHaveText(room);

  // only display snapshots / control messages crossed the broker, all on this room's channel
  expect(rt.relayed.length).toBeGreaterThan(3);
  for (const r of rt.relayed) {
    expect(r.topic).toBe(`realtime:scenario-runner:${room}`);
    const text = JSON.stringify(r.payload);
    expect(text).not.toContain('"cue"');
    expect(text).not.toContain("INSTRUCTOR");
  }

  await page.getByTestId("remote-stop").click();
  await expect(page.getByTestId("remote-start")).toBeVisible();
  await consoleCtx.close();
  await deviceCtx.close();
});

test("join by typed code on a device with the broker saved", async ({ browser }) => {
  const rt = new FakeRealtime();
  const consoleCtx = await browser.newContext();
  const deviceCtx = await browser.newContext();
  await rt.attach(consoleCtx);
  await rt.attach(deviceCtx);
  const cfg = JSON.stringify({ kind: "supabase", url: "https://fake-project.supabase.co", key: "sb_publishable_e2e" });
  for (const c of [consoleCtx, deviceCtx]) await c.addInitScript((v) => localStorage.setItem("scenario-runner:sync-config", v), cfg);

  const page = await consoleCtx.newPage();
  await page.goto("./#/s/MED-02_anaphylaxis/run");
  await page.getByTestId("open-remote").click();
  await page.getByTestId("remote-start").click();
  const room = (await page.getByTestId("remote-room").textContent())!.trim();

  const display = await deviceCtx.newPage();
  await display.goto("./#/join");
  await display.getByTestId("join-code").fill(room);
  await display.getByTestId("join-go").click();
  await expect(display.getByTestId("display-link")).toHaveAttribute("data-status", "connected");
  await expect(page.getByTestId("remote-status")).toContainText("Displays linked: 1");
  await consoleCtx.close();
  await deviceCtx.close();
});
