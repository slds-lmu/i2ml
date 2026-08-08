import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "frontend/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npx vite preview --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: false
  },
  projects: [
    { name: "chromium-desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    { name: "chromium-mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } }
  ]
});

