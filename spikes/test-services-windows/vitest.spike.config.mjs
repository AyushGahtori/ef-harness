import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const spikesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  root: spikesRoot,
  test: {
    environment: "node",
    include: ["test-services-windows/tests/**/*.test.ts"],
  },
});
