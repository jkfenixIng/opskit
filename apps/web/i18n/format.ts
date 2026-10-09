import { intlLocale } from "./index";

/** Formats an amount in minor units with the configured currency and number of decimals. */
export const formatMoney = (
  amountMinor: number,
  currency: string,
  minorUnits: number,
) =>
  new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(amountMinor / 10 ** minorUnits);

export const formatNumber = (value: number) =>
  new Intl.NumberFormat(intlLocale).format(value);

/** Formats a ratio where 1 means 100 %. */
export const formatPercent = (ratio: number) =>
  new Intl.NumberFormat(intlLocale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(ratio);

export const formatDateTime = (value: string | Date) =>
  new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

/** Formats a calendar date (YYYY-MM-DD) without shifting it through the local time zone. */
export const formatCalendarDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
};
