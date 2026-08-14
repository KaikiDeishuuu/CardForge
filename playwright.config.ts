import { defineConfig, devices } from "@playwright/test";

const localChrome = process.env.CI ? {} : { channel: "chrome" as const };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...localChrome,
  },
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
        ...localChrome,
      },
    },
    {
      name: "laptop",
      use: {
        viewport: { width: 1366, height: 768 },
        ...localChrome,
      },
    },
    {
      name: "desktop",
      use: {
        viewport: { width: 1440, height: 1000 },
        ...localChrome,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
