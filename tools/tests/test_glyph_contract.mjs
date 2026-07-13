// Unit tests for glyph-contract.js — the naming + trace-set rules shared by
// the editor (app.js) and the plate page (taiwan-plate.js): charSlug /
// fileBase / moduleName, saved-contour filtering, and the full-set contract
// the plate customizer relies on.
//
//   node tools/tests/test_glyph_contract.mjs
import {
  charSlug,
  fileBase,
  moduleName,
  savedContours,
  missingChars,
  completeTraceSet,
} from "../../glyph-contract.js";

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// --- naming ---
check("charSlug A", charSlug("A") === "A");
check("charSlug 7", charSlug("7") === "7");
check("charSlug lowercase", charSlug("a") === "a_low");
check("charSlug CJK", charSlug("中") === "u4E2D");
check("charSlug quote", charSlug('"') === "u22");
check("charSlug astral (surrogate pair)", charSlug("😀") === "u1F600");

const plateSettings = { prefix: "2012_", modulePrefix: "glyph_2012_" };
check("fileBase uses file prefix", fileBase(plateSettings, "A") === "2012_A");
check("moduleName prefers modulePrefix", moduleName(plateSettings, "A") === "glyph_2012_A");
check(
  "moduleName sanitizes to a SCAD identifier",
  moduleName({ prefix: "my plate-" }, "A") === "my_plate_A"
);
check("moduleName never starts with a digit", /^[A-Za-z_]/.test(moduleName({ prefix: "1" }, "2")));
check(
  "fileBase strips filesystem-hostile chars",
  fileBase({ prefix: "a/b\\c:" }, "A") === "a_b_c_A"
);

// The plate page and the shipped .scad files must agree on module names for
// every plate character (dispatch lines reference glyph_2012_<char>).
check(
  "36-glyph module names match the shipped plates",
  [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].every(
    (char) => moduleName(plateSettings, char) === `glyph_2012_${char}`
  )
);

// --- trace-set contract ---
const tri = [
  { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 },
  { x: 1, y: 0, inX: 1, inY: 0, outX: 1, outY: 0 },
  { x: 0, y: 1, inX: 0, inY: 1, outX: 0, outY: 1 },
];
const traces = {
  A: { char: "A", contours: [tri, tri] },
  B: { char: "B", contours: [[tri[0], tri[1]]] }, // degenerate: <3 nodes
  C: { char: "C", contours: [] },
};

check("savedContours keeps full contours", savedContours(traces, "A").length === 2);
check("savedContours drops degenerate contours", savedContours(traces, "B").length === 0);
check("savedContours on missing char", savedContours(traces, "Z").length === 0);
check("savedContours tolerates null traces", savedContours(null, "A").length === 0);

check(
  "missingChars lists untraced + degenerate",
  missingChars(traces, ["A", "B", "C", "D"]).join("") === "BCD"
);
check("completeTraceSet rejects a partial set", completeTraceSet(traces, ["A", "B"]) === null);
{
  const complete = completeTraceSet(traces, ["A"]);
  check("completeTraceSet returns filtered traces", complete?.A.contours.length === 2);
}
{
  const full = { A: traces.A, B: { char: "B", contours: [tri, [tri[0], tri[1]]] } };
  const complete = completeTraceSet(full, ["A", "B"]);
  check(
    "completeTraceSet filters degenerate contours from kept glyphs",
    complete?.B.contours.length === 1
  );
}

console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
