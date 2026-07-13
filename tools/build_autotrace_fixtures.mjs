// Rebuild the autotrace regression fixtures from the author's 2012-style
// glyph outlines under taiwan-glyphs/source/.
//
// Usage: node tools/build_autotrace_fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AutoTrace } from "../autotrace.js";
import { Exporters } from "../exporters.js";
import {
  CHARS,
  GLYPH_SETTINGS,
  ROOT,
  SOURCE_AGENCY,
  SOURCE_DIR,
  SOURCE_TITLE,
  SOURCE_URL,
  buildTraceSet,
} from "./taiwan_glyph_source.mjs";

const outputDir = join(ROOT, "tools", "tests", "fixtures");
const width = GLYPH_SETTINGS.canvasW;
const height = GLYPH_SETTINGS.canvasH;
const pixelsPerMm = 4;

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function rasterize(polygons) {
  const mask = new Uint8Array(width * height);
  for (let py = 0; py < height; py += 1) {
    const y = (py + 0.5) / pixelsPerMm - height / pixelsPerMm / 2;
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / pixelsPerMm - width / pixelsPerMm / 2;
      let ink = false;
      for (const polygon of polygons) {
        if (insidePolygon(x, y, polygon)) ink = !ink;
      }
      mask[py * width + px] = Number(ink);
    }
  }
  return mask;
}

function packMask(mask) {
  const bytes = Buffer.alloc(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return bytes.toString("base64");
}

mkdirSync(outputDir, { recursive: true });
const traces = buildTraceSet();
for (const char of CHARS) {
  const polygons = traces[char].contours.map((contour) =>
    Exporters.sampleContour(contour, GLYPH_SETTINGS, 32).map(([x, y]) => [x, -y])
  );
  const mask = rasterize(polygons);
  const fixture = {
    char,
    width,
    height,
    source: `${SOURCE_AGENCY}「${SOURCE_TITLE}」的作者描邊`,
    sourceUrl: SOURCE_URL,
    mask: packMask(mask),
    expected: {
      "0.5": AutoTrace.traceMask(mask, width, height, { round: 0.5 }),
      "0.0": AutoTrace.traceMask(mask, width, height, { round: 0 }),
    },
  };
  writeFileSync(join(outputDir, `${char}.json`), `${JSON.stringify(fixture)}\n`);
}
console.log(`Wrote ${CHARS.length} fixtures from ${SOURCE_DIR}`);
