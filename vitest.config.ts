import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      // UI / DOM-heavy modules are not covered by these unit tests.
      exclude: [
        "src/main.ts",
        "src/ui.ts",
        "src/rendering.ts",
        "src/buyOverlay.ts",
        "src/cardHand.ts",
        "src/scoreEffects.ts",
        "src/domRefs.ts",
        "src/logger.ts",
      ],
    },
  },
});
