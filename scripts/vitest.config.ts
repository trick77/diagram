import { defineConfig } from "vitest/config";

// The README's screenshots (screenshots.ts), apart from the gate's tests:
// npx vitest run --config scripts/vitest.config.ts
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["scripts/screenshots.ts"],
    testTimeout: 120_000,
  },
});
