// Build the bundled 2012 glyph trace set and per-glyph SVG/OpenSCAD outputs
// from the official-specification SVG sources under taiwan-glyphs/source/.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { Exporters } from "../exporters.js";
import { fileBase, moduleName } from "../glyph-contract.js";
import {
  CHARS,
  EXAMPLE_DIR,
  GLYPH_DIR,
  GLYPH_SETTINGS,
  OUTPUT_DIR,
  SOURCE_AGENCY,
  SOURCE_TITLE,
  buildTraceSet,
} from "./taiwan_glyph_source.mjs";

const traces = buildTraceSet();
mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(EXAMPLE_DIR, { recursive: true });
writeFileSync(join(GLYPH_DIR, "traces.json"), `${JSON.stringify(traces, null, 2)}\n`);

for (const char of CHARS) {
  const contours = traces[char].contours;
  const base = fileBase(GLYPH_SETTINGS, char);
  const name = moduleName(GLYPH_SETTINGS, char);
  const opts = {
    ...GLYPH_SETTINGS,
    shapeId: name,
    moduleName: name,
    comment: `Generated from ${SOURCE_AGENCY}「${SOURCE_TITLE}」author trace`,
  };
  const svg = Exporters.buildSvg(contours, opts);
  writeFileSync(join(OUTPUT_DIR, `${base}.svg`), svg);
  writeFileSync(join(OUTPUT_DIR, `${base}.scad`), Exporters.buildScad(contours, opts));
}

const exampleColumns = 8;
const exampleRows = Math.ceil(CHARS.length / exampleColumns);
const exampleCellW = GLYPH_SETTINGS.canvasW;
const exampleCellH = GLYPH_SETTINGS.canvasH;
const exampleGap = 24;
const exampleMargin = 12;
const exampleWidth = exampleMargin * 2 + exampleColumns * exampleCellW + (exampleColumns - 1) * exampleGap;
const exampleHeight = exampleMargin * 2 + exampleRows * exampleCellH + (exampleRows - 1) * exampleGap;
const examplePixels = new Uint8Array(exampleWidth * exampleHeight).fill(255);
const exampleSources = {};

function rasterizeContours(contours) {
  const polygons = contours.map((contour) =>
    Exporters.sampleContour(contour, GLYPH_SETTINGS, 32).map(([x, y]) => [x, -y])
  );
  const mask = new Uint8Array(exampleCellW * exampleCellH);
  for (let py = 0; py < exampleCellH; py += 1) {
    const y = (py + 0.5) / 4 - GLYPH_SETTINGS.svgH / 2;
    const intersections = [];
    for (const polygon of polygons) {
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y)) intersections.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const left = intersections[i];
      const right = intersections[i + 1];
      const start = Math.max(0, Math.ceil((left + GLYPH_SETTINGS.svgW / 2) * 4 - 0.5));
      const end = Math.min(exampleCellW, Math.ceil((right + GLYPH_SETTINGS.svgW / 2) * 4 - 0.5));
      for (let px = start; px < end; px += 1) mask[py * exampleCellW + px] = 1;
    }
  }
  return mask;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function grayscalePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width, width).copy(rows, y * (width + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

[...CHARS].forEach((char, index) => {
  const column = index % exampleColumns;
  const row = Math.floor(index / exampleColumns);
  const x = exampleMargin + column * (exampleCellW + exampleGap);
  const y = exampleMargin + row * (exampleCellH + exampleGap);
  const mask = rasterizeContours(traces[char].contours);
  for (let py = 0; py < exampleCellH; py += 1) {
    for (let px = 0; px < exampleCellW; px += 1) {
      if (mask[py * exampleCellW + px]) examplePixels[(y + py) * exampleWidth + x + px] = 0;
    }
  }
  exampleSources[char] = {
    char,
    source: "official-2012-svg",
    box: [x, y, x + exampleCellW, y + exampleCellH],
    polarity: "dark",
    threshold: 110,
    offset_x: 0,
  };
});
writeFileSync(join(EXAMPLE_DIR, "reference.png"), grayscalePng(exampleWidth, exampleHeight, examplePixels));
writeFileSync(join(EXAMPLE_DIR, "sources.json"), `${JSON.stringify(exampleSources, null, 2)}\n`);

console.log(`Wrote ${CHARS.length} glyphs, fallback traces, and bundled example data`);
