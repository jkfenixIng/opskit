import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const webRoot = resolve(root, "apps/web");

function json(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as {
    compilerOptions?: { jsx?: string };
    exclude?: string[];
  };
}

describe("web build and test JSX configuration", () => {
  it("keeps Next's build tsconfig separate from Vitest's JSX transform", () => {
    const buildConfig = json(resolve(webRoot, "tsconfig.json"));
    const testConfig = json(resolve(webRoot, "tsconfig.test.json"));
    const vitestConfig = readFileSync(resolve(root, "vitest.config.ts"), "utf8");

    expect(buildConfig.compilerOptions?.jsx).toBe("preserve");
    expect(buildConfig.exclude).toContain("test");
    expect(testConfig.compilerOptions?.jsx).toBe("react-jsx");
    expect(vitestConfig).toContain("oxc: false");
    expect(vitestConfig).toContain('jsx: "automatic"');
  });
});
