import { Exporters } from "./exporters.js";
import { scadString } from "./scad-escape.js";

// Taiwan license-plate customizer .scad generation. The 1992 (原型式)
// generators preserve the original plate geometry; the 新式 (2012, 3-4 七碼)
// generators reuse the same machinery with the new-style base. All plate
// geometry lives in SPECS (1992) and SPECS_2012. Both eras use the official-
// specification 2012 glyph set bundled under taiwan-glyphs/. Generated output
// parity is checked by tools/tests/test_taiwan_plates.mjs.
export const Plates = (() => {
  const X = Exporters;

  const CHAR_OPTIONS =
    '["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","-","1","2","3","4","5","6","7","8","9","0","空"]';
  const CJK_ORDINALS = "一二三四五六七";
  const REGION_OPTIONS = '["無","台灣省","台北市","高雄市","金門縣","連江縣","自訂"]';

  // Default header comment block (emitted as "// <line>"); the UI lets the
  // user replace it, passing custom lines via opts.headerComments.
  const DEFAULT_HEADER = [
    "Author: https://makerworld.com/@Ryanooo",
    "Link: https://makerworld.com/models/",
    "Inspired by: https://makerworld.com/models/70954#profileId-75209",
    "License: CC-Attribution-ShareAlike",
  ];

  const SPECS = [
    {
      filename: "taiwan 1992 license plate(car).scad",
      label: "汽車（2-4 / 4-2）",
      title: "Taiwan ROC 1992 (民國81年) 式 320×150 汽車號牌 (非營業小型車, 2-4 / 4-2)",
      notes: [],
      plateW: 320,
      plateH: 150,
      cornerR: 15,
      glyphHeight: 90,
      cells: [5, 55, 120, 170, 220, 270],
      cellSlider: [5, 1, 275],
      dotW: 10,
      dotH: 10,
      dotOffset: 105,
      dotSlider: [5, 1, 310],
      dotBottomY: 64,
      glyphCenterY: 69,
      holeStyle: "slot",
      holeCenters: [
        [65, 135],
        [255, 135],
        [65, 15],
        [255, 15],
      ],
      region: {
        centerX: 160,
        centerY: 132,
        height: 18,
        spacing: 1.8,
        xSlider: [0, 1, 320],
        ySlider: [0, 1, 150],
        hSlider: [8, 0.5, 40],
        comment: "地區中心距底邊 (mm)",
      },
      defaultNumber: "AB1234",
      // 兩碼結尾 (4-2, 約民國91年起) 格式: 分隔點空隙移到第四/五碼之間,
      // 其餘與 2-4 相同 (垂直位置不變). altCells/altDotOffset 依 1px=1mm
      // 參考圖的 4-2 車牌實測; 同圖量測的 2-4 車牌與 cells/dotOffset
      // 完全一致. SCAD 內偏移滑桿維持 2-4 基準值, 4-2 以條件位移套用.
      format: {
        comment: "格式 (AB-1234: 兩碼開頭 2-4; 1234-AB: 兩碼結尾 4-2, 第三/四碼與分隔點自動位移)",
        shiftComment: "依格式位移第三/四碼與分隔點 (1234-AB 依參考圖實測: 第三/四碼 105/155, 分隔點 205)",
        options: ["AB-1234", "1234-AB"],
        altCells: [5, 55, 105, 155, 220, 270],
        altDotOffset: 205,
      },
      plateColor: "#FFFFFF",
      textColor: "#000000",
      plateTypes: null,
      layoutComments: {
        size: "車牌參數 (實牌尺寸 320×150, 圓角半徑 15)",
        center: "字排中心距底邊 69mm (實牌字排偏下, 上緣原為地區標示帶)",
        dot: "分隔點 10×10, 底邊距底 64mm (與字排垂直置中)",
        multiply: "尺寸倍數 (1倍寬為32cm)",
        holes_top: "上排螺絲孔槽 (30×10, 中心 x=65/255, 距頂邊15)",
        holes_bottom: "下排螺絲孔槽 (30×10, 中心 x=65/255, 距底邊15)",
      },
    },
    {
      filename: "taiwan 1992 license plate(normal heavy motorcycle).scad",
      label: "普通重機（3-3）",
      title: "Taiwan ROC 1992 (原型式) 250×140 普通重型機車號牌 (3-3)",
      notes: [],
      plateW: 250,
      plateH: 140,
      cornerR: 15,
      glyphHeight: 62,
      cells: [11.5, 48, 84.5, 134.5, 171, 207],
      cellSlider: [5, 0.5, 218],
      dotW: 9,
      dotH: 9,
      dotOffset: 120.5,
      dotSlider: [5, 0.5, 240],
      dotBottomY: 53,
      glyphCenterY: 57.5,
      holeStyle: "slot",
      holeCenters: [
        [55, 122.5],
        [195, 122.5],
      ],
      region: {
        centerX: 125,
        centerY: 116.5,
        height: 16,
        spacing: 1.35,
        xSlider: [0, 0.5, 250],
        ySlider: [0, 0.5, 140],
        hSlider: [8, 0.5, 40],
        comment: "地區中心距底邊 (mm)",
      },
      defaultNumber: "ABC123",
      // 綠牌色取自參考圖的綠底車牌 (純 #008000)
      plateColor: "#FFFFFF",
      textColor: "#000000",
      plateTypes: [
        ["白牌", "#FFFFFF", "#000000"],
        ["綠牌", "#008000", "#FFFFFF"],
      ],
      layoutComments: {
        size: "車牌參數 (實牌尺寸 250×140; 圓角半徑 15)",
        center: "字排中心距底邊 57.5mm (依參考圖實測; 上緣原為地區標示帶)",
        dot: "分隔點 9×9 (依參考圖實測約字高14%), 與字排垂直置中",
        multiply: "尺寸倍數 (1倍寬為25cm)",
        holes_top: "螺絲孔槽僅上排 (30×10, 中心 x=55/195, 中心距頂邊17.5, 依參考圖實測)",
      },
    },
    {
      filename: "taiwan 1992 license plate(large heavy motorcycle).scad",
      label: "大型重機（2-2）",
      title: "Taiwan ROC 1992 (原型式) 260×150 大型重型機車號牌 (2-2)",
      notes: [],
      plateW: 260,
      plateH: 150,
      cornerR: 15,
      glyphHeight: 92,
      cells: [14.5, 68.5, 144.5, 198.5],
      cellSlider: [5, 0.5, 213],
      dotW: 10,
      dotH: 10,
      dotOffset: 125,
      dotSlider: [5, 0.5, 245],
      dotBottomY: 65,
      glyphCenterY: 70,
      holeStyle: "slot",
      holeCenters: [
        [59.5, 131],
        [200.5, 131],
      ],
      defaultNumber: "AB12",
      plateColor: "#FF0000",
      textColor: "#FFFFFF",
      plateTypes: [
        ["紅牌", "#FF0000", "#FFFFFF"],
        ["黃牌", "#FFFF00", "#000000"],
      ],
      layoutComments: {
        size: "車牌參數 (實牌尺寸 260×150; 圓角半徑 15)",
        center: "字排中心距底邊 70mm (依參考圖實測)",
        dot: "分隔點 10×10 (同汽車牌), 與字排垂直置中",
        multiply: "尺寸倍數 (1倍寬為26cm)",
        holes_top: "螺絲孔槽僅上排 (30×10, 中心 x=59.5/200.5, 中心距頂邊19, 依參考圖實測)",
      },
    },
  ];

  // 新式 (2012/民國101年起, 3-4 七碼) plate specs — same buildPlateScad
  // machinery and the shared official-specification 2012 glyph set; only
  // layout + base differ. Base geometry (raised rim with a
  // recessed face, three 梅花 anti-counterfeit marks — 左右凹、中間凸 —
  // and round-ended screw slots at their original dimensions, wider than the
  // 1992 30×10 slots) is transcribed 1:1 from the author's published
  // MakerWorld 3+4 customizers (car / motorcycle). The 300x150
  // large-heavy layout comes from the government comparison table and
  // screw-hole diagram (69-22-118-22-69 horizontal chain; official
  // 字體 65×32 mm per the table's note 3, which the 45×89 typeface matches
  // at glyphHeight 65 → width 32.9).
  const SPECS_2012 = [
    {
      filename: "taiwan 2012 license plate(car).scad",
      label: "汽車",
      title: "Taiwan 新式 (2012/民國101年起) 380×160 汽車號牌 (3-4 七碼)",
      notes: [],
      baseStyle: "2012",
      plateW: 380,
      plateH: 160,
      cornerR: 15,
      glyphHeight: 89,
      cells: [10, 60, 110, 175, 225, 275, 325],
      cellSlider: [5, 1, 335],
      dotW: 10,
      dotH: 10,
      dotOffset: 160,
      dotSlider: [5, 1, 370],
      dotBottomY: 69.5,
      glyphCenterY: 74.5,
      recessInset: 5,
      recessR: 10,
      // [corner x, corner y, straight length, width, end radius] as in the
      // reference model (slot full length = length + 2 * radius).
      holes2012: [
        [85, 135, 20, 14, 7],
        [275, 135, 20, 14, 7],
      ],
      marks: { xs: [95, 190, 285], y: 17, plumR: 4.5, plumH: 3, starLen: 10, starW: 2 },
      defaultNumber: "ABC5678",
      plateColor: "#FFFFFF",
      textColor: "#000000",
      plateTypes: null,
      // 電動車字樣 (新版電動車專屬號牌樣式, is_ev_text 核取方塊): 白底
      // 黑字、無綠帶, 上緣中央加註「電動車」三字, 字間寬字距, 與螺絲孔槽
      // 同列. 依實車參考照
      // (以螺絲孔距 190mm 校準): 字墨高約 22mm (Noto Sans TC 墨高約等於
      // size, 取 22), 字心距約 55mm (spacing 1.8), 字列中心距底邊約
      // 142mm.「電動車」無 CJK 字模, 同 1992 地區標示以 Noto Sans TC
      // text() 置中.
      ev: {
        textColor: "#000000",
        font: "Noto Sans TC:style=Bold",
        textHeight: 22,
        textSpacing: 1.8,
        textCenterX: 190,
        textCenterY: 142,
      },
      layoutComments: {
        size: "車牌參數 (實牌尺寸 380×160, 圓角半徑 15)",
        center: "字排中心距底邊 74.5mm (依原 3-4 模型版面)",
        dot: "分隔點 10×10, 底邊距底 69.5mm (與字排垂直置中)",
        multiply: "尺寸倍數 (1倍寬為38cm)",
        holes: "螺絲孔槽 (圓端全長 34×14, 中心 x=95/285, 中心距頂邊 18, 依原模型)",
      },
    },
    {
      filename: "taiwan 2012 license plate(motorcycle).scad",
      label: "機車",
      title: "Taiwan 新式 (2012/民國101年起) 260×140 機車號牌 (3-4 七碼)",
      notes: [],
      baseStyle: "2012",
      plateW: 260,
      plateH: 140,
      cornerR: 15,
      glyphHeight: 58,
      cells: [8, 41, 74, 124, 157, 190, 223],
      cellSlider: [5, 0.5, 230.5],
      dotW: 9,
      dotH: 9,
      dotOffset: 109,
      dotSlider: [5, 0.5, 250],
      dotBottomY: 65.5,
      glyphCenterY: 70,
      recessInset: 5,
      recessR: 10,
      holes2012: [
        [49, 116, 22, 12, 6],
        [189, 116, 22, 12, 6],
      ],
      marks: { xs: [40, 130, 220], y: 17, plumR: 4.5, plumH: 3, starLen: 10, starW: 2 },
      defaultNumber: "MBH5678",
      plateColor: "#FFFFFF",
      textColor: "#000000",
      plateTypes: null,
      layoutComments: {
        size: "車牌參數 (實牌尺寸 260×140, 圓角半徑 15)",
        center: "字排中心距底邊 70mm (垂直置中)",
        dot: "分隔點 9×9, 與字排垂直置中",
        multiply: "尺寸倍數 (1倍寬為26cm)",
        holes: "螺絲孔槽 (圓端全長 34×12, 中心 x=60/200, 中心距頂邊 18, 依原模型)",
      },
    },
    {
      filename: "taiwan 2012 license plate(large heavy motorcycle).scad",
      label: "大型重機",
      title: "Taiwan 新式 (2012/民國101年起) 300×150 大型重型機車號牌 (3-4 七碼)",
      notes: [],
      baseStyle: "2012",
      plateW: 300,
      plateH: 150,
      cornerR: 15,
      glyphHeight: 65,
      cells: [10, 48, 86, 143, 181, 219, 257],
      cellSlider: [5, 0.5, 267],
      dotW: 9,
      dotH: 9,
      dotOffset: 127,
      dotSlider: [5, 0.5, 290],
      dotBottomY: 69.5,
      glyphCenterY: 74,
      recessInset: 5,
      recessR: 10,
      holes2012: [
        [69, 126, 22, 12, 6],
        [209, 126, 22, 12, 6],
      ],
      marks: { xs: [55, 150, 245], y: 17, plumR: 4.5, plumH: 3, starLen: 10, starW: 2 },
      defaultNumber: "LGA5678",
      plateColor: "#FF0000",
      textColor: "#FFFFFF",
      plateTypes: [
        ["紅牌", "#FF0000", "#FFFFFF"],
        ["黃牌", "#FFFF00", "#000000"],
      ],
      layoutComments: {
        size: "車牌參數 (實牌尺寸 300×150, 圓角半徑 15)",
        center: "字排中心距底邊 74mm (依 300×150 參考圖; 官方字體 65×32)",
        dot: "分隔點 9×9, 與字排垂直置中",
        multiply: "尺寸倍數 (1倍寬為30cm)",
        holes: "螺絲孔槽 (圓端全長 34×12, 中心 x=80/220, 中心距頂邊 18, 依 300×150 參考圖)",
      },
    },
  ];

  // Python f"{value:g}" for the short decimals used in SPECS.
  function num(value) {
    return String(value);
  }

  function slider(rng) {
    return `[${num(rng[0])}:${num(rng[1])}:${num(rng[2])}]`;
  }

  // Per-cell / dot deltas of the spec's alternate format (spec.format)
  // relative to the primary layout the sliders default to; cells maps
  // 1-based cell index -> shift, holding only the cells that move.
  function formatShifts(spec) {
    const cells = new Map();
    if (!spec.format) return { cells, dot: 0 };
    spec.format.altCells.forEach((x, i) => {
      if (x !== spec.cells[i]) cells.set(i + 1, x - spec.cells[i]);
    });
    return { cells, dot: spec.format.altDotOffset - spec.dotOffset };
  }

  // opts: { chars, moduleName(char), sampleOpts(char) } supplied by the app —
  // sampleOpts feeds Exporters.sampleContour (canvas px -> centered mm).
  function glyphModuleLines(char, contours, opts) {
    const name = opts.moduleName(char);
    const polygons = contours.map((contour) => X.sampleContour(contour, opts.sampleOpts(char)));
    const lines = [`module ${name}(h = 3) {`, "    difference() {"];
    lines.push("        linear_extrude(height = h)");
    lines.push("        offset(delta = glyph_outline_offset)");
    lines.push(`        polygon(points = ${X.scadPoints(polygons[0])});`);
    for (const hole of polygons.slice(1)) {
      lines.push("        translate([0, 0, -fudge])");
      lines.push("        linear_extrude(height = h + 2 * fudge)");
      lines.push("        offset(delta = -glyph_outline_offset)");
      lines.push(`        polygon(points = ${X.scadPoints(hole)});`);
    }
    lines.push("    }", "}");
    return lines;
  }

  function headerLines(spec, opts) {
    const lines = [`// ${spec.title}`];
    for (const note of spec.notes) lines.push(`// ${note}`);
    for (const line of opts.headerComments || DEFAULT_HEADER) {
      lines.push(line ? `// ${line}` : "//");
    }
    lines.push(
      "",
      "/* [建議設置] */",
      "// 牆生成器: Arachne",
      'wall_generator = "Arachne";',
      "// 牆層數: 3",
      "wall_loops = 3;",
      "// 底部殼體層數: 5",
      "bottom_shell_layers = 5;",
      "",
      "/* [車牌號碼] */"
    );
    for (let i = 1; i <= spec.defaultNumber.length; i += 1) {
      const char = spec.defaultNumber[i - 1];
      lines.push(`// 第${CJK_ORDINALS[i - 1]}碼`);
      lines.push(`plate_number_${i} = "${char}"; // ${CHAR_OPTIONS}`);
    }
    if (spec.format) {
      const options = spec.format.options.map((label) => `"${label}"`).join(",");
      lines.push(
        `// ${spec.format.comment}`,
        `plate_format = "${spec.format.options[0]}"; // [${options}]`
      );
    }
    if (spec.plateTypes) {
      const labels = spec.plateTypes.map(([label]) => label);
      const options = labels
        .concat(["自訂"])
        .map((label) => `"${label}"`)
        .join(",");
      const descriptions = spec.plateTypes.map(([label, pc, tc]) => `${label}: 底${pc} 字${tc}`).join("; ");
      lines.push(
        `// 牌別 (${descriptions}; 自訂: 使用下方顏色)`,
        `plate_type = "${labels[0]}"; // [${options}]`,
        "// 自訂號碼顏色 (牌別選「自訂」時生效)",
        `custom_text_color = "${spec.textColor}";`,
        "// 自訂底板顏色 (牌別選「自訂」時生效)",
        `custom_plate_color = "${spec.plateColor}";`
      );
    } else {
      lines.push(
        "// 號碼顏色",
        `text_color = "${spec.textColor}";`,
        "// 底板顏色",
        `plate_color = "${spec.plateColor}";`
      );
    }
    if (spec.region) {
      lines.push(
        "",
        "/* [地區標示] */",
        "// 地區 (無: 不顯示; 自訂: 使用下方自訂文字)",
        `region = "無"; // ${REGION_OPTIONS}`,
        "// 自訂地區文字 (地區選「自訂」時生效)",
        'custom_region = "";',
        "// 地區字型",
        'region_font = "Noto Sans TC:style=Bold";',
        "// 地區字高",
        `region_height = ${num(spec.region.height)}; // ${slider(spec.region.hSlider)}`,
        "// 地區字距 (字距倍數)",
        `region_spacing = ${num(spec.region.spacing)}; // [1:0.05:3]`,
        "// 地區中心 X (mm)",
        `region_center_x = ${num(spec.region.centerX)}; // ${slider(spec.region.xSlider)}`,
        `// ${spec.region.comment}`,
        `region_center_y = ${num(spec.region.centerY)}; // ${slider(spec.region.ySlider)}`
      );
    }
    if (spec.ev) {
      lines.push(
        "",
        "/* [電動車] */",
        "// 是否加註電動車字樣 (電動車專屬號牌樣式)",
        "is_ev_text = false;",
        "// 電動車字樣顏色 (勾選加註時生效)",
        `ev_text_color = "${spec.ev.textColor}";`,
        "// 電動車字樣字型",
        `ev_font = "${spec.ev.font}";`,
        "// 電動車字樣字高",
        `ev_text_height = ${num(spec.ev.textHeight)}; // [8:0.5:28]`,
        "// 電動車字樣字距 (字距倍數)",
        `ev_text_spacing = ${num(spec.ev.textSpacing)}; // [1:0.05:4]`
      );
    }
    lines.push("", "/* [文字偏移] */");
    for (let i = 1; i <= spec.cells.length; i += 1) {
      lines.push(`// 第${CJK_ORDINALS[i - 1]}碼`);
      lines.push(`number_${i}_offset = ${num(spec.cells[i - 1])}; // ${slider(spec.cellSlider)}`);
    }
    lines.push(
      "// 分隔點",
      `dot_offset = ${num(spec.dotOffset)}; // ${slider(spec.dotSlider)}`,
      "",
      "/* [鑰匙圈] */",
      "// 是否要鑰匙圈打孔",
      "is_keychain_hole = true;",
      "// 孔半徑 (mm)",
      "hole_radius = 1.05; // [1:0.01:1.5]",
      "// 鑰匙孔 X 偏移",
      "hole_x = 0; // [-0.8:0.05:5]",
      "// 鑰匙孔 Y 偏移 (向下為正)",
      "hole_y = 0; // [-0.8:0.05:2]",
      "",
      "/* [尺寸] */",
      `// ${spec.layoutComments.multiply}`,
      "multiply = 0.15; // 0.01",
      "// 字體輪廓內縮 (改善字體過粗)",
      "glyph_outline_offset = -0.5; // 0.1",
      "",
      "/* [Hidden] */",
      "fudge = 0.1;",
      ""
    );
    if (spec.format) {
      const shifts = formatShifts(spec);
      const alt = spec.format.options[1];
      lines.push(`// ${spec.format.shiftComment}`);
      for (const [i, d] of shifts.cells) {
        lines.push(`number_${i}_shift = plate_format == "${alt}" ? ${num(d)} : 0;`);
      }
      if (shifts.dot) {
        lines.push(`dot_shift = plate_format == "${alt}" ? ${num(shifts.dot)} : 0;`);
      }
      lines.push("");
    }
    if (spec.plateTypes) {
      const textExpr = spec.plateTypes.map(([label, , tc]) => `plate_type == "${label}" ? "${tc}" :`).join(" ");
      const plateExpr = spec.plateTypes.map(([label, pc]) => `plate_type == "${label}" ? "${pc}" :`).join(" ");
      lines.push(
        "// 依牌別決定顏色",
        `text_color = ${textExpr} custom_text_color;`,
        `plate_color = ${plateExpr} custom_plate_color;`,
        ""
      );
    }
    if (spec.region) {
      lines.push(
        "// 地區標示文字 (「無」時不放置)",
        'region_text = region == "自訂" ? custom_region : region == "無" ? "" : region;',
        ""
      );
    }
    lines.push(
      `// ${spec.layoutComments.size}`,
      `plate_length = ${num(spec.plateW)} * multiply;`,
      `plate_width = ${num(spec.plateH)} * multiply;`,
      "plate_height = 15 * multiply;",
      `plate_radius = ${num(spec.cornerR)} * multiply;`,
      "// 字模高出凹版面的厚度",
      "glyph_depth = 3 * multiply;",
      `// 字高 (mm); 字模自 ${num(opts.svgW)}×${num(opts.svgH)} 原始畫布等比縮放`,
      `glyph_height = ${num(spec.glyphHeight)};`,
      `glyph_scale = glyph_height / ${num(opts.svgH)};`,
      `glyph_w = ${num(opts.svgW)} * glyph_scale;`,
      `// ${spec.layoutComments.center}`,
      `glyph_center_y = ${num(spec.glyphCenterY)};`,
      `// ${spec.layoutComments.dot}`,
      `dot_w = ${num(spec.dotW)};`,
      `dot_h = ${num(spec.dotH)};`,
      `dot_bottom_y = ${num(spec.dotBottomY)};`
    );
    return lines;
  }

  function placementLines(spec) {
    const lines = [];
    const shifts = formatShifts(spec);
    for (let i = 1; i <= spec.cells.length; i += 1) {
      const shift = shifts.cells.has(i) ? ` + number_${i}_shift` : "";
      lines.push(
        `// 第${CJK_ORDINALS[i - 1]}碼`,
        "color(text_color)",
        `translate([(number_${i}_offset${shift} + glyph_w / 2) * multiply, glyph_center_y * multiply, plate_height - glyph_depth])`,
        "scale([multiply * glyph_scale, multiply * glyph_scale, multiply])",
        `glyph_by_char(plate_number_${i});`,
        ""
      );
    }
    lines.push(
      "// 分隔點",
      "color(text_color)",
      `translate([${shifts.dot ? "(dot_offset + dot_shift)" : "dot_offset"} * multiply, dot_bottom_y * multiply, plate_height - glyph_depth])`,
      "cube([dot_w * multiply, dot_h * multiply, glyph_depth]);",
      ""
    );
    if (spec.region) {
      lines.push(
        '// 地區標示; halign="center" 置中的是含尾端字距的總 advance 寬',
        "// (advance = size/0.72), 右移 (spacing-1)*height/1.44 使墨面真正置中",
        'if (region_text != "")',
        "color(text_color)",
        "translate([(region_center_x + (region_spacing - 1) * region_height / 1.44) * multiply, region_center_y * multiply, plate_height - glyph_depth])",
        "linear_extrude(height = glyph_depth)",
        'text(region_text, size = region_height * multiply, font = region_font, spacing = region_spacing, halign = "center", valign = "center");',
        ""
      );
    }
    lines.push(
      "// 底板",
      "base(plate_length, plate_width, plate_height, plate_radius);"
    );
    return lines;
  }

  function holeLines(spec) {
    const lines = [];
    const top = spec.holeCenters.filter((c) => c[1] > spec.plateH / 2);
    const bottom = spec.holeCenters.filter((c) => c[1] <= spec.plateH / 2);
    for (const [label, centers] of [
      ["holes_top", top],
      ["holes_bottom", bottom],
    ]) {
      if (!centers.length) continue;
      lines.push(`        // ${spec.layoutComments[label]}`);
      for (const [cx, cy] of centers) {
        if (spec.holeStyle === "slot") {
          lines.push(`        translate([${num(cx - 10)} * multiply, ${num(cy - 5)} * multiply, 0])`);
          lines.push("        rounded_rectangle_hole(20 * multiply, 10 * multiply, height, 5 * multiply);");
        } else {
          lines.push(`        translate([${num(cx)} * multiply, ${num(cy)} * multiply, 0])`);
          lines.push("        cylinder(h=height, r=5 * multiply, $fn=32);");
        }
      }
      lines.push("");
    }
    return lines;
  }

  // 新式 (2012) base: raised rim + recessed face + three 梅花
  // anti-counterfeit marks (左右凹、中間凸 — the star-shaped pieces are
  // internal structure of the plum marks, not separate marks), transcribed
  // 1:1 from the author's published MakerWorld 3+4 models.
  function baseLines2012(spec) {
    const marks = spec.marks;
    const recessW = spec.plateW - 2 * spec.recessInset;
    const recessH = spec.plateH - 2 * spec.recessInset;
    const lines = [
      "module rounded_rectangle(length, width, height, radius) {",
      "    hull() {",
      "        translate([radius, radius, 0]) cylinder(h=height, r=radius, $fn=32);",
      "        translate([length-radius, radius, 0]) cylinder(h=height, r=radius, $fn=32);",
      "        translate([radius, width-radius, 0]) cylinder(h=height, r=radius, $fn=32);",
      "        translate([length-radius, width-radius, 0]) cylinder(h=height, r=radius, $fn=32);",
      "    }",
      "}",
      "",
      "// 圓端螺絲孔槽: 全長 length + 2*radius, 寬 width",
      "module rounded_rectangle_hole(length, width, height, radius) {",
      "    union() {",
      "        cube([length, width, height]);",
      "        translate([0, width/2, 0]) cylinder(h=height, r=radius, $fn=32);",
      "        translate([length, width/2, 0]) cylinder(h=height, r=radius, $fn=32);",
      "    }",
      "}",
      "",
      "// 梅花防偽標記: 五瓣圓 + 補中心的圓",
      "module plum_blossom(radius, height) {",
      "    union() {",
      "        rotate([0, 0, 18])",
      "        for (i = [0:4]) {",
      "            rotate([0, 0, i * 72])",
      "            translate([radius * 1.5, 0, 0])",
      "            cylinder(h=height, r=radius, $fn=32);",
      "        }",
      "        cylinder(h=height, r=radius, $fn=32);",
      "    }",
      "}",
      "",
      "// 梅花內的星形紋 (非獨立標記): 五個長方形旋轉排列 (cube center=true, 上下各佔一半高)",
      "module star_from_rectangles(length, width, height) {",
      "    rotate([0, 0, 18])",
      "    for (i = [0:4]) {",
      "        rotate([0, 0, i * 72])",
      "        translate([length / 4, 0, 0])",
      "        cube([length, width, height], center=true);",
      "    }",
      "}",
      "",
      "module base(length, width, height, radius) {",
      "    // 凹版面深度 (外框凸緣即高出此值), 字模仍高出凹版面 glyph_depth",
      "    depth_base = 3 * multiply;",
      "    // 梅花",
      `    plum_radius = ${num(marks.plumR)} * multiply;`,
      `    plum_height = ${num(marks.plumH)} * multiply;`,
      "    // 梅花內的星形紋",
      `    star_length = ${num(marks.starLen)} * multiply;`,
      `    star_width = ${num(marks.starW)} * multiply;`,
      "",
      "    color(plate_color)",
      "    union() {",
      "        difference() {",
      "            rounded_rectangle(length, width, height, radius);",
      "",
      "            if (is_keychain_hole) {",
      "                translate([plate_radius+(2.5*multiply)+hole_x, plate_width-plate_radius-(2.5*multiply)-hole_y, 0])",
      "                cylinder(h=plate_height, r=hole_radius, $fn=32);",
      "            }",
      "",
      `            // ${spec.layoutComments.holes}`,
    ];
    for (const [cx, cy, len, w, r] of spec.holes2012) {
      lines.push(
        `            translate([${num(cx)} * multiply, ${num(cy)} * multiply, 0])`,
        `            rounded_rectangle_hole(${num(len)} * multiply, ${num(w)} * multiply, height, ${num(r)} * multiply);`,
        ""
      );
    }
    lines.push(
      `            // 凹版面 (內縮 ${num(spec.recessInset)}mm, 留外框凸緣)`,
      `            translate([${num(spec.recessInset)} * multiply, ${num(spec.recessInset)} * multiply, height - depth_base])`,
      `            rounded_rectangle(${num(recessW)} * multiply, ${num(recessH)} * multiply, 10 * multiply, ${num(spec.recessR)} * multiply);`,
      "",
      "            // 防偽標記: 三個梅花, 左右凹、中間凸",
      "            // 左凹梅花",
      `            translate([${num(marks.xs[0])} * multiply, ${num(marks.y)} * multiply, height - depth_base - plum_height])`,
      "            plum_blossom(plum_radius, plum_height);",
      "",
      "            // 右凹梅花",
      `            translate([${num(marks.xs[2])} * multiply, ${num(marks.y)} * multiply, height - depth_base - plum_height])`,
      "            plum_blossom(plum_radius, plum_height);",
      "        }",
      "",
      "        // 中凸梅花 (內刻星形紋)",
      "        difference() {",
      `            translate([${num(marks.xs[1])} * multiply, ${num(marks.y)} * multiply, height - depth_base])`,
      "            plum_blossom(plum_radius, plum_height);",
      "",
      `            translate([${num(marks.xs[1])} * multiply, ${num(marks.y)} * multiply, height - depth_base])`,
      "            star_from_rectangles(star_length, star_width, depth_base*2 + plum_height*2);",
      "        }",
      "",
      "        // 左凹梅花內的凸星形紋",
      `        translate([${num(marks.xs[0])} * multiply, ${num(marks.y)} * multiply, height - depth_base - plum_height])`,
      "        star_from_rectangles(star_length, star_width, depth_base*2 + plum_height*2);",
      "",
      "        // 右凹梅花內的凸星形紋",
      `        translate([${num(marks.xs[2])} * multiply, ${num(marks.y)} * multiply, height - depth_base - plum_height])`,
      "        star_from_rectangles(star_length, star_width, depth_base*2 + plum_height*2);",
      "    }"
    );
    if (spec.ev) lines.push(...evCaptionLines(spec));
    lines.push("}");
    return lines;
  }

  // 電動車字樣的 base() 附加件, 只在勾選 is_ev_text 時放置: 新版電動車
  // 樣式為白底黑字、無綠帶, 僅於上緣中央 (與螺絲孔槽同列) 加註寬字距的
  // 「電動車」三字 (text(), 無 CJK 字模 — 同 1992 地區標示作法), 字樣自
  // 凹版面凸起 glyph_depth, 頂面與號碼字模同高.
  function evCaptionLines(spec) {
    const ev = spec.ev;
    return [
      "",
      "    // 電動車字樣: 上緣中央加註「電動車」(新版樣式白底黑字, 無綠帶)",
      "    if (is_ev_text) {",
      '        // halign="center" 置中的是含尾端字距的總 advance 寬',
      "        // (advance = size/0.72), 右移 (spacing-1)*height/1.44 使墨面真正置中",
      "        color(ev_text_color)",
      `        translate([(${num(ev.textCenterX)} + (ev_text_spacing - 1) * ev_text_height / 1.44) * multiply, ${num(ev.textCenterY)} * multiply, height - depth_base])`,
      "        linear_extrude(height = glyph_depth)",
      '        text("電動車", size = ev_text_height * multiply, font = ev_font, spacing = ev_text_spacing, halign = "center", valign = "center");',
      "    }",
    ];
  }

  function baseLines(spec) {
    if (spec.baseStyle === "2012") return baseLines2012(spec);
    let lines = [
      "module rounded_rectangle(length, width, height, radius) {",
      "    hull() {",
      "        translate([radius, radius, 0]) cylinder(h=height, r=radius, $fn=32);",
      "        translate([length-radius, radius, 0]) cylinder(h=height, r=radius, $fn=32);",
      "        translate([radius, width-radius, 0]) cylinder(h=height, r=radius, $fn=32);",
      "        translate([length-radius, width-radius, 0]) cylinder(h=height, r=radius, $fn=32);",
      "    }",
      "}",
      "",
    ];
    if (spec.holeStyle === "slot") {
      lines.push(
        "// 圓端螺絲孔槽: 全長 length + 2*radius, 寬 width",
        "module rounded_rectangle_hole(length, width, height, radius) {",
        "    union() {",
        "        cube([length, width, height]);",
        "        translate([0, width/2, 0]) cylinder(h=height, r=radius, $fn=32);",
        "        translate([length, width/2, 0]) cylinder(h=height, r=radius, $fn=32);",
        "    }",
        "}",
        ""
      );
    }
    lines.push(
      "module base(length, width, height, radius) {",
      "    // 底版只做到原凹版面高度 (無外邊框凸起), 字模仍高出面 glyph_depth",
      "    depth_base = 3 * multiply;",
      "",
      "    color(plate_color)",
      "    difference() {",
      "        rounded_rectangle(length, width, height - depth_base, radius);",
      "",
      "        if (is_keychain_hole) {",
      "            translate([plate_radius+(2.5*multiply)+hole_x, plate_width-plate_radius-(2.5*multiply)-hole_y, 0])",
      "            cylinder(h=plate_height, r=hole_radius, $fn=32);",
      "        }",
      ""
    );
    lines = lines.concat(holeLines(spec));
    lines = lines.slice(0, -1).concat(["    }", "}"]);
    return lines;
  }

  function dispatchLines(opts) {
    const lines = ["module glyph_by_char(c) {"];
    opts.chars.forEach((char, index) => {
      const prefix = index === 0 ? "if" : "else if";
      lines.push(`    ${prefix} (c == "${scadString(char)}") ${opts.moduleName(char)}();`);
    });
    lines.push('    else if (c == "-") glyph_dash();');
    lines.push('    // "空" 或其他值: 不放置字模');
    lines.push("}");
    return lines;
  }

  function dashModuleLines() {
    return [
      "module glyph_dash(h = 3) {",
      "    linear_extrude(height = h)",
      "    // 抵消字高縮放，使最終尺寸與此車牌的固定分隔點一致",
      "    square([dot_w / glyph_scale, dot_h / glyph_scale], center = true);",
      "}",
    ];
  }

  // Build one plate .scad as text. traces: {char: {contours}}; throws with
  // the missing characters when the trace set is incomplete.
  function buildPlateScad(spec, traces, opts) {
    const missing = opts.chars.filter((char) => !traces[char] || !traces[char].contours || !traces[char].contours.length);
    if (missing.length) {
      const error = new Error(missing.join(""));
      error.missing = missing;
      throw error;
    }
    let lines = headerLines(spec, opts);
    lines = lines.concat(["", ""]);
    lines = lines.concat(placementLines(spec));
    lines = lines.concat(["", ""]);
    lines = lines.concat(baseLines(spec));
    lines = lines.concat(["", ""]);
    lines = lines.concat(dispatchLines(opts));
    lines = lines.concat(["", ""]);
    lines = lines.concat(dashModuleLines());
    lines = lines.concat(["", "// 字模 (自 Bezier 描邊取樣, 45×89 置中於原點)"]);
    for (const char of opts.chars) {
      lines.push("");
      lines = lines.concat(glyphModuleLines(char, traces[char].contours, opts));
    }
    lines.push("");
    return lines.join("\n");
  }

  return { SPECS, SPECS_2012, DEFAULT_HEADER, buildPlateScad };
})();
