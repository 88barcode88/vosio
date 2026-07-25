import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url))
    }
  },
  test: {
    coverage: {
      exclude: [
        "src/**/*.d.ts",
        "src/components/**/*.tsx",
        "src/lib/supabase/**"
      ],
      include: ["src/lib/**/*.ts", "src/components/**/*.ts"],
      reporter: ["text", "html"]
    },
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"]
  }
});
