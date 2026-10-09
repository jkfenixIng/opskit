import { describe, expect, it } from "vitest";
import { AmountError, parseMinorAmount } from "../components/money-input";

const failure = (value: string, minorUnits: number) => {
  try {
    parseMinorAmount(value, minorUnits);
  } catch (error) {
    if (error instanceof AmountError) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error("expected parseMinorAmount to fail");
};

describe("parseMinorAmount", () => {
  it("converts decimal text to minor units without floating point error", () => {
    expect(parseMinorAmount("0.29", 2)).toBe(29);
    expect(parseMinorAmount("1.005", 3)).toBe(1_005);
    expect(parseMinorAmount("19.9", 2)).toBe(1_990);
    expect(parseMinorAmount("  42 ", 0)).toBe(42);
    expect(parseMinorAmount(".5", 2)).toBe(50);
  });

  it("accepts a comma as the decimal separator", () => {
    expect(parseMinorAmount("12,34", 2)).toBe(1_234);
  });

  it("rejects more decimals than the currency allows instead of rounding", () => {
    expect(failure("1.005", 2)).toEqual({ code: "tooManyDecimals", message: "El monto admite como máximo 2 decimales." });
    expect(failure("1.5", 0).code).toBe("tooManyDecimals");
  });

  it("rejects negative, empty and malformed values", () => {
    expect(failure("-1", 2).code).toBe("invalidFormat");
    expect(failure("", 2)).toEqual({ code: "required", message: "El monto es obligatorio." });
    expect(failure("   ", 2).code).toBe("required");
    expect(failure("1e3", 2).code).toBe("invalidFormat");
    expect(failure("1.2.3", 2).code).toBe("invalidFormat");
    expect(failure("1,000.50", 2).code).toBe("invalidFormat");
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(parseMinorAmount("90071992547409.91", 2)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(failure("90071992547409.92", 2).code).toBe("tooLarge");
  });
});
