import { es } from "./es";

/** Every locale must provide exactly the keys of the default (Spanish) dictionary. */
export type Messages = typeof es;
export type Locale = "es";

export const defaultLocale: Locale = "es";
const dictionaries: Record<Locale, Messages> = { es };
/** BCP 47 tag used by `Intl` for each locale. */
const intlLocales: Record<Locale, string> = { es: "es" };

/** Active locale. A future language switch only needs to change how this value is resolved. */
export const activeLocale: Locale = defaultLocale;
export const messages: Messages = dictionaries[activeLocale];
export const intlLocale = intlLocales[activeLocale];

/** Returns the messages of the active locale for use inside components. */
export function useMessages(): Messages {
  return messages;
}

/** Replaces `{name}` placeholders with the given values. */
export function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Display label for a code returned by the API; unknown codes fall back to `fallback` or the code. */
export function labelFor(
  labels: Readonly<Record<string, string>>,
  code: string,
  fallback?: string,
): string {
  return Object.hasOwn(labels, code) ? labels[code]! : (fallback ?? code);
}

export { es };
