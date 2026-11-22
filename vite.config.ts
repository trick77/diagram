import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Consumers import the TS sources (package.json exports); nothing is
// published from dist. The library build is the bundling check: every
// subpath resolves, its lazy chunks split, and no peer is pulled in.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        mermaid: "src/mermaid/index.ts",
        check: "src/check/index.ts",
        react: "src/react/index.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        /^react($|\/)/,
        /^react-dom($|\/)/,
        /^mermaid($|\/)/,
        /^elkjs($|\/)/,
      ],
    },
  },
  test: {
    environment: "jsdom",
    // Globals let Testing Library register its own cleanup after each test.
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      // lcov feeds ship's UI floor and patch gate; text-summary is for humans
      // reading the log.
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage/ui",
      // Every source counts, tested or not: v8 otherwise sees only what a
      // test imports.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/test/**"],
    },
  },
});
