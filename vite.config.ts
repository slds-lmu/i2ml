import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/lecture/",
  build: {
    emptyOutDir: true,
    outDir: "static/lecture",
    sourcemap: true,
    lib: {
      entry: "frontend/src/index.ts",
      formats: ["es"],
      fileName: () => "lecture-app.js"
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith(".css"))
            ? "lecture-app.css"
            : "assets/[name]-[hash][extname]"
      }
    }
  },
  test: {
    environment: "jsdom",
    include: ["frontend/tests/**/*.test.ts"],
    setupFiles: ["frontend/tests/setup.ts"]
  }
});
