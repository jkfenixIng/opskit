import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { es, interpolate, labelFor } from "../i18n";
import { ApiError, errorMessage, messageForStatus } from "../i18n/errors";
import { formatCalendarDate, formatMoney } from "../i18n/format";
import { alertText, alertTitle, paymentMethodLabel } from "../i18n/labels";
import { findEnglishLiterals } from "./english-literals";

const webRoot = resolve(import.meta.dirname, "..");

function leaves(value: unknown, path = ""): [string, unknown][] {
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, path ? `${path}.${key}` : key),
    );
  return [[path, value]];
}

describe("es dictionary", () => {
  it("has a non-empty string for every key", () => {
    const entries = leaves(es);
    expect(entries.length).toBeGreaterThan(100);
    const invalid = entries.filter(
      ([, value]) => typeof value !== "string" || value.trim() === "",
    );
    expect(invalid).toEqual([]);
  });

  it("labels every code the API can return", () => {
    expect(Object.keys(es.codes.role).sort()).toEqual(["manager", "owner", "staff", "viewer"]);
    expect(Object.keys(es.codes.cadence).sort()).toEqual(["biweekly", "customDays", "monthly", "weekly"]);
    expect(Object.keys(es.codes.movementKind).sort()).toEqual(["adjustment", "in", "out"]);
    expect(Object.keys(es.codes.payPeriodStatus).sort()).toEqual(["calculated", "closed", "draft"]);
    expect(Object.keys(es.codes.advanceStatus).sort()).toEqual(["approved", "rejected", "requested"]);
  });

  it("interpolates placeholders and falls back for unknown codes", () => {
    expect(interpolate(es.amount.tooManyDecimals, { places: 2 })).toBe(
      "El monto admite como máximo 2 decimales.",
    );
    expect(labelFor(es.codes.role, "owner")).toBe("Propietario");
    expect(labelFor(es.codes.role, "auditor")).toBe("auditor");
    expect(labelFor(es.codes.role, "toString")).toBe("toString");
  });
});

describe("API error messages", () => {
  it("maps HTTP status codes to Spanish text and keeps the backend detail apart", () => {
    expect(messageForStatus(401, "Invalid credentials")).toBe(es.errors.invalidCredentials);
    expect(messageForStatus(401, "Session expired")).toBe(es.errors.unauthorized);
    expect(messageForStatus(403, "Permission denied: cash:write")).toBe(es.errors.forbidden);
    expect(messageForStatus(422, "Advance exceeds limit")).toBe(es.errors.businessRule);
    expect(messageForStatus(500, null)).toBe(es.errors.server);
    expect(messageForStatus(null, null)).toBe(es.errors.network);
    const error = new ApiError(messageForStatus(404, "Till was not found"), 404, "Till was not found");
    expect(errorMessage(error, "fallback")).toBe(es.errors.notFound);
    expect(error.detail).toBe("Till was not found");
    expect(errorMessage(new Error("raw English"), "fallback")).toBe("fallback");
  });
});

describe("locale formatting", () => {
  it("keeps the configured currency and decimals", () => {
    expect(formatMoney(12_345_678, "COP", 2)).toMatch(/123\.456,78/);
    expect(formatMoney(123_456, "COP", 2)).toMatch(/1\.?234,56/);
    expect(formatMoney(5, "JPY", 0)).toMatch(/5/);
    expect(formatMoney(12_345, "KWD", 3)).toMatch(/12,345/);
  });

  it("formats calendar dates without a time zone shift", () => {
    expect(formatCalendarDate("2026-02-01")).toMatch(/1 feb/);
    expect(formatCalendarDate("not-a-date")).toBe("not-a-date");
  });
});

describe("labels for API data", () => {
  it("translates known payment methods and keeps custom ones", () => {
    expect(paymentMethodLabel(es, { code: "cash", label: "Cash" })).toBe("Efectivo");
    expect(paymentMethodLabel(es, { code: "card", label: "Card" })).toBe("Tarjeta");
    expect(paymentMethodLabel(es, { code: "transfer", label: "Bank transfer" })).toBe(
      "Transferencia bancaria",
    );
    expect(paymentMethodLabel(es, { code: "nequi", label: "Nequi" })).toBe("Nequi");
    expect(paymentMethodLabel(es, { code: "voucher" })).toBe("voucher");
  });

  it("localizes alerts and falls back when the backend text is not recognized", () => {
    expect(
      alertText(es, { kind: "low_stock", message: "Coffee beans is at or below its stock threshold" }),
    ).toBe("Coffee beans está en su umbral de existencias o por debajo de él.");
    expect(alertText(es, { kind: "low_stock", message: "Stock changed" })).toBe(
      es.codes.alertMessage.low_stock,
    );
    expect(alertText(es, { kind: "cash_difference", message: "anything" })).toBe(
      es.codes.alertMessage.cash_difference,
    );
    expect(alertText(es, { kind: "new_kind", message: "Backend text" })).toBe("Backend text");
    expect(alertTitle(es, { kind: "low_stock" })).toBe("Existencias bajas");
    expect(alertTitle(es, { kind: "new_kind" })).toBe(es.codes.unknownAlert);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(resolve(webRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/**
 * Guards against untranslated visible text in components and pages. Allowed literals are
 * listed with their reason in `english-literals.ts`.
 */
describe("web sources without English literals", () => {
  const files = [...sourceFiles("components"), ...sourceFiles("app")];

  it("scans components (.ts and .tsx) and app/ recursively", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "components/api.ts",
        "components/money-input.ts",
        "components/dashboard.tsx",
        "app/not-found.tsx",
        "app/api/[...path]/route.ts",
      ]),
    );
  });

  it("flags known English in fixtures (negative control)", () => {
    const fixtures: [string, string][] = [
      ["<p>Expected balance:</p>", "Expected balance:"],
      ["<td>3 items (pending)</td>", "3 items (pending)"],
      ['<button>{cond ? "Save" : "Saved"}</button>', "Save"],
      ['<button>{cond ? "Save" : "Saved"}</button>', "Saved"],
      ['<span>{"Loading data"}</span>', "Loading data"],
      ['setMessage("Saved")', "Saved"],
      ['<input placeholder="Search people" />', "Search people"],
      ['<Dialog confirmLabel={"Delete item"} />', "Delete item"],
      ['throw new Error("Amount is required")', "Amount is required"],
      ["<small>items pending</small>", "items pending"],
      ["<td>Total: {value}</td>", "Total:"],
      ['setError(`Could not load ${name}`)', "Could not load ${name}"],
    ];
    for (const [source, expected] of fixtures)
      expect(findEnglishLiterals(source), source).toContain(expected);
  });

  it("does not flag code tokens (positive control)", () => {
    const source = [
      'const run = (work: () => Promise<unknown>) => api<T[]>("people");',
      "function useList<T>(path: string) {",
      '<section className="panel ops-wide" role="tabpanel">',
      'setTab("cash"); setBase(event.target.value as "gross" | "net");',
      '<Link href="/operations">{t.nav.operations}</Link>',
      'post("compensation/pay-periods", { kind: "monthly" });',
      '<button id={`operations-tab-${index}`} className={`alert-item ${alert.severity}`}>',
      "{error ? (<p>{error}</p>) : !data ? (<Skeleton />) : null}",
      'const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";',
    ].join("\n");
    expect(findEnglishLiterals(source)).toEqual([]);
  });

  it.each(files)("%s has no hard-coded visible text", (path) => {
    expect(findEnglishLiterals(readFileSync(resolve(webRoot, path), "utf8"))).toEqual([]);
  });
});
