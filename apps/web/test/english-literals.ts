/**
 * Heuristic scanner for hard-coded user-facing text in web sources. It is a static guard,
 * not a parser: it looks at the places where visible copy is written in this codebase.
 */

/** Lowercase identifiers, camelCase codes, paths and CSS-like tokens are code, not copy. */
const codeLike = /^(?:[a-z][a-zA-Z0-9]*|[a-z0-9]+(?:[-_./:][a-z0-9]+)+|\/[\w\-/[\]$.{}]*)$/;

/**
 * Literals that may appear in source on purpose, each with its reason.
 * Keep this list minimal; anything visible must come from `i18n/`.
 */
export const allowedLiterals: Record<string, string> = {
  OpsKit: "product brand",
  "Fixed pay": "compensation component label stored as API data; shown via codes/componentLabels",
  Commission: "compensation component label stored as API data; shown via codes/componentLabels",
  "tab active": "CSS class names",
  "chart-bar low": "CSS class name",
  "metric alert": "CSS class name",
  USD: "initial currency code sent to formatters before settings load",
};

const patterns: RegExp[] = [
  // JSX text between tags, including digits, ':' and parentheses. `(?<![=)])` skips `=>` and
  // `) >`; excluded characters (= ; [ ] { } quotes | &) keep TypeScript generics out.
  /(?<![=)-])>([^<>{}=;[\]"'`|&]*[A-Za-z]{2}[^<>{}=;[\]"'`|&]*)[<{]/g,
  // String literals rendered as JSX expressions: {"..."}.
  /\{\s*["'`]([^"'`]*[A-Za-z]{2}[^"'`]*)["'`]\s*\}/g,
  // Ternary branches: cond ? "..." : "...".
  /\?\s*["'`]([^"'`]*[A-Za-z]{2}[^"'`]*)["'`]/g,
  /(?<=\?[^:?]{0,200}):\s*["'`]([^"'`]*[A-Za-z]{2}[^"'`]*)["'`](?=\s*[)}\n,])/g,
  // Message setters and thrown errors: setMessage("..."), new Error("...").
  /\bset[A-Z]\w*\(\s*["'`]([^"'`]*[A-Za-z]{2}[^"'`]*)["'`]/g,
  /\bnew \w*Error\(\s*["'`]([^"'`]*[A-Za-z]{2}[^"'`]*)["'`]/g,
  // Visible or announced props.
  /\b(?:aria-label|aria-description|title|placeholder|alt|description|confirmLabel|empty|label|hint|detail)=["']([^"']*[A-Za-z][^"']*)["']/g,
  /\b(?:aria-label|title|placeholder|alt|description|confirmLabel|empty|label|hint|detail)=\{\s*["'`]([^"'`]*[A-Za-z][^"'`]*)["'`]\s*\}/g,
];

/** Template ids/classes once `${...}` is removed, URLs, and JSX syntax such as `) : !data ? (`. */
function isCode(text: string): boolean {
  const literal = text.replace(/\$\{[^}]*\}/g, "x").replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2}/.test(literal)) return true;
  if (/^https?:\/\/\S+$/.test(literal) || /^\)/.test(literal)) return true;
  // Generic function signatures: `useList<T>(path: string) {`.
  if (/^\((?:\w+\??: [\w.<>[\]| ]+(?:, )?)*\)$/.test(literal)) return true;
  const parts = literal.split(" ");
  if (!parts.every((part) => codeLike.test(part))) return false;
  // One token is an identifier/code; several lowercase tokens are code only when they look like
  // CSS classes or ids (a hyphen, underscore or template part). "items pending" is still flagged.
  return parts.length === 1 || /[-_]/.test(literal) || literal !== text;
}

export function findEnglishLiterals(source: string): string[] {
  const found = patterns.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1]!.replace(/\s+/g, " ").trim()),
  );
  return [...new Set(found)].filter(
    (text) => /[A-Za-z]/.test(text) && !isCode(text) && !(text in allowedLiterals),
  );
}
