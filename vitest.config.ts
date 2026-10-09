import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: false,
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/api/test/**/*.test.ts",
      "apps/web/test/**/*.test.ts",
    ],
    environment: "node",
  },
});
