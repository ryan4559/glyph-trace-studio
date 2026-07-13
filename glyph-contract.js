// The glyph "contract" shared by the editor (app.js) and the plate page
// (taiwan-plate.js): how characters map to file/module names, what counts
// as a saved trace, and when a trace set is complete enough for consumers
// that need every glyph (the plate customizer's 0-9 A-Z dropdown). Pure
// functions only — no DOM, no storage.

export function charSlug(char) {
  if (/^[A-Z0-9]$/.test(char)) return char;
  if (/^[a-z]$/.test(char)) return `${char}_low`;
  return (
    "u" +
    Array.from(char)
      .map((c) => c.codePointAt(0).toString(16).toUpperCase())
      .join("_")
  );
}

// File base name: the settings prefix (sanitized for file systems) + slug.
export function fileBase(settings, char) {
  const prefix = String(settings.prefix || "").replace(/[^A-Za-z0-9._-]/g, "_");
  return `${prefix}${charSlug(char)}`;
}

// OpenSCAD module name: a bundle-supplied modulePrefix wins over the file
// prefix; the result is always a valid SCAD identifier.
export function moduleName(settings, char) {
  const base = settings.modulePrefix || settings.prefix || "";
  let name = `${base}${charSlug(char)}`.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(name)) name = `g${name}`;
  return name;
}

// A contour needs at least 3 nodes to be a drawable outline.
export function savedContours(traces, char) {
  return (traces?.[char]?.contours || []).filter((contour) => contour.length >= 3);
}

// Characters in `chars` that have no saved trace.
export function missingChars(traces, chars) {
  return chars.filter((char) => !savedContours(traces, char).length);
}

// The full trace set for `chars`, with degenerate contours filtered out —
// or null when any character is missing (consumers that dispatch on every
// character must not accept a partial set).
export function completeTraceSet(traces, chars) {
  const complete = {};
  for (const char of chars) {
    const contours = savedContours(traces, char);
    if (!contours.length) return null;
    complete[char] = { char, contours };
  }
  return complete;
}
