import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "out/**", "release/**", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/renderer/src/**/*.ts", "src/shared/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/renderer/src/**/*.worker.ts",
        "src/renderer/src/env.d.ts",
      ],
      // Baseline measured at 46.22 / 38.05 / 38.36 / 48.66 (stmts / branch /
      // funcs / lines). Keep a small margin so normal churn does not fail CI
      // while still catching a real coverage drop.
      thresholds: {
        statements: 45,
        branches: 37,
        functions: 37,
        lines: 47,
      },
    },
  },
});
