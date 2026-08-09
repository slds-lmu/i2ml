import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "production" && mode !== "debug") {
  throw new Error("integration server mode must be production or debug");
}

const debug = mode === "debug";
const port = debug ? 8002 : 8001;
const websiteRoot = "/workspace/i2ml";
const backendRoot = "/workspace/i2ml-qa-backend";
const testResultsRoot = resolve(websiteRoot, "test-results");
const staticRoot = resolve(testResultsRoot, `${mode}-static`);
const stagedPdfRoot = resolve(backendRoot, "build", "static", "course-assets");

if (!staticRoot.startsWith(`${testResultsRoot}/`)) {
  throw new Error("refusing to prepare integration static files outside test-results");
}
await rm(staticRoot, { recursive: true, force: true });
await mkdir(staticRoot, { recursive: true });
execFileSync("node", ["scripts/sync-course-bindings.mjs"], {
  cwd: websiteRoot,
  stdio: "inherit"
});
const hugoEnvironment = { ...process.env };
delete hugoEnvironment.HUGO_PARAMS_QADEBUG;
if (debug) hugoEnvironment.HUGO_PARAMS_QADEBUG = "true";
execFileSync(
  "/workspace/tools/hugo/0.145.0/hugo",
  ["--baseURL", "/", "--destination", staticRoot],
  {
    cwd: websiteRoot,
    env: hugoEnvironment,
    stdio: "inherit"
  }
);
await cp(stagedPdfRoot, resolve(staticRoot, "course-assets"), { recursive: true });

const child = spawn(
  "/usr/bin/uv",
  [
    "run",
    "uvicorn",
    "i2ml_qa.app:create_app",
    "--factory",
    "--host",
    "127.0.0.1",
    "--port",
    String(port)
  ],
  {
    cwd: backendRoot,
    env: {
      ...process.env,
      PYTHONPATH: resolve(backendRoot, "src"),
      I2ML_ENVIRONMENT: "test",
      I2ML_QA_DEBUG: debug ? "true" : "false",
      I2ML_CONTENT_MANIFEST: resolve(
        backendRoot,
        "build/content/manifests/corpus-app-release.json"
      ),
      I2ML_STATIC_ROOT: staticRoot,
      I2ML_PROVIDER_BASE_URL: "http://127.0.0.1:8999",
      DEEPSEEK_API_KEY: "browser-integration-test-only"
    },
    stdio: "inherit"
  }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
child.on("error", (error) => {
  throw error;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
