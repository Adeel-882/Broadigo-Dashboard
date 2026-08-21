import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Skills/ and .codex-sheet-audit/ are vendored reference material, not project source.
  test: {
    environment: "node", pool: "forks", maxWorkers: 1,
    exclude: ["**/node_modules/**", "**/dist/**", ".next/**", "Skills/**", ".codex-sheet-audit/**"],
  },
});
