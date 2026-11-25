import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Moulage tags -> ZPL: size presets, preview, download, and sending through a (mocked) Zebra Browser Print agent.
test("print moulage tags as ZPL labels", async ({ page }) => {
  const writes: { device: { uid: string }; data: string }[] = [];
  const dev = { name: "ZD421", uid: "ZD421-1", connection: "usb", deviceType: "printer", provider: "com.zebra.ds.webdriver.desktop.provider.DefaultDeviceProvider", manufacturer: "Zebra Technologies" };
  await page.route("http://127.0.0.1:9100/**", async (route) => {
    const url = route.request().url();
    const headers = { "Access-Control-Allow-Origin": "*" };
    if (url.endsWith("/available")) return route.fulfill({ headers, contentType: "application/json", body: JSON.stringify({ printer: [dev] }) });
    if (url.includes("/default")) return route.fulfill({ headers, contentType: "application/json", body: JSON.stringify(dev) });
    if (url.endsWith("/write")) {
      writes.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({ headers, body: "" });
    }
    return route.fulfill({ status: 404, headers, body: "" });
  });

  await page.goto("./");
  await page.getByTestId("lib-TRA-04").getByRole("cell", { name: "TRA-04" }).click();
  await page.getByTestId("zpl-open").click();
  const modal = page.getByTestId("zpl-modal");
  await expect(modal).toBeVisible();

  // small preset: 2" x 1" at 203 dpi = 406 x 203 dots
  await page.getByTestId("zpl-size-small").click();
  await page.getByTestId("zpl-dpi-203").click();
  await expect(page.getByTestId("zpl-preview-0")).toHaveAttribute("viewBox", "0 0 406 203");

  // large preset
  await page.getByTestId("zpl-size-large").click();
  await expect(page.getByTestId("zpl-preview-0")).toHaveAttribute("viewBox", "0 0 812 609");

  // custom 3 x 2 at 300 dpi
  await page.getByTestId("zpl-size-custom").click();
  await page.getByTestId("zpl-widthIn").fill("3");
  await page.getByTestId("zpl-heightIn").fill("2");
  await page.getByTestId("zpl-dpi-300").click();
  await expect(page.getByTestId("zpl-preview-0")).toHaveAttribute("viewBox", "0 0 900 600");

  // untick the first tag, download
  await page.getByTestId("zpl-tag-0").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("zpl-download").click()]);
  expect(dl.suggestedFilename()).toBe("TRA-04_moulage_3x2in_300dpi.zpl");
  const zpl = readFileSync((await dl.path())!, "utf8");
  const sc = JSON.parse(readFileSync("scenarios/TRA-04_chest_wound_tension_ptx.json", "utf8"));
  expect(zpl.match(/\^XA/g)).toHaveLength(sc.moulage_tags.length - 1);
  expect(zpl).toContain("^PW900");
  for (const t of sc.moulage_tags) if (t.cue) expect(zpl).not.toContain(t.cue);

  // send through Browser Print
  await page.getByTestId("zpl-connect").click();
  await expect(page.getByTestId("zpl-printer")).toHaveValue("ZD421-1");
  await page.getByTestId("zpl-send").click();
  await expect(page.getByTestId("zpl-status")).toContainText("Sent");
  expect(writes).toHaveLength(1);
  expect(writes[0].device.uid).toBe("ZD421-1");
  expect(writes[0].data).toBe(zpl);

  // settings remembered
  await page.reload();
  await page.getByTestId("zpl-open").click();
  await expect(page.getByTestId("zpl-size-custom")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("zpl-dpi-300")).toHaveAttribute("aria-pressed", "true");
});
