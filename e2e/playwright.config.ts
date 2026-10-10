// End-to-end: the real webphone (production build, NOT demo mode) against the real API with an in-memory
// repository and a fake Twilio (apps/api/e2e/server.ts). Run from the repo root after
// `pnpm install && pnpm --filter @mimt/shared build`:
//
//   pnpm --filter @mimt/e2e e2e
//
// Browsers: uses the Chromium already installed under PLAYWRIGHT_BROWSERS_PATH (CI installs it with
// `playwright install --with-deps chromium`).
import { defineConfig, devices } from "@playwright/test";

const API_PORT = Number(process.env.E2E_API_PORT ?? 18181);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4176);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
// Separate output so the e2e build (pointed at a local API) can never be mistaken for apps/webphone/dist.
const WEB_DIST = "../../e2e/.webphone-dist";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: WEB_URL,
    locale: "fr-CA",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @mimt/api exec tsx e2e/server.ts",
      url: `${API_URL}/healthz`,
      cwd: "..",
      env: { MIMT_E2E: "1", NODE_ENV: "test", E2E_API_PORT: String(API_PORT), E2E_WEB_ORIGIN: WEB_URL },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `pnpm --filter @mimt/webphone exec vite build --outDir ${WEB_DIST} --emptyOutDir && pnpm --filter @mimt/webphone exec vite preview --outDir ${WEB_DIST} --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      cwd: "..",
      env: { VITE_API_URL: API_URL, VITE_MOCK_API: "0", VITE_TAKATAK_ISSUER: "", VITE_TAKATAK_CLIENT_ID: "" },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
