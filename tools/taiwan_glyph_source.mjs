import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GLYPH_DIR = join(ROOT, "taiwan-glyphs");
export const SOURCE_DIR = join(GLYPH_DIR, "source");
export const OUTPUT_DIR = join(GLYPH_DIR, "output");
export const EXAMPLE_DIR = join(GLYPH_DIR, "example");
export const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const GLYPH_SETTINGS = Object.freeze({
  chars: CHARS,
  canvasW: 180,
  canvasH: 356,
  svgW: 45,
  svgH: 89,
  prefix: "2012_",
  modulePrefix: "glyph_2012_",
  sampleSteps: 16,
});
export const SOURCE_TITLE = "新式號牌使用之英文字、數字字體";
export const SOURCE_AGENCY = "交通部公路局（原交通部公路總局）";
export const SOURCE_URL = "https://ws.thb.gov.tw/001/Upload/OldFile/resource/html/doc/%E7%9B%A3%E7%90%86%E6%A5%AD%E5%8B%99/%E7%89%8C%E7%85%A7/3.%E6%96%B0%E5%BC%8F%E8%99%9F%E7%89%8C%E4%BD%BF%E7%94%A8%E4%B9%8B%E8%8B%B1%E6%96%87%E5%AD%97%E3%80%81%E6%95%B8%E5%AD%97%E5%AD%97%E9%AB%94.pdf";

function svgGeometry(text, char) {
  const path = text.match(/<path\b[\s\S]*?\bd="([^"]+)"[\s\S]*?\/>/);
  if (!path) throw new Error(`${char}.svg contains no path data`);
  const transform = text.match(/<g\b[^>]*\btransform="translate\(\s*([^)]*)\)"/);
  const values = transform ? transform[1].trim().split(/[\s,]+/).map(Number) : [0, 0];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${char}.svg has an unsupported transform`);
  }
  return { d: path[1], translateX: values[0] || 0, translateY: values[1] || 0 };
}

function pathTokens(d, char) {
  const tokens = d.match(/[MmCcLlHhVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  if (!tokens.length) throw new Error(`${char}.svg has empty path data`);
  return tokens;
}

function parsePath(d, translateX, translateY, char) {
  const tokens = pathTokens(d, char);
  const isCommand = (token) => /^[A-Za-z]$/.test(token);
  const point = ([x, y]) => ({
    x: (x + translateX) * 4,
    y: (y + translateY) * 4,
  });
  const node = (xy) => {
    const p = point(xy);
    return { ...p, inX: p.x, inY: p.y, outX: p.x, outY: p.y };
  };
  const number = (index) => {
    const value = Number(tokens[index]);
    if (!Number.isFinite(value)) throw new Error(`${char}.svg has malformed path data`);
    return value;
  };

  const contours = [];
  let contour = null;
  let current = [0, 0];
  let start = null;
  let command = null;
  let i = 0;

  const endpoint = (x, y, relative) => relative ? [current[0] + x, current[1] + y] : [x, y];
  const lineTo = (end) => {
    const last = contour.at(-1);
    last.outX = last.x;
    last.outY = last.y;
    const next = node(end);
    contour.push(next);
    current = end;
  };
  const cubicTo = (control1, control2, end) => {
    const last = contour.at(-1);
    const out = point(control1);
    last.outX = out.x;
    last.outY = out.y;
    const next = node(end);
    const incoming = point(control2);
    next.inX = incoming.x;
    next.inY = incoming.y;
    contour.push(next);
    current = end;
  };
  const closeContour = () => {
    if (!contour) return;
    const first = contour[0];
    const last = contour.at(-1);
    if (
      contour.length > 1 &&
      Math.abs(last.x - first.x) < 1e-6 &&
      Math.abs(last.y - first.y) < 1e-6
    ) {
      // SVG paths often draw the final curve explicitly back to the start
      // before Z. Fold that duplicate endpoint into the first node so its
      // incoming control point remains exact.
      first.inX = last.inX;
      first.inY = last.inY;
      contour.pop();
    } else {
      last.outX = last.x;
      last.outY = last.y;
      first.inX = first.x;
      first.inY = first.y;
    }
    if (contour.length >= 3) contours.push(contour);
    contour = null;
    current = start;
  };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++];
    if (!command) throw new Error(`${char}.svg path is missing a command`);
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M": {
        const end = endpoint(number(i), number(i + 1), relative);
        i += 2;
        if (contour) closeContour();
        contour = [node(end)];
        current = end;
        start = end;
        command = relative ? "l" : "L";
        break;
      }
      case "L": {
        lineTo(endpoint(number(i), number(i + 1), relative));
        i += 2;
        break;
      }
      case "H": {
        const x = relative ? current[0] + number(i) : number(i);
        i += 1;
        lineTo([x, current[1]]);
        break;
      }
      case "V": {
        const y = relative ? current[1] + number(i) : number(i);
        i += 1;
        lineTo([current[0], y]);
        break;
      }
      case "C": {
        const control1 = endpoint(number(i), number(i + 1), relative);
        const control2 = endpoint(number(i + 2), number(i + 3), relative);
        const end = endpoint(number(i + 4), number(i + 5), relative);
        i += 6;
        cubicTo(control1, control2, end);
        break;
      }
      case "Z":
        closeContour();
        command = null;
        break;
      default:
        throw new Error(`${char}.svg uses unsupported path command ${command}`);
    }
  }
  if (contour) closeContour();
  if (!contours.length) throw new Error(`${char}.svg produced no contours`);
  return contours;
}

export function loadGlyphContours(char) {
  const geometry = svgGeometry(readFileSync(join(SOURCE_DIR, `${char}.svg`), "utf8"), char);
  return parsePath(geometry.d, geometry.translateX, geometry.translateY, char);
}

export function buildTraceSet() {
  return Object.fromEntries(
    [...CHARS].map((char) => [char, { char, contours: loadGlyphContours(char) }])
  );
}
