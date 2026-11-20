// Playwright smoke test (npm run e2e). Not part of CI; needs a Chromium/Chrome.
// Uses $CHROME_PATH or /usr/bin/google-chrome when present, else Playwright's own browser (npx playwright install chromium).
import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chrome = process.env.CHROME_PATH ?? (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4174/",
    viewport: { width: 1180, height: 820 },
    launchOptions: chrome ? { executablePath: chrome, args: ["--no-sandbox"] } : {},
  },
  webServer: { command: "npm run build && npx vite preview --port 4174 --strictPort", url: "http://localhost:4174/", reuseExistingServer: false, timeout: 120_000 },
});
