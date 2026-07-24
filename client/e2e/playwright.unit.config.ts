import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "auth-quality.spec.ts",
  fullyParallel: false,
  use: { trace: "off" },
});

