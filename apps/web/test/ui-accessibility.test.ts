import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nextTabIndex } from "../components/ui-helpers";

const webRoot = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(webRoot, path), "utf8");

describe("workspace keyboard navigation", () => {
  it("cycles tabs with arrow keys and Home/End", () => {
    expect(nextTabIndex("ArrowRight", 0, 4)).toBe(1);
    expect(nextTabIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(nextTabIndex("Home", 2, 4)).toBe(0);
    expect(nextTabIndex("End", 1, 4)).toBe(3);
  });

  it("keeps the web layer on the REST API boundary", () => {
    const webFiles = [
      "components/api.ts",
      "components/dashboard.tsx",
      "components/operations-workspace.tsx",
      "components/compensation-workspace.tsx",
      "components/settings-form.tsx",
    ]
      .map(source)
      .join("\n");
    expect(webFiles).not.toMatch(/@opskit\/(core|sqlite)|drizzle|node:sqlite/);
    expect(source("components/api.ts")).toContain("`/api/${path}`");
  });
});
