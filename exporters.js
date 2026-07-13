// SVG / OpenSCAD generation from Bezier traces, plus download helpers and a
// minimal (store-only) ZIP writer. Ports of scripts/trace_pipeline.py and the
// fmt helper from scripts/vectorize.py so the output matches the original
// Python pipeline byte-for-byte.
export const Exporters = (() => {
  function fmt(value) {
    // Round half to even at the 4th decimal, matching Python's f"{v:.4f}"
    // (toFixed rounds ties away from zero, Python rounds them to even).
    const scaled = value * 10000;
    const floor = Math.floor(scaled);
    let text;
    if (scaled - floor === 0.5) {
      const even = floor % 2 === 0 ? floor : floor + 1;
      text = (even / 10000).toFixed(4);
    } else {
      text = value.toFixed(4);
    }
    if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text === "" || text === "-0" ? "0" : text;
  }

  function cubic(p0, p1, p2, p3, t) {
    const inv = 1 - t;
    return {
      x: inv ** 3 * p0.x + 3 * inv ** 2 * t * p1.x + 3 * inv * t ** 2 * p2.x + t ** 3 * p3.x,
      y: inv ** 3 * p0.y + 3 * inv ** 2 * t * p1.y + 3 * inv * t ** 2 * p2.y + t ** 3 * p3.y,
    };
  }

  // opts: { canvasW, canvasH, svgW, svgH, shapeId | moduleName, comment }
  function svgScale(opts) {
    return { x: opts.svgW / opts.canvasW, y: opts.svgH / opts.canvasH };
  }

  function contourPath(contour, scale) {
    const px = (x) => fmt(x * scale.x);
    const py = (y) => fmt(y * scale.y);
    const commands = [`M ${px(contour[0].x)} ${py(contour[0].y)}`];
    for (let index = 0; index < contour.length; index += 1) {
      const point = contour[index];
      const next = contour[(index + 1) % contour.length];
      commands.push(
        `C ${px(point.outX)} ${py(point.outY)} ${px(next.inX)} ${py(next.inY)} ${px(next.x)} ${py(next.y)}`
      );
    }
    commands.push("Z");
    return commands.join(" ");
  }

  function buildSvg(contours, opts) {
    const scale = svgScale(opts);
    const pathData = contours.map((contour) => contourPath(contour, scale)).join(" ");
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg width="${fmt(opts.svgW)}mm" height="${fmt(opts.svgH)}mm" viewBox="0 0 ${fmt(opts.svgW)} ${fmt(opts.svgH)}" xmlns="http://www.w3.org/2000/svg">`,
      `  <path id="${opts.shapeId}" d="${pathData}" fill="#000" fill-rule="evenodd"/>`,
      "</svg>",
      "",
    ].join("\n");
  }

  function sampleContour(contour, opts, steps = opts.sampleSteps || 16) {
    const scale = svgScale(opts);
    const sampled = [];
    for (let index = 0; index < contour.length; index += 1) {
      const point = contour[index];
      const next = contour[(index + 1) % contour.length];
      for (let step = 0; step < steps; step += 1) {
        const at = cubic(
          { x: point.x, y: point.y },
          { x: point.outX, y: point.outY },
          { x: next.inX, y: next.inY },
          { x: next.x, y: next.y },
          step / steps
        );
        // SCAD Y axis points up and the glyph is centered on the origin.
        sampled.push([at.x * scale.x - opts.svgW / 2, opts.svgH / 2 - at.y * scale.y]);
      }
    }
    return sampled;
  }

  function scadPoints(points) {
    return "[" + points.map(([x, y]) => `[${fmt(x)}, ${fmt(y)}]`).join(", ") + "]";
  }

  function buildScad(contours, opts) {
    const name = opts.moduleName;
    const polygons = contours.map((contour) => sampleContour(contour, opts));
    const lines = [
      `// ${opts.comment || "Generated from Bezier trace"}`,
      "fudge = 0.1;",
      "",
      `module ${name}(h = 3) {`,
      "  difference() {",
    ];
    if (polygons.length) {
      lines.push("    linear_extrude(height = h)");
      lines.push(`      polygon(points = ${scadPoints(polygons[0])});`);
      for (const hole of polygons.slice(1)) {
        lines.push("    translate([0, 0, -fudge])");
        lines.push("      linear_extrude(height = h + 2 * fudge)");
        lines.push(`        polygon(points = ${scadPoints(hole)});`);
      }
    }
    lines.push("  }", "}", "", `${name}();`, "");
    return lines.join("\n");
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // entries: [{ name: string, data: Uint8Array }] -> ZIP blob (stored, no compression).
  function makeZip(entries) {
    const encoder = new TextEncoder();
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate = ((((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    const parts = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const crc = crc32(entry.data);
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 0x0800, true); // UTF-8 file names
      header.setUint16(8, 0, true); // stored
      header.setUint16(10, dosTime, true);
      header.setUint16(12, dosDate, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, entry.data.length, true);
      header.setUint32(22, entry.data.length, true);
      header.setUint16(26, nameBytes.length, true);
      header.setUint16(28, 0, true);
      parts.push(new Uint8Array(header.buffer), nameBytes, entry.data);
      central.push({ nameBytes, crc, size: entry.data.length, offset });
      offset += 30 + nameBytes.length + entry.data.length;
    }

    const centralParts = [];
    let centralSize = 0;
    for (const item of central) {
      const header = new DataView(new ArrayBuffer(46));
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 20, true);
      header.setUint16(8, 0x0800, true);
      header.setUint16(10, 0, true);
      header.setUint16(12, dosTime, true);
      header.setUint16(14, dosDate, true);
      header.setUint32(16, item.crc, true);
      header.setUint32(20, item.size, true);
      header.setUint32(24, item.size, true);
      header.setUint16(28, item.nameBytes.length, true);
      header.setUint32(42, item.offset, true);
      centralParts.push(new Uint8Array(header.buffer), item.nameBytes);
      centralSize += 46 + item.nameBytes.length;
    }

    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);
    return new Blob([...parts, ...centralParts, new Uint8Array(eocd.buffer)], { type: "application/zip" });
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function textBytes(text) {
    return new TextEncoder().encode(text);
  }

  function dataUrlToBytes(dataUrl) {
    const [meta, payload] = dataUrl.split(",", 2);
    if (meta.includes(";base64")) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return textBytes(decodeURIComponent(payload));
  }

  function dataUrlToBlob(dataUrl) {
    const meta = dataUrl.slice(0, dataUrl.indexOf(","));
    const mime = (meta.match(/^data:([^;,]+)/) || [])[1] || "application/octet-stream";
    return new Blob([dataUrlToBytes(dataUrl)], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function svgDataUrl(svgText) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
  }

  return {
    fmt,
    buildSvg,
    buildScad,
    sampleContour,
    scadPoints,
    makeZip,
    download,
    textBytes,
    dataUrlToBytes,
    dataUrlToBlob,
    blobToDataUrl,
    svgDataUrl,
  };
})();
