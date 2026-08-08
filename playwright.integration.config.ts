import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "frontend/integration",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:8001",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "node frontend/integration/mock-deepseek.mjs",
      cwd: "/workspace/i2ml",
      port: 8999,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: "node frontend/integration/run-staged-server.mjs production",
      cwd: "/workspace/i2ml",
      port: 8001,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: "node frontend/integration/run-staged-server.mjs debug",
      cwd: "/workspace/i2ml",
      port: 8002,
      reuseExistingServer: false,
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: "combined-demo-chromium",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } }
    }
  ]
});
