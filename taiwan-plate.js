// Page module for taiwan-plate.html: glyph specimen grid + the six plate
// customizer downloads. Shares the editor's storage, exporters and glyph
// contract (naming + trace-set rules) instead of duplicating them.
import { ProjectStore } from "./storage.js";
import { Exporters } from "./exporters.js";
import { Plates } from "./taiwan-plates.js";
import { moduleName, missingChars, completeTraceSet } from "./glyph-contract.js";

const HEADER_KEY = "img2openscad-plate-page-header";
const FALLBACK_SETTINGS = {
  chars: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  svgW: 45,
  svgH: 89,
  prefix: "2012_",
  modulePrefix: "glyph_2012_",
  sampleSteps: 16,
};
const grid = document.getElementById("glyphGrid");
const buttonsBox = document.getElementById("plateButtons");
const buttonsBox2012 = document.getElementById("plateButtons2012");
const headerInput = document.getElementById("headerInput");
const status = document.getElementById("status");
const sourceNote = document.getElementById("sourceNote");

const saved = localStorage.getItem(HEADER_KEY);
headerInput.value = saved !== null ? saved : Plates.DEFAULT_HEADER.join("\n");
headerInput.addEventListener("input", () => localStorage.setItem(HEADER_KEY, headerInput.value));

const headerComments = () => {
  const raw = headerInput.value;
  return raw.trim() ? raw.split("\n").map((line) => line.trimEnd()) : [];
};

// The customizer dropdown offers every one of 0-9 A-Z, so the editor's
// project is only usable when ALL 36 glyphs have a saved trace — a partial
// project would generate plates with silently missing glyphs. Otherwise
// fall back to the repo's bundled traces (and say why).
const REQUIRED_CHARS = [...FALLBACK_SETTINGS.chars];

async function loadProject() {
  let editorMissing = null;
  try {
    const [settings, traces] = await Promise.all([
      ProjectStore.get("settings"),
      ProjectStore.get("traces"),
    ]);
    if (settings && traces && settings.svgW > 0 && settings.svgH > 0) {
      const complete = completeTraceSet(traces, REQUIRED_CHARS);
      if (complete) {
        return { origin: "editor", settings, traces: complete, chars: REQUIRED_CHARS };
      }
      const missing = missingChars(traces, REQUIRED_CHARS);
      if (missing.length < REQUIRED_CHARS.length) editorMissing = missing;
    }
  } catch {
    // IndexedDB unavailable (e.g. blocked storage) — use the fallback.
  }
  const res = await fetch("./taiwan-glyphs/traces.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {
    origin: "bundled",
    editorMissing,
    settings: FALLBACK_SETTINGS,
    traces: await res.json(),
    chars: [...FALLBACK_SETTINGS.chars],
  };
}

let project = null;
try {
  project = await loadProject();
} catch (error) {
  status.className = "error";
  status.textContent = `無法載入字形資料（${error.message}）— 請以靜態伺服器開啟本頁。`;
}

if (project) {
  const { settings, traces, chars } = project;
  sourceNote.textContent =
    project.origin === "editor"
      ? "字形來源：編輯器目前的描邊（你瀏覽器裡的專案，0–9 A–Z 齊全）。"
      : project.editorMissing
        ? `字形來源：內建 taiwan-glyphs/traces.json（2012 年式；編輯器專案缺 ${project.editorMissing.length} 字：${project.editorMissing.join("")}，0–9 A–Z 全部描完才會採用）。`
        : "字形來源：內建 taiwan-glyphs/traces.json（2012 年式；編輯器裡還沒有描邊）。";

  const glyphOpts = (char) => ({
    canvasW: Math.round(settings.svgW * 4),
    canvasH: Math.round(settings.svgH * 4),
    svgW: settings.svgW,
    svgH: settings.svgH,
    sampleSteps: settings.sampleSteps,
    shapeId: moduleName(settings, char),
  });

  // Click a specimen cell to inspect the glyph at full size in a <dialog>;
  // Esc or clicking outside the image closes it.
  const dialog = document.getElementById("glyphDialog");
  const dialogImg = document.getElementById("glyphDialogImg");
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  for (const char of chars) {
    const contours = (traces[char]?.contours || []).filter((contour) => contour.length >= 3);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "glyph-cell";
    const img = document.createElement("img");
    img.alt = char;
    if (contours.length) {
      img.src = Exporters.svgDataUrl(Exporters.buildSvg(contours, glyphOpts(char)));
      cell.addEventListener("click", () => {
        dialogImg.src = img.src;
        dialogImg.alt = char;
        dialog.showModal();
      });
    } else {
      cell.disabled = true;
    }
    const cap = document.createElement("div");
    cap.className = "cap";
    cap.textContent = char;
    cell.append(img, cap);
    grid.append(cell);
  }

  const DOWNLOAD_ICON =
    '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>';

  const addPlateButtons = (specs, box) => {
    for (const spec of specs) {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = DOWNLOAD_ICON;
      const label = document.createElement("span");
      label.textContent = spec.label;
      button.append(label);
      button.addEventListener("click", () => {
        try {
          const text = Plates.buildPlateScad(spec, traces, {
            chars,
            svgW: settings.svgW,
            svgH: settings.svgH,
            moduleName: (char) => moduleName(settings, char),
            sampleOpts: (char) => glyphOpts(char),
            headerComments: headerComments(),
          });
          Exporters.download(spec.filename, new Blob([text], { type: "text/plain" }));
          status.className = "ok";
          status.textContent = `已下載 ${spec.filename}`;
        } catch (error) {
          status.className = "error";
          status.textContent = error.missing ? `缺少描邊：${error.missing.join(" ")}` : `產生失敗：${error.message}`;
        }
      });
      box.append(button);
    }
  };
  addPlateButtons(Plates.SPECS, buttonsBox);
  addPlateButtons(Plates.SPECS_2012, buttonsBox2012);
}
