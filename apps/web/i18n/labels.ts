import { interpolate, labelFor, type Messages } from "./index";

/** Payment method name: known codes are translated; custom methods keep their configured label. */
export function paymentMethodLabel(
  t: Messages,
  method: { code: string; label?: string | null },
): string {
  return labelFor(t.codes.paymentMethod, method.code, method.label || method.code);
}

/** Alert title; unknown kinds get a generic Spanish title instead of the raw code. */
export function alertTitle(t: Messages, alert: { kind: string }): string {
  return labelFor(t.codes.alertKind, alert.kind, t.codes.unknownAlert);
}

const lowStockMessage = /^(.+) is at or below its stock threshold$/;

/** Localized alert text; keeps the product name when the backend message carries it. */
export function alertText(t: Messages, alert: { kind: string; message: string }): string {
  const named = lowStockMessage.exec(alert.message);
  if (alert.kind === "low_stock" && named?.[1])
    return interpolate(t.codes.lowStockNamed, { name: named[1] });
  return labelFor(t.codes.alertMessage, alert.kind, alert.message);
}
