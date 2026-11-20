/** Scenario text with **bold** markup removed (for plain-text exports and the student display). */
export const stripMarkup = (v: unknown): string =>
  String(v ?? "")
    .replace(/\*+/g, "")
    .trim();
