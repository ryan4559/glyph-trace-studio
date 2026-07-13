// Regenerate the plate customizer .scad files — the three 1992 plates under
// taiwan-1992/output/ and the three 新式 (2012, 3-4 七碼) plates under
// taiwan-2012/output/ — from taiwan-glyphs/traces.json (both eras share the
// official-specification 2012 glyph set). The scripted alternative to downloading them from
// taiwan-plate.html. Uses the same fixed constants as the tests; verify
// afterwards with tools/tests/test_taiwan_plates.mjs.
//
//   node tools/build_taiwan_plates.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Plates } from "../taiwan-plates.js";
import { GLYPH_SETTINGS } from "./taiwan_glyph_source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const traces = JSON.parse(readFileSync(join(root, "taiwan-glyphs", "traces.json"), "utf8"));
const opts = {
  chars: [...GLYPH_SETTINGS.chars],
  svgW: GLYPH_SETTINGS.svgW,
  svgH: GLYPH_SETTINGS.svgH,
  moduleName: (char) => `${GLYPH_SETTINGS.modulePrefix}${char}`,
  sampleOpts: () => GLYPH_SETTINGS,
};

for (const [dir, specs] of [
  ["taiwan-1992", Plates.SPECS],
  ["taiwan-2012", Plates.SPECS_2012],
]) {
  const outDir = join(root, dir, "output");
  mkdirSync(outDir, { recursive: true });
  for (const spec of specs) {
    const scad = Plates.buildPlateScad(spec, traces, opts);
    writeFileSync(join(outDir, spec.filename), scad);
    console.log(`wrote ${spec.filename} (${scad.length} bytes)`);
  }
}
