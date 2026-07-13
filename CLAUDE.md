# img-2-openscad — Glyph Trace Studio (pure frontend)

Guidance for AI coding agents and human contributors working on this
repository.

A pure-frontend web app (no server, no build step): `index.html` is a
generic, blank-starting glyph tracing editor (image → crop → Bézier trace →
SVG/OpenSCAD), and `taiwan-plate.html` is a separate Taiwan license-plate
page (titled 台灣車牌鑰匙圈產生器) with 36 official-specification 2012
glyphs on a 45×89 mm canvas (180×356 px at 4 px/mm) and six OpenSCAD plate
customizer downloads generated from `taiwan-glyphs/traces.json`: three 1992
(原型式) layouts and three 新式 (2012 起, 3-4 七碼) layouts. Both layout eras
use the same 2012 glyph package; only layout and base geometry differ.

The app is a JavaScript port of the author's earlier private Python
pipeline (not part of this repository). Its regression fixtures use the
author's traces of the official Taiwan 2012-style glyph specification.
The checked-in fixtures are self-contained and can be deliberately rebuilt
from the tracked `taiwan-glyphs/source/` files.

## Running / testing

```
python3 -m http.server 8765     # a static server is required (native ES modules don't run from file://)
npm test                        # all five Node test scripts (stdlib only, no npm install needed)
node tools/tests/test_autotrace.mjs        # autotrace regression fixtures (72/72 exact)
node tools/tests/test_taiwan_glyphs.mjs    # canonical source -> fallback -> SVG/SCAD parity
node tools/tests/test_taiwan_plates.mjs    # plate SCAD byte-parity vs taiwan-1992/output/ + taiwan-2012/output/ + SCAD escaping
node tools/tests/test_project_schema.mjs   # project-file import sanitization / round-trip
node tools/tests/test_glyph_contract.mjs   # naming + trace-set contract shared by both pages
node tools/build_taiwan_glyphs.mjs         # regenerate fallback traces + per-glyph outputs
node tools/build_taiwan_plates.mjs         # regenerate both output dirs after SPECS/SPECS_2012 changes
node tools/build_autotrace_fixtures.mjs    # deliberately rebuild fixtures from taiwan-glyphs/source/
node --check app.js                        # after edits
```

Everything is native ES modules — `package.json` exists only for
`"type": "module"` (so Node parses them as ESM) and the `npm test` script;
there are no dependencies and nothing to install. CI
(`.github/workflows/ci.yml`) syntax-checks every module, runs `npm test`,
and verifies the committed plate outputs still match the generators.

The editor persists to IndexedDB and ships `project.json`, which seeds a
first-time visitor with the editable 2012 glyph example (1632×1900 raster
reference sheet, pixel-space crop boxes and traces) only when the browser
store is empty. The settings panel has "Reload bundled project" and "New
project (clear)" buttons, both two-click. Repo files are updated manually from app downloads
(ZIP export / per-glyph files) and from `taiwan-plate.html` (plate SCADs);
the plate SCADs can also be regenerated headlessly with
`node tools/build_taiwan_plates.mjs`.

Project files are schema v2 and support multiple reference images. IndexedDB
stores `images` as ordered `{id, name, blob}` records plus `activeImageId`;
each saved crop in `sources` carries its `imageId`. Exported JSON uses
`{id, name, dataUrl}` image records. Import and browser-store startup both
migrate the old v1 single `refImage` shape to one `legacy-ref` record. Keep
the source/image association intact: selecting a saved glyph restores its
image, and any bulk glyph re-render must load each source's own image.

## Layout

- `index.html`, `styles.css`, `app.js` — the single-page editor (crop mode,
  trace mode, previews, export, optional bundle loading, EN/繁中 i18n).
  app.js is UI + orchestration only; the domain logic lives in the pure
  modules below. No plate code here — that all lives in
  taiwan-plate.html/taiwan-plate.js/taiwan-plates.js.
- `project-schema.js` — the project-file format: `APP_ID`, default
  settings, resource caps (image count/bytes, project bytes, charset,
  contours, points), v1 single-image → v2 multi-image migration,
  `parseCharset`, the import sanitizers (`sanitizeImportedProject` — only
  `data:image/` URLs, charset-keyed maps, malformed entries dropped, caps
  reject the file) and `buildProjectPayload` for export. Pure functions;
  tested by test_project_schema.mjs.
- `glyph-contract.js` — the naming + trace-set rules shared by app.js and
  taiwan-plate.js: `charSlug`/`fileBase`/`moduleName`, `savedContours`
  (≥3 nodes), `missingChars`, `completeTraceSet` (all-or-nothing set for
  consumers that dispatch on every char). Tested by test_glyph_contract.mjs.
- `scad-escape.js` — `scadString()` OpenSCAD string-literal escaping.
- `taiwan-plate.html` + `taiwan-plate.js` + `taiwan-plate.css` — the Taiwan
  license-plate page: glyph specimen grid
  + six plate SCAD downloads (1992: 汽車/普通重機/大型重機; 新式 2012:
  汽車/機車/大型重機), all sharing a user-editable `//` header block (defaults to
  `Plates.DEFAULT_HEADER`). Glyph data source: the editor's IndexedDB
  project (settings + traces — same glyph-contract.js naming the editor
  uses) when it has a saved trace for every one of
  0-9 A-Z (the customizer dropdown offers all 36 standard characters plus
  `-` and `空`; a partial project would emit plates with silently missing
  standard glyphs), else
  `taiwan-glyphs/traces.json` with the fixed 45×89 mm / `glyph_2012_` constants; a
  footer line tells the user which source is active.
- `exporters.js` — SVG/SCAD text generation from Bézier traces + `fmt`
  (round-half-even, matches the original Python byte-for-byte), ZIP writer,
  download helpers.
- `autotrace.js` — the auto-tracer (line/arc decomposition; see
  "Auto-trace" below). DOM-free; its `_internals` export exists for the
  tests only. In the app it runs inside `autotrace-worker.js` (a module
  worker) so large masks can't freeze the UI; app.js falls back to a
  synchronous call when workers are unavailable.
- `taiwan-plates.js` — the six Taiwan plate customizer `.scad` generators,
  all built by the shared `buildPlateScad`. The 1992 geometry lives in its
  `SPECS` table (car 320×150 2-4 with 4 screw slots and a `format` block
  emitting a 格式 dropdown for the 4-2 / 1234-AB layout — cells 3/4 −15,
  dot +100, measured from the 1px=1mm reference image; normal heavy
  motorcycle 250×140 3-3, 白牌/綠牌 dropdown; large heavy motorcycle
  260×150 2-2, 紅牌/黃牌 dropdown; motorcycles have top slots only; all
  screw openings are 30×10 slots by design — do not change them to round
  holes; car + normal-heavy specs carry a `region` block emitting a
  地區標示 dropdown — 無/台灣省/台北市/高雄市/金門縣/連江縣/自訂 —
  rendered with OpenSCAD `text()` in Noto Sans TC (a MakerWorld built-in
  font; there are no CJK traces) centered in the top band; large-heavy
  plates never had region text, so that spec has no `region`). The 新式
  (2012 起, 3-4 七碼) geometry lives in `SPECS_2012` (car 380×160,
  motorcycle 260×140, large-heavy motorcycle 300×150 with 紅牌/黃牌
  dropdown, 紅牌 default; `baseStyle: "2012"` swaps in the new-style base —
  raised rim + recessed face + three 梅花 anti-counterfeit marks, 左右凹、
  中間凸 (the star-shaped pieces in the geometry are internal structure of
  the plum marks, not separate marks) — via `baseLines2012`; the same 2012
  glyph modules as the 1992 layouts, no `region`). The 2012 base geometry is
  transcribed 1:1 from the author's published MakerWorld 3+4 plate models
  (local copies live in the gitignored `ref/OpenSCAD/`) — keep it 1:1, do
  not simplify — including those models' round-ended screw slots (34×14
  car / 34×12 motorcycle full length); the 30×10 rule above is for the
  1992 `SPECS` only. The 2012 glyph layout (cells/dot/glyphHeight) was
  laid out for the traced typeface, not copied from those models.
- `storage.js` — IndexedDB key/value wrapper.
- `taiwan-glyphs/` — independent official-specification 2012 glyph package.
  `source/` holds the canonical cubic-Bézier SVG paths; `traces.json` is the
  browser fallback and common generator input; `output/` contains the 36
  pre-generated `2012_<char>.svg`/`.scad` pairs. Rebuild derived files with
  `tools/build_taiwan_glyphs.mjs`. Its `example/` subdirectory contains the
  generated 1632×1900 grayscale PNG sheet with 24px gutters and 36 crop boxes used by root
  `project.json`.
- `taiwan-1992/output/` — the three pre-generated 1992-layout plate models.
  They embed `glyph_2012_*` modules and are byte-checked by the plate test.
- `taiwan-2012/output/` — the three pre-generated `taiwan 2012 license
  plate(...).scad` models. Keep in sync with `SPECS_2012` + the traces;
  byte-checked by `test_taiwan_plates.mjs`.
- `ref/` — the author's local reference assets, **gitignored** (kept out
  for licensing; see README "License & source material"): plate reference
  images plus copies of the published new-style plate models
  (`ref/OpenSCAD/`). A fresh clone does not have this directory and
  nothing needs it to run, build, or test; it only matters for re-cropping
  glyphs and as the provenance of the `SPECS_2012` base geometry.
- `tools/tests/` — Node tests + the frozen `fixtures/`. The fixture masks
  are rasterized from `taiwan-glyphs/source/`, the author's
  official-specification 2012 glyph traces, not from the Wikimedia Commons
  1992 reference image. Rebuild
  them only deliberately with `tools/build_autotrace_fixtures.mjs`.

## Trace data format

Per glyph in `taiwan-glyphs/traces.json`: a list of contours, each a list of nodes
`{x, y, inX, inY, outX, outY}` (anchor + in/out Bézier handles) on the
180×356 canvas. First contour is the outline, the rest are holes
(`fill-rule="evenodd"`). The checked-in trace set is mechanically converted
from the SVG path commands in `taiwan-glyphs/source/`, preserving cubic
Bézier control points exactly. OpenSCAD polygons are sampled derived output.

## Auto-trace (autotrace.js)

Historical exact-parity port of the original Python tracer: raw pixel boundary →
resample at 0.5 px → maximal straight runs (TLS + bow test) → axis snap →
gentle chains → short flats dissolve → junctions classify as sharp corner /
concave fillet (FILLET_PULL edge extension) / curve region (two-scale
corner test, axis-extrema splits with hysteresis, Schneider fits with
locked end tangents) → `rounden` blends shoulder handles toward ideal arcs
(UI "Roundness", 0..1, default 0.5; at 0 the result follows the raster
facets too squarely on round letters like B/C). The port replicates
numpy/scipy semantics exactly (gaussian_filter1d truncate=4,
arange/searchsorted, unwrap, gradient, floor-modulo, Python slice
clamping) — keep it that way if you touch it, and re-run the parity test.
**Auto-trace overwrites the selected char's editing draft** (all trace
editing happens in per-char drafts; only "Save trace" commits to the
stored trace) — don't save it over a hand-traced glyph unless you mean
to.

## Conventions

- Keep traces faithful to the raster; nudge small spots rather than
  idealize/redraw ("prefer faithful trace over redraw").
- The editing canvas is settings-derived (`svgW/svgH` mm × 4 px/mm); the
  Taiwan package uses 45×89 mm, prefix `2012_`, module prefix
  `glyph_2012_`.
- No external dependencies anywhere (app or tests); Node's stdlib only.
- After changing exporters.js / taiwan-plates.js / autotrace.js /
  project-schema.js / glyph-contract.js, run `npm test`; after UI changes,
  `node --check app.js` and load both pages.
- Both pages ship a CSP `<meta>` that blocks every external request (and,
  on the plate page, inline scripts/styles) — keep new assets local and
  external, or extend the policy deliberately.
