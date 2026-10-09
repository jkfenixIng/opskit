import { interpolate, messages } from "../i18n";

export type AmountErrorCode =
  | "invalidPrecision"
  | "required"
  | "invalidFormat"
  | "tooManyDecimals"
  | "tooLarge";

/** Validation error for user-entered amounts; `message` is localized, `code` is stable. */
export class AmountError extends Error {
  constructor(readonly code: AmountErrorCode, values: Record<string, number> = {}) {
    super(interpolate(messages.amount[code], values));
    this.name = "AmountError";
  }
}

/** Parses a user-entered non-negative decimal into exact minor units without binary floating point. */
export function parseMinorAmount(value: string, minorUnits: number): number {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4)
    throw new AmountError("invalidPrecision");
  const text = value.trim();
  if (!text) throw new AmountError("required");
  if (!/^\d*(?:[.,]\d*)?$/.test(text) || !/\d/.test(text))
    throw new AmountError("invalidFormat");
  const [wholeText = "0", decimalText = ""] = text.split(/[.,]/, 2);
  if (decimalText.length > minorUnits)
    throw new AmountError("tooManyDecimals", { places: minorUnits });
  const minor = BigInt(
    `${wholeText || "0"}${decimalText.padEnd(minorUnits, "0")}`,
  );
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AmountError("tooLarge");
  return Number(minor);
}
