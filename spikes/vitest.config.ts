import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "test-services-windows/tests/**/*.test.ts"],
    exclude: ["execution-capacity/template-app/**", "**/node_modules/**", "**/dist/**"],
  },
});
