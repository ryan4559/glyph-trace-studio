// Verify that the independent bundled glyph package is fully reproducible:
// canonical 2012 SVG sources -> fallback traces -> SVG/SCAD/example outputs.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Exporters } from "../../exporters.js";
import { fileBase, moduleName } from "../../glyph-contract.js";
import {
  CHARS,
  EXAMPLE_DIR,
  GLYPH_DIR,
  GLYPH_SETTINGS,
  OUTPUT_DIR,
  ROOT,
  SOURCE_DIR,
  SOURCE_AGENCY,
  SOURCE_TITLE,
  buildTraceSet,
} from "../taiwan_glyph_source.mjs";

const actualTraces = buildTraceSet();
const expectedTraces = JSON.parse(readFileSync(join(GLYPH_DIR, "traces.json"), "utf8"));
let fail = 0;

function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) fail += 1;
}

check("2012 fallback traces match canonical sources", JSON.stringify(actualTraces) === JSON.stringify(expectedTraces));
const sourceFiles = readdirSync(SOURCE_DIR).filter((name) => name !== "README.md").sort();
check(
  "canonical source contains only 36 SVG files",
  sourceFiles.length === CHARS.length && sourceFiles.every((name) => name.endsWith(".svg"))
);
const allNodes = Object.values(actualTraces).flatMap(({ contours }) => contours.flat());
check(
  "fallback preserves cubic Bezier controls",
  allNodes.some((p) => p.inX !== p.x || p.inY !== p.y || p.outX !== p.x || p.outY !== p.y)
);
check(
  "SVG transforms resolve to the 180x356 canvas",
  allNodes.every((p) => p.x >= -1 && p.x <= 181 && p.y >= -1 && p.y <= 357)
);
const exampleManifest = JSON.parse(readFileSync(join(ROOT, "project.json"), "utf8"));
const exampleSources = JSON.parse(readFileSync(join(EXAMPLE_DIR, "sources.json"), "utf8"));
const exampleReference = readFileSync(join(EXAMPLE_DIR, "reference.png"));
check(
  "root page bundles the raster 2012 example",
  exampleManifest.app === "glyph-trace-studio-bundle" &&
    exampleManifest.traces === "./taiwan-glyphs/traces.json" &&
    exampleManifest.ref === "./taiwan-glyphs/example/reference.png"
);
check(
  "example has one pixel-space crop for every glyph",
  Object.keys(exampleSources).length === CHARS.length &&
    [...CHARS].every((char, index) => {
      const column = index % 8;
      const row = Math.floor(index / 8);
      const x = 12 + column * 204;
      const y = 12 + row * 380;
      return JSON.stringify(exampleSources[char]?.box) ===
        JSON.stringify([x, y, x + 180, y + 356]);
    })
);
check(
  "example reference is a 1632x1900 PNG with gutters",
  exampleReference.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    exampleReference.readUInt32BE(16) === 1632 &&
    exampleReference.readUInt32BE(20) === 1900
);

for (const char of CHARS) {
  const base = fileBase(GLYPH_SETTINGS, char);
  const name = moduleName(GLYPH_SETTINGS, char);
  const opts = {
    ...GLYPH_SETTINGS,
    shapeId: name,
    moduleName: name,
    comment: `Generated from ${SOURCE_AGENCY}「${SOURCE_TITLE}」author trace`,
  };
  const contours = actualTraces[char].contours;
  const svg = Exporters.buildSvg(contours, opts);
  const scad = Exporters.buildScad(contours, opts);
  check(`${base}.svg`, svg === readFileSync(join(OUTPUT_DIR, `${base}.svg`), "utf8"));
  check(`${base}.scad`, scad === readFileSync(join(OUTPUT_DIR, `${base}.scad`), "utf8"));
}

process.exit(fail ? 1 : 0);
