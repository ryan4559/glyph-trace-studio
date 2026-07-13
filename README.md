# Glyph Trace Studio — img-2-openscad

English | [繁體中文](README.zh-TW.md)

A pure-frontend glyph tracing studio: upload one or more reference images
(photos or scans of lettering, license plate sheets, signs, …), crop each
character into a clean binarized glyph, trace it with Bézier curves — by hand or with
the built-in auto-tracer — and export **SVG** and **OpenSCAD** files ready
for 3D modeling / printing.

Everything runs in the browser — no server, no build step, no dependencies.
Your images and traces are stored locally in your browser (IndexedDB) and
never leave your machine. On first load, the editor opens an editable bundled
example containing the official-specification 2012 glyph set; start a new
project whenever you want a blank workspace.

The repository also includes **`taiwan-plate.html`**, a Taiwan license-plate
keychain generator that previews all 36 official-specification 2012 glyphs
and builds six complete OpenSCAD models in the browser: three 1992-style
plate layouts and three new-style (新式, 2012+, 3-4) layouts. Every layout
uses the same 2012 glyph set under `taiwan-glyphs/`.

## Features (the editor, `index.html`)

- **Multiple reference images** — add several images at once or over time,
  switch between them from the toolbar, and safely remove unused ones. Every
  saved crop records its source image; selecting that glyph restores the
  correct image automatically. Large images are downscaled to 4096 px max.
- **Crop mode** — drag a fixed-size box over a character, choose foreground
  polarity (dark/light pixels) and threshold, and save a clean black-on-
  transparent glyph PNG. The box starts at the project width/height (in
  image px) and, once adjusted, carries over to the next character you
  select. An optional X offset (canvas px) shifts the glyph after its ink
  is centered, e.g. to center a `1` on its vertical stem instead of its
  full outline.
- **Trace mode** — draw closed Bézier contours over the glyph with full
  node/handle editing: insert points on segments, delete points, add holes
  (counters), reorder outer/hole contours, grid + rulers, zoom.
- **Auto trace** — a line/arc-decomposition tracer (`autotrace.js`) that
  reproduces hand-trace style by construction: straight runs with
  total-least-squares fits, axis snapping, sharp-corner recovery, concave
  fillets, axis-extrema node placement and Schneider cubic fitting. The
  *Roundness* setting (0–1) blends shoulder handles between the raster
  facets and ideal circular arcs. Results are staged for review; save to
  keep them.
- **Export** per glyph: `*.svg` (mm-sized, `fill-rule="evenodd"`), `*.scad`
  (an OpenSCAD module extruding the sampled polygon with holes subtracted),
  and the binarized `*.png`. Or grab everything at once as a ZIP (includes
  `traces.json` with the raw Bézier data).
- **Project files** — export/import a single JSON containing all reference
  images, their per-glyph crop associations, traces, and settings, so projects
  can be shared or backed up.
- **Configurable** character set (any Unicode characters), output size in mm
  (default 45 × 89 mm), and file/module name prefix.
- English / 繁體中文 UI.

## The Taiwan license-plate keychain generator (`taiwan-plate.html`)

- A specimen grid of all 36 glyphs (0–9, A–Z; 45 × 89 mm each), rendered
  live from **the editor's current traces** (the same in-browser project
  `index.html` edits) when it has a saved trace for every one of 0–9 A–Z;
  otherwise it falls back to the repo's `taiwan-glyphs/traces.json` (the
  footer says which source is active and which glyphs are still missing). Edit a glyph in the editor, refresh the
  page, and the specimen + downloads follow.
- One-click downloads of the three 1992-style license-plate keychain `.scad`
  models (car 320×150 2-4 with a Customizer dropdown for the 4-2 / 1234-AB
  format, normal heavy motorcycle 250×140 3-3, large heavy
  motorcycle 260×150 2-2), generated in the browser from the traces with
  all glyph modules embedded (`taiwan-plates.js`; geometry in its
  `SPECS` table).
- Each plate-number Customizer dropdown includes the 36 standard characters,
  `-`, and `空`. The selectable `-` is a centered square whose final size
  matches that model's fixed separator (9×9 or 10×10, with the same 3-unit
  depth).
- One-click downloads of the three new-style (新式, 2012+, the 3-4
  seven-character layout) plate models (car 380×160, motorcycle 260×140,
  large heavy motorcycle 300×150 with red/yellow plate selection), built
  from the same 2012 glyph traces on the new-style base: raised rim with recessed
  face, three plum-blossom anti-counterfeit marks (two recessed, one
  raised), round-ended screw slots and keychain hole (geometry in the
  `SPECS_2012` table).
- The `//` header comment block at the top of each file (author, link, source,
  and license) is editable, one comment per line; the original text is the
  default template. Generated plate models default to
  `License: CC-Attribution-ShareAlike`; this model-header choice is separate
  from the repository's MIT license and the government glyph-source license.
- Pre-generated glyph SVG/SCAD files live independently in
  `taiwan-glyphs/output/`; the plate-model outputs live in the corresponding
  `taiwan-1992/output/` and `taiwan-2012/output/` directories.

## Running

This is a static site — serve the repo root with any static server:

```
python3 -m http.server 8765        # then open http://localhost:8765/
```

or deploy it as-is (GitHub Pages: *Settings → Pages → Deploy from a
branch*, root folder). The editor is at `/`, the plate project page at
`/taiwan-plate.html`. A static server is required — the app is native ES
modules, which browsers refuse to load from `file://`.

## Bundled example project

On first load with an empty browser store, the editor probes for a
`project.json` next to it: `{app: "glyph-trace-studio-bundle", version,
settings, ref, sources, traces, glyphs}` — string values are fetched as
static files and the `{name}` placeholder in `glyphs` is filled per glyph.
This repository ships a manifest for the editable 2012 glyph example. It is
imported only when the browser store is empty, so existing work is never
overwritten. *Settings → Reload bundled project* restores the example on
demand, and *Settings → New project (clear)* opens an empty project.

## Data formats

- **Trace** (per glyph): a list of contours, each a list of nodes
  `{x, y, inX, inY, outX, outY}` (anchor plus incoming/outgoing cubic Bézier
  handles) in editing-canvas pixels (4 px per mm). The first contour is the
  outline; the rest are holes, rendered with `fill-rule="evenodd"`.
- **Project JSON (v2)**:
  `{app, version, settings, sources, traces, glyphs, images, activeImageId}`.
  `images` is an ordered list of `{id, name, dataUrl}` reference images;
  each entry in `sources` holds its `imageId` plus crop box, polarity,
  threshold and `offset_x`. `glyphs` holds the binarized PNGs as data URLs.
  Version 1 files with one `refImage` are migrated automatically on import.

## Layout

Everything is native ES modules; `package.json` only sets
`"type": "module"` for Node (no dependencies, nothing to install).

- `index.html` / `styles.css` — the editor's single-page UI.
- `app.js` — editor UI + orchestration (crop + trace modes, optional bundle
  loading, persistence); domain logic lives in the modules below.
- `project-schema.js` — the project-file format: defaults, resource caps,
  import sanitization, export payload.
- `glyph-contract.js` — naming (`charSlug`/`fileBase`/`moduleName`) and
  trace-set rules shared by the editor and the plate page.
- `scad-escape.js` — OpenSCAD string-literal escaping.
- `taiwan-plate.html` / `taiwan-plate.js` / `taiwan-plate.css` — the Taiwan
  license-plate page (reads the editor's IndexedDB project when all 36
  glyphs are traced, with `taiwan-glyphs/traces.json` as the 2012 fallback).
- `autotrace.js` — the auto-tracer (DOM-free; exact-parity tested against
  the original Python implementation). `autotrace-worker.js` runs it in a
  Web Worker so tracing never freezes the UI.
- `taiwan-plates.js` — license-plate keychain SCAD generation
  (`SPECS` geometry table for the 1992 plates, `SPECS_2012` for the
  new-style plates; both share the same generator and glyph modules).
- `exporters.js` — SVG/SCAD generation from Bézier traces, ZIP writer,
  download helpers.
- `storage.js` — small IndexedDB key/value wrapper.
- `taiwan-glyphs/` — independent 2012 glyph package: canonical cubic Bézier
  SVG paths in `source/`, browser fallback data in `traces.json`, and
  pre-generated `2012_<char>.svg`/`.scad` files in `output/`.
- `project.json` + `taiwan-glyphs/example/` — first-load bundled project:
  a 1632×1900 raster reference sheet with gutters, all 36 pixel-space crop boxes, and the
  shared 2012 traces.
- `taiwan-1992/output/` — the three pre-generated 1992-layout plate models;
  their embedded character modules are the 2012 glyphs.
- `taiwan-2012/output/` — the three pre-generated new-style plate models.
- `tools/build_taiwan_glyphs.mjs` — regenerates `taiwan-glyphs/traces.json`
  and all per-glyph outputs from `taiwan-glyphs/source/`.
- `tools/build_taiwan_plates.mjs` — regenerates all six plate models under
  `taiwan-1992/output/` and `taiwan-2012/output/` from
  `taiwan-glyphs/traces.json` (same output as the `taiwan-plate.html`
  downloads):
  ```
  node tools/build_taiwan_plates.mjs
  ```
- `tools/build_autotrace_fixtures.mjs` — deliberately rebuilds the autotrace
  golden fixtures from `taiwan-glyphs/source/`; it is not needed for normal
  development.
- `tools/tests/` — Node tests (stdlib only) plus fixtures built from those
  2012-style glyph traces; `npm test` runs all five, and CI
  (`.github/workflows/ci.yml`) runs them on every push:
  ```
  node tools/tests/test_autotrace.mjs        # autotrace regression fixtures, 72/72 exact
  node tools/tests/test_taiwan_glyphs.mjs    # source -> fallback -> per-glyph output parity
  node tools/tests/test_taiwan_plates.mjs    # byte-identical vs taiwan-1992/output/ + taiwan-2012/output/
  node tools/tests/test_project_schema.mjs   # project import sanitization / round-trip
  node tools/tests/test_glyph_contract.mjs   # cross-page naming + trace-set contract
  ```

## Using the exported files

- **SVG**: import into any vector tool, or in OpenSCAD:
  `linear_extrude(3) import("2012_A.svg", center = true);`
- **SCAD**: `use <2012_A.scad>` then call `glyph_2012_A(h = 3);` — the glyph
  is centered on the origin, sized in mm as configured.
- **Plate keychain models**: open in OpenSCAD and use the Customizer to set
  the plate number, colors, offsets, and size multiplier — the default 0.15
  is keychain size (~4–5 cm wide); 1 is a full-size plate.

## License & source material

- The app, tests, author-created 2012 traces, and generated SVG/SCAD files
  are released under [MIT](LICENSE), subject to the government-source
  attribution below.
- The binary glyph masks inside `tools/tests/fixtures/` are rasterized from
  the author's own `taiwan-glyphs/source/` traces of an official Taiwan government
  2012-style license-plate glyph specification. They no longer contain crops
  from the Wikimedia Commons 1992 reference image. The government source
  document is not distributed here.
- Government data source: [新式號牌使用之英文字、數字字體](https://ws.thb.gov.tw/001/Upload/OldFile/resource/html/doc/%E7%9B%A3%E7%90%86%E6%A5%AD%E5%8B%99/%E7%89%8C%E7%85%A7/3.%E6%96%B0%E5%BC%8F%E8%99%9F%E7%89%8C%E4%BD%BF%E7%94%A8%E4%B9%8B%E8%8B%B1%E6%96%87%E5%AD%97%E3%80%81%E6%95%B8%E5%AD%97%E5%AD%97%E9%AB%94.pdf),
  published by the Taiwan Highway Bureau, MOTC (formerly the Directorate
  General of Highways). The source is made available under the Bureau's
  [Open Government Data License 1.0 declaration](https://www.thb.gov.tw/cp.aspx?n=439).
  Users of these glyphs and derivatives should preserve this attribution.
- The bundled letterforms are exclusively the Taiwan new-style 2012 glyphs;
  the repository no longer distributes the former 1992-derived glyph set.
