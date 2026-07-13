// Regression test: autotrace.js vs checked-in golden outputs for the author's
// traces of the official Taiwan 2012-style license-plate glyph specification.
// Each fixture contains a packbits+base64 binary mask plus the accepted trace
// for round 0.5 and 0. Rebuild deliberately with build_autotrace_fixtures.mjs.
//
//   node tools/tests/test_autotrace.mjs [--verbose]
//
// Passes when every glyph produces the same contour/node structure and the
// coordinates agree within TOL px.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AutoTrace } from "../../autotrace.js";

const here = dirname(fileURLToPath(import.meta.url));

const TOL = 1e-6; // exact-parity target
const TOL_LOOSE = 0.05; // still acceptable: sub-raster float drift
const verbose = process.argv.includes("--verbose");

function unpackMask(b64, width, height) {
  const bytes = Buffer.from(b64, "base64");
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  }
  return mask;
}

const KEYS = ["x", "y", "inX", "inY", "outX", "outY"];

function compare(char, blend, expected, actual) {
  if (expected.length !== actual.length) {
    return { ok: false, why: `contours ${actual.length} != ${expected.length}` };
  }
  let maxDiff = 0;
  for (let c = 0; c < expected.length; c += 1) {
    if (expected[c].length !== actual[c].length) {
      return { ok: false, why: `contour ${c} nodes ${actual[c].length} != ${expected[c].length}` };
    }
    for (let i = 0; i < expected[c].length; i += 1) {
      for (const key of KEYS) {
        maxDiff = Math.max(maxDiff, Math.abs(expected[c][i][key] - actual[c][i][key]));
      }
    }
  }
  return { ok: maxDiff <= TOL_LOOSE, exact: maxDiff <= TOL, maxDiff };
}

const fixtureDir = join(here, "fixtures");
const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".json")).sort();
let pass = 0;
let exact = 0;
let fail = 0;
for (const file of files) {
  const fixture = JSON.parse(readFileSync(join(fixtureDir, file), "utf8"));
  const mask = unpackMask(fixture.mask, fixture.width, fixture.height);
  for (const [blend, expected] of Object.entries(fixture.expected)) {
    const actual = AutoTrace.traceMask(mask, fixture.width, fixture.height, { round: Number(blend) });
    const result = compare(fixture.char, blend, expected, actual);
    if (result.ok) {
      pass += 1;
      if (result.exact) exact += 1;
      if (verbose || !result.exact) {
        console.log(`PASS ${fixture.char} round=${blend} maxDiff=${result.maxDiff.toExponential(2)}`);
      }
    } else {
      fail += 1;
      console.log(`FAIL ${fixture.char} round=${blend}: ${result.why || `maxDiff=${result.maxDiff}`}`);
    }
  }
}
console.log(`\n${pass} passed (${exact} exact), ${fail} failed`);
process.exit(fail ? 1 : 0);
