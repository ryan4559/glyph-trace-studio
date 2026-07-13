# Taiwan 2012-style plate glyph sources

This directory contains the author's SVG traces of the 0–9 and A–Z
glyphs in [新式號牌使用之英文字、數字字體][source], published by the
Taiwan Directorate General of Highways, MOTC (now the Highway Bureau). They
are the canonical source for the bundled fallback traces, pre-generated glyph
files, and autotrace regression fixtures. They are not crops or traces of the
Wikimedia Commons 1992 plate image.

Run `node tools/build_taiwan_glyphs.mjs` from the repository root to rebuild
`taiwan-glyphs/traces.json` and `taiwan-glyphs/output/`. Run
`node tools/build_autotrace_fixtures.mjs` to rasterize the SVG paths to
180×356 binary masks and deliberately refresh the accepted autotrace outputs.

The SVG paths retain the original cubic Bézier controls and are the canonical
representation; OpenSCAD polygons are sampled derived output. The author's SVG
trace files and generated fixtures are released with this
project under the repository's MIT license. The source document is used under
the Highway Bureau's [Open Government Data License 1.0 declaration][ogdl];
the required attribution is:

> Data provider: 交通部公路局（原交通部公路總局）. Source: 「新式號牌使用之
> 英文字、數字字體」. This open data is made available under the Open
> Government Data License, version 1.0.

The original government PDF is linked but not redistributed here.

[source]: https://ws.thb.gov.tw/001/Upload/OldFile/resource/html/doc/%E7%9B%A3%E7%90%86%E6%A5%AD%E5%8B%99/%E7%89%8C%E7%85%A7/3.%E6%96%B0%E5%BC%8F%E8%99%9F%E7%89%8C%E4%BD%BF%E7%94%A8%E4%B9%8B%E8%8B%B1%E6%96%87%E5%AD%97%E3%80%81%E6%95%B8%E5%AD%97%E5%AD%97%E9%AB%94.pdf
[ogdl]: https://www.thb.gov.tw/cp.aspx?n=439
