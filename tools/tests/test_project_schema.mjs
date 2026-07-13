// Unit tests for project-schema.js: import sanitization (hostile URLs,
// malformed data, prototype-pollution keys, resource caps), settings
// clamping, and export → import round-trip.
//
//   node tools/tests/test_project_schema.mjs
import {
  APP_ID,
  DEFAULT_SETTINGS,
  LEGACY_IMAGE_ID,
  MAX_CHARS,
  MAX_CONTOURS_PER_GLYPH,
  MAX_IMAGES,
  MAX_POINTS_PER_CONTOUR,
  PROJECT_VERSION,
  parseCharset,
  isProjectPayload,
  buildProjectPayload,
  sanitizeImportedProject,
} from "../../project-schema.js";

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const tri = [
  { x: 10, y: 10, inX: 5, inY: 10, outX: 15, outY: 10 },
  { x: 100, y: 10, inX: 95, inY: 10, outX: 105, outY: 10 },
  { x: 50, y: 200, inX: 45, inY: 200, outX: 55, outY: 200 },
];

// --- payload recognition ---
check("isProjectPayload accepts own exports", isProjectPayload(buildProjectPayload({})));
check(
  "project exports use the multi-image schema",
  buildProjectPayload({}).version === PROJECT_VERSION && PROJECT_VERSION === 2
);
check("isProjectPayload rejects other apps", !isProjectPayload({ app: "other" }));
check("isProjectPayload rejects non-objects", !isProjectPayload("x") && !isProjectPayload(null));

// --- hostile / malformed input ---
{
  // JSON.parse (like a real project file) creates "__proto__" as an own key.
  const project = sanitizeImportedProject(
    JSON.parse(
      JSON.stringify({
        app: APP_ID,
        settings: { chars: "AB", svgW: 45, svgH: 89, prefix: "t_" },
        sources: {
          A: {
            imageId: "sheet-b",
            box: [0, 0, 50, 100],
            polarity: "dark",
            threshold: 110,
            offset_x: 0,
          },
          B: { box: "garbage" },
        },
        traces: {
          A: { contours: [tri] },
          B: { contours: "garbage" },
        },
        glyphs: {
          A: "https://evil.example.com/track.png",
          B: "data:image/png;base64,iVBORw0KGgo=",
        },
        images: [
          { id: "sheet-a", name: "Remote", dataUrl: "https://evil.example.com/ref.png" },
          { id: "sheet-b", name: "Sheet B", dataUrl: "data:image/png;base64,BBBB" },
          { id: "__proto__", name: "Bad ID", dataUrl: "data:image/png;base64,CCCC" },
          { id: "sheet-b", name: "Duplicate", dataUrl: "data:image/png;base64,DDDD" },
        ],
        activeImageId: "sheet-b",
        refImage: "https://evil.example.com/ref.png",
      }).replace('"sources":{', '"sources":{"__proto__":{"box":[0,0,1,1],"polluted":1},')
    )
  );
  check("external glyph URL dropped", !("A" in project.glyphs));
  check("data: glyph kept", project.glyphs.B?.startsWith("data:image/"));
  check("external image URL dropped", project.images.length === 1);
  check("invalid and duplicate image IDs dropped", project.images[0]?.id === "sheet-b");
  check("active image kept", project.activeImageId === "sheet-b");
  check("valid source kept", Array.isArray(project.sources.A?.box));
  check("source image association kept", project.sources.A?.imageId === "sheet-b");
  check("malformed source dropped", !("B" in project.sources));
  check("valid trace kept", project.traces.A?.contours?.[0]?.length === 3);
  check("malformed trace dropped", !("B" in project.traces));
  check(
    "proto key not imported",
    !Object.prototype.polluted &&
      !Object.getOwnPropertyNames(project.sources).includes("__proto__")
  );
}

// --- numeric coercion + degenerate contours ---
{
  const project = sanitizeImportedProject({
    app: APP_ID,
    settings: { chars: "A" },
    traces: {
      A: {
        contours: [
          tri,
          [{ x: 1, y: 1 }, { x: 2, y: 2 }], // <3 points: dropped
        ],
      },
    },
    sources: { A: { box: [0, 0, 10, "NaN-ish"], polarity: "light" } },
  });
  check("short contour dropped, good one kept", project.traces.A?.contours.length === 1);
  check("missing handles default to anchor", project.traces.A.contours[0][0].inX === 5);
  check("non-numeric box drops the source", !("A" in project.sources));
}
{
  const project = sanitizeImportedProject({
    app: APP_ID,
    settings: { chars: "A" },
    traces: { A: { contours: [[{ x: 1, y: 1 }, { x: 2, y: "bad" }, { x: 3, y: 3 }]] } },
  });
  check("non-numeric coord drops the trace", !("A" in project.traces));
}

// --- caps ---
{
  let threw = false;
  try {
    sanitizeImportedProject({
      app: APP_ID,
      settings: { chars: "A" },
      traces: { A: { contours: Array.from({ length: MAX_CONTOURS_PER_GLYPH + 1 }, () => tri) } },
    });
  } catch {
    threw = true;
  }
  check("contour-count cap rejects the file", threw);
}
{
  let threw = false;
  try {
    const long = Array.from({ length: MAX_POINTS_PER_CONTOUR + 1 }, (_, i) => ({ x: i, y: i }));
    sanitizeImportedProject({ app: APP_ID, settings: { chars: "A" }, traces: { A: { contours: [long] } } });
  } catch {
    threw = true;
  }
  check("point-count cap rejects the file", threw);
}
check(
  "charset capped",
  parseCharset(Array.from({ length: 9999 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("")).length ===
    MAX_CHARS
);
{
  let threw = false;
  try {
    sanitizeImportedProject({
      app: APP_ID,
      images: Array.from({ length: MAX_IMAGES + 1 }, (_, i) => ({
        id: `image-${i}`,
        dataUrl: "data:image/png;base64,AAAA",
      })),
    });
  } catch {
    threw = true;
  }
  check("image-count cap rejects the file", threw);
}

// --- settings clamping ---
{
  const { settings } = sanitizeImportedProject({ app: APP_ID, settings: { svgW: 99999, svgH: -5, prefix: "" } });
  check("svgW clamped to 1000", settings.svgW === 1000);
  check("svgH clamped to 1", settings.svgH === 1);
  check("empty prefix falls back", settings.prefix === DEFAULT_SETTINGS.prefix);
  check("empty charset falls back to 0-9A-Z", settings.chars === DEFAULT_SETTINGS.chars);
}

// --- v1 single-image migration + missing v2 references ---
{
  const project = sanitizeImportedProject({
    app: APP_ID,
    version: 1,
    settings: { chars: "A" },
    sources: { A: { char: "A", box: [1, 2, 3, 4] } },
    refImage: "data:image/png;base64,BBBB",
  });
  check("v1 refImage migrates to images", project.images[0]?.id === LEGACY_IMAGE_ID);
  check("v1 active image migrates", project.activeImageId === LEGACY_IMAGE_ID);
  check("v1 source links to migrated image", project.sources.A?.imageId === LEGACY_IMAGE_ID);
}
{
  const project = sanitizeImportedProject({
    app: APP_ID,
    version: 2,
    settings: { chars: "A" },
    images: [{ id: "sheet-a", name: "A", dataUrl: "data:image/png;base64,AAAA" }],
    activeImageId: "missing",
    sources: { A: { imageId: "missing", box: [1, 2, 3, 4] } },
  });
  check("missing active image falls back to first", project.activeImageId === "sheet-a");
  check("missing source image becomes unlinked", project.sources.A?.imageId === null);
}

// --- round-trip: export payload survives sanitization unchanged ---
{
  const original = {
    settings: { chars: "A中", svgW: 45, svgH: 89, prefix: "x_", modulePrefix: "mod_" },
    sources: {
      A: {
        char: "A",
        source: "manual",
        imageId: "sheet-a",
        box: [1, 2, 3, 4],
        polarity: "light",
        threshold: 42,
        offset_x: -13,
      },
      "中": {
        char: "中",
        source: "manual",
        imageId: "sheet-b",
        box: [5, 6, 7, 8],
        polarity: "dark",
        threshold: 110,
        offset_x: 0,
      },
    },
    traces: { A: { char: "A", contours: [tri] }, "中": { char: "中", contours: [tri] } },
    glyphs: { A: "data:image/png;base64,AAAA" },
    images: [
      { id: "sheet-a", name: "Sheet A.png", dataUrl: "data:image/png;base64,BBBB" },
      { id: "sheet-b", name: "Sheet B.png", dataUrl: "data:image/png;base64,CCCC" },
    ],
    activeImageId: "sheet-b",
  };
  const roundTripped = sanitizeImportedProject(JSON.parse(JSON.stringify(buildProjectPayload(original))));
  check("round-trip preserves multi-image project", JSON.stringify(roundTripped) === JSON.stringify(original));
}

console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
