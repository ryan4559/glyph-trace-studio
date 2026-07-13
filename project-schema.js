// Project-file schema: the shape of an exported/imported project, its
// defaults and resource caps, and the sanitizers that rebuild a trusted
// project from an untrusted file. Pure functions only — app.js supplies the
// UI and storage around them. Tested by tools/tests/test_project_schema.mjs.

export const APP_ID = "img2openscad-glyph-editor";
export const PROJECT_VERSION = 2;
export const LEGACY_IMAGE_ID = "legacy-ref";

export const DEFAULT_SETTINGS = {
  chars: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  svgW: 45,
  svgH: 89,
  prefix: "glyph_",
  // Module names default to the file prefix; a bundled project manifest
  // (project.json) overrides this so generated OpenSCAD module names match
  // the repo's pre-existing files.
  modulePrefix: "",
};

// Resource caps: keep hostile/huge inputs from freezing the tab or flooding
// IndexedDB (the glyph grid, tracer and previews all scale with these).
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 128 * 1024 * 1024;
export const MAX_IMAGES = 64;
export const MAX_CHARS = 256;
export const MAX_CONTOURS_PER_GLYPH = 128;
export const MAX_POINTS_PER_CONTOUR = 4000;

export function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export function parseCharset(text) {
  const chars = Array.from(new Set(Array.from(String(text || "").replace(/\s+/g, "")))).slice(
    0,
    MAX_CHARS
  );
  return chars.length ? chars : Array.from(DEFAULT_SETTINGS.chars);
}

// True when the parsed JSON is a project file of this app (any version).
export function isProjectPayload(data) {
  return Boolean(data) && typeof data === "object" && data.app === APP_ID;
}

// The exported project-file payload.
export function buildProjectPayload(
  { settings, sources, traces, glyphs, images = [], activeImageId = null } = {}
) {
  return {
    app: APP_ID,
    version: PROJECT_VERSION,
    settings,
    sources,
    traces,
    glyphs,
    images,
    activeImageId,
  };
}

function finiteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// Only data:image/... URLs are ever accepted from a project file — anything
// else (http(s), blob, ...) would later be assigned to img.src and leak a
// network request, breaking the "everything stays in your browser" promise.
export function isDataImageUrl(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

export function isImageId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

export function sanitizeImportedImages(raw) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_IMAGES) throw new Error("too many images");
  const images = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || !isImageId(entry.id) || seen.has(entry.id)) {
      continue;
    }
    if (!isDataImageUrl(entry.dataUrl)) continue;
    const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
    images.push({
      id: entry.id,
      name: (rawName || `Reference image ${images.length + 1}`).slice(0, 128),
      dataUrl: entry.dataUrl,
    });
    seen.add(entry.id);
  }
  return images;
}

export function sanitizeImportedSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    chars: parseCharset(src.chars).join(""),
    svgW: clampNumber(src.svgW, 1, 1000, DEFAULT_SETTINGS.svgW),
    svgH: clampNumber(src.svgH, 1, 1000, DEFAULT_SETTINGS.svgH),
    prefix:
      typeof src.prefix === "string" && src.prefix.trim()
        ? src.prefix.slice(0, 64)
        : DEFAULT_SETTINGS.prefix,
    modulePrefix: typeof src.modulePrefix === "string" ? src.modulePrefix.slice(0, 64) : "",
  };
}

// Malformed entries are dropped; absurd sizes (a hostile or corrupt file)
// reject the whole import.
export function sanitizeImportedTrace(char, raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.contours)) return null;
  if (raw.contours.length > MAX_CONTOURS_PER_GLYPH) throw new Error("too many contours");
  const contours = [];
  for (const contour of raw.contours) {
    if (!Array.isArray(contour)) return null;
    if (contour.length > MAX_POINTS_PER_CONTOUR) throw new Error("contour too long");
    const points = [];
    for (const point of contour) {
      if (!point || typeof point !== "object") return null;
      const x = finiteOrNull(point.x);
      const y = finiteOrNull(point.y);
      if (x === null || y === null) return null;
      points.push({
        x,
        y,
        inX: finiteOrNull(point.inX) ?? x,
        inY: finiteOrNull(point.inY) ?? y,
        outX: finiteOrNull(point.outX) ?? x,
        outY: finiteOrNull(point.outY) ?? y,
      });
    }
    if (points.length >= 3) contours.push(points);
  }
  return contours.length ? { char, contours } : null;
}

export function sanitizeImportedSource(char, raw, imageIds = null, fallbackImageId = null) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.box) || raw.box.length !== 4) {
    return null;
  }
  const box = raw.box.map(finiteOrNull);
  if (box.some((value) => value === null)) return null;
  const requestedImageId = isImageId(raw.imageId) ? raw.imageId : null;
  const imageId =
    requestedImageId && (!imageIds || imageIds.has(requestedImageId))
      ? requestedImageId
      : fallbackImageId;
  return {
    char,
    source: typeof raw.source === "string" ? raw.source.slice(0, 128) : "manual",
    imageId,
    box,
    polarity: raw.polarity === "light" ? "light" : "dark",
    threshold: clampNumber(raw.threshold, 0, 255, 110),
    offset_x: Math.round(clampNumber(raw.offset_x, -999, 999, 0)),
  };
}

// Rebuild the whole project from scratch, keyed strictly by the sanitized
// charset (which also keeps hostile keys like "__proto__" out of the maps).
export function sanitizeImportedProject(data) {
  const settings = sanitizeImportedSettings(data.settings);
  let images = sanitizeImportedImages(data.images);
  let fallbackImageId = null;
  // Version 1 stored one global `refImage` and no source/image association.
  // Normalize it into the v2 shape so callers only handle one data model.
  if (!Array.isArray(data.images) && isDataImageUrl(data.refImage)) {
    images = [{ id: LEGACY_IMAGE_ID, name: "Reference image", dataUrl: data.refImage }];
    fallbackImageId = LEGACY_IMAGE_ID;
  }
  const imageIds = new Set(images.map((image) => image.id));
  const activeImageId = imageIds.has(data.activeImageId)
    ? data.activeImageId
    : images[0]?.id || null;
  const rawSources = data.sources && typeof data.sources === "object" ? data.sources : {};
  const rawTraces = data.traces && typeof data.traces === "object" ? data.traces : {};
  const rawGlyphs = data.glyphs && typeof data.glyphs === "object" ? data.glyphs : {};
  const sources = {};
  const traces = {};
  const glyphs = {};
  for (const char of parseCharset(settings.chars)) {
    const source = sanitizeImportedSource(char, rawSources[char], imageIds, fallbackImageId);
    if (source) sources[char] = source;
    const trace = sanitizeImportedTrace(char, rawTraces[char]);
    if (trace) traces[char] = trace;
    if (isDataImageUrl(rawGlyphs[char])) glyphs[char] = rawGlyphs[char];
  }
  return {
    settings,
    sources,
    traces,
    glyphs,
    images,
    activeImageId,
  };
}
