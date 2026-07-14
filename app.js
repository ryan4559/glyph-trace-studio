// UI + orchestration for the glyph editor. Domain logic lives in the pure
// modules: project-schema.js (file format, sanitizers, caps),
// glyph-contract.js (naming + trace-set rules shared with the plate page),
// exporters.js / autotrace.js, and storage.js (IndexedDB).
import { ProjectStore } from "./storage.js";
import { Exporters } from "./exporters.js";
import { AutoTrace } from "./autotrace.js";
import {
  DEFAULT_SETTINGS,
  LEGACY_IMAGE_ID,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_PROJECT_BYTES,
  clampNumber,
  isImageId,
  parseCharset,
  isProjectPayload,
  buildProjectPayload,
  sanitizeImportedProject,
} from "./project-schema.js";
import { charSlug, fileBase, moduleName, savedContours } from "./glyph-contract.js";

const PX_PER_MM = 4;
const MAX_IMAGE_DIM = 4096;

const state = {
  settings: { ...DEFAULT_SETTINGS },
  chars: [],
  sources: {},
  traces: {},
  // Per-char in-memory working copies of traces. All trace editing (manual
  // and auto-trace) happens here; "Save trace" is the only path that commits
  // a draft into state.traces / IndexedDB.
  traceDrafts: {},
  glyphs: {},
  // Reference images are stored as Blob records in IndexedDB. Every saved
  // crop source points at one record by imageId, so a project remains fully
  // editable even when its glyphs came from several sheets.
  images: [],
  activeImageId: null,
  // Bundle manifest (project.json served next to the app): the repo's 2012
  // example project, imported into IndexedDB only on a visitor's first load.
  bundle: null,
  bundleConfirm: false,
  newProjectConfirm: false,
  selected: null,
  image: new Image(),
  imageObjectUrl: null,
  loadedImageId: null,
  imageReady: false,
  box: [0, 0, 1, 1],
  // Last crop box the user actively adjusted; characters without a saved crop
  // start from it (or from the project W/H before any adjustment).
  lastBox: null,
  dragging: false,
  dragOffset: null,
  previewFrame: null,
  mode: "crop",
  traceView: "overlay",
  activeContour: 0,
  selectedPoint: null,
  traceDragging: null,
  traceImage: new Image(),
  traceImageSrc: null,
  traceImageReady: false,
  zoomByMode: { crop: null, trace: null },
  language: "en",
  showGrid: true,
};

const els = {
  root: document.documentElement,
  subtitle: document.querySelector(".brand p"),
  settingsNote: document.querySelector("#settingsSection .trace-note"),
  languageSelect: document.querySelector("#languageSelect"),
  charGrid: document.querySelector("#charGrid"),
  canvas: document.querySelector("#refCanvas"),
  scroller: document.querySelector("#canvasScroller"),
  canvasShell: document.querySelector(".canvas-shell"),
  emptyState: document.querySelector("#emptyState"),
  emptyUploadButton: document.querySelector("#emptyUploadButton"),
  uploadButton: document.querySelector("#uploadButton"),
  imageSelect: document.querySelector("#imageSelect"),
  removeImageButton: document.querySelector("#removeImageButton"),
  filePicker: document.querySelector("#filePicker"),
  projectPicker: document.querySelector("#projectPicker"),
  previewTitle: document.querySelector("#previewTitle"),
  svgPreview: document.querySelector("#svgPreview"),
  pngPreview: document.querySelector("#pngPreview"),
  saveButton: document.querySelector("#saveButton"),
  fitButton: document.querySelector("#fitButton"),
  gridToggleButton: document.querySelector("#gridToggleButton"),
  zoom: document.querySelector("#zoom"),
  zoomValue: document.querySelector("#zoomValue"),
  x0: document.querySelector("#x0"),
  y0: document.querySelector("#y0"),
  width: document.querySelector("#width"),
  height: document.querySelector("#height"),
  polarity: document.querySelector("#polarity"),
  threshold: document.querySelector("#threshold"),
  thresholdValue: document.querySelector("#thresholdValue"),
  offsetX: document.querySelector("#offsetX"),
  sourceInfo: document.querySelector("#sourceInfo"),
  status: document.querySelector("#status"),
  cropControls: document.querySelector("#cropControls"),
  traceControls: document.querySelector("#traceControls"),
  cropModeButton: document.querySelector("#cropModeButton"),
  traceModeTopButton: document.querySelector("#traceModeTopButton"),
  traceViewSwitch: document.querySelector("#traceViewSwitch"),
  traceOverlayButton: document.querySelector("#traceOverlayButton"),
  traceSideBySideButton: document.querySelector("#traceSideBySideButton"),
  traceStage: document.querySelector("#traceStage"),
  traceCanvas: document.querySelector("#traceCanvas"),
  traceRulerX: document.querySelector("#traceRulerX"),
  traceRulerY: document.querySelector("#traceRulerY"),
  addContourButton: document.querySelector("#addContourButton"),
  deletePointButton: document.querySelector("#deletePointButton"),
  setOuterButton: document.querySelector("#setOuterButton"),
  setHoleButton: document.querySelector("#setHoleButton"),
  undoTraceButton: document.querySelector("#undoTraceButton"),
  clearTraceButton: document.querySelector("#clearTraceButton"),
  saveTraceButton: document.querySelector("#saveTraceButton"),
  autoTraceButton: document.querySelector("#autoTraceButton"),
  autoRoundInput: document.querySelector("#autoRoundInput"),
  downloadSvgButton: document.querySelector("#downloadSvgButton"),
  downloadScadButton: document.querySelector("#downloadScadButton"),
  downloadPngButton: document.querySelector("#downloadPngButton"),
  downloadZipButton: document.querySelector("#downloadZipButton"),
  exportProjectButton: document.querySelector("#exportProjectButton"),
  importProjectButton: document.querySelector("#importProjectButton"),
  applySettingsButton: document.querySelector("#applySettingsButton"),
  reloadBundleButton: document.querySelector("#reloadBundleButton"),
  newProjectButton: document.querySelector("#newProjectButton"),
  charsetInput: document.querySelector("#charsetInput"),
  svgWInput: document.querySelector("#svgWInput"),
  svgHInput: document.querySelector("#svgHInput"),
  prefixInput: document.querySelector("#prefixInput"),
};

const ctx = els.canvas.getContext("2d");
const traceCtx = els.traceCanvas.getContext("2d");
const traceRulerXCtx = els.traceRulerX.getContext("2d");
const traceRulerYCtx = els.traceRulerY.getContext("2d");

// Glyph canvas size in editing pixels; derived from the mm settings.
let CANVAS_W = 180;
let CANVAS_H = 356;
const TRACE_SCALE = 3;
// Cap on the trace canvas backing-store size (largest dimension, device px).
// Keeps the bitmap crisp at the displayed zoom without exceeding browser
// canvas-area limits (Safari caps total area at ~4096x4096).
const TRACE_MAX_BACKING = 4096;
const HANDLE_R = 5;
const TRACE_RULER = 14;
const TRACE_PAD = 40;
const TRACE_SIDE_GAP = 40;
const TRACE_CONTROL_MARGIN = TRACE_PAD;
let TRACE_WORLD_W = TRACE_RULER + TRACE_PAD * 2 + CANVAS_W;
let TRACE_WORLD_H = TRACE_RULER + TRACE_PAD * 2 + CANVAS_H;
const TRACE_IMAGE_X = TRACE_RULER + TRACE_PAD;
const TRACE_IMAGE_Y = TRACE_RULER + TRACE_PAD;
const TRACE_RULER_X_H = 28;
const TRACE_RULER_Y_W = 36;
// Nice grid steps (in glyph/image px). The finest step whose on-screen spacing
// reaches GRID_TARGET_PX is used, so the grid coarsens as you zoom out.
const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100];
const GRID_TARGET_PX = 22;
const UI_STORAGE_KEY = "img2openscad-glyph-editor-ui";
const DEFAULT_LANGUAGE = "en";
const LANGUAGES = {
  en: {
    label: "English",
    htmlLang: "en",
    messages: {
      "app.title": "Glyph Trace Studio",
      "app.documentTitle": "Glyph Trace Studio — image to SVG / OpenSCAD",
      "app.subtitle": "Image → SVG / OpenSCAD",
      "plates.eyebrow": "OpenSCAD",
      "plates.heading": "License-plate keychain generator",
      "plates.note": "Taiwan license-plate keychain models (.scad) — 1992 style and new style (2012+, 3-4); plate number, colors and size are customizable, and the glyphs come from this editor's traces.",
      "plates.link": "Open the generator ↗",
      "language.label": "Language",
      "preview.eyebrow": "Preview",
      "preview.svgAlt": "Traced SVG preview",
      "preview.pngAlt": "Live cropped PNG preview",
      "crop.eyebrow": "Crop settings",
      "crop.heading": "Output",
      "crop.save": "Save crop",
      "crop.foreground": "Foreground",
      "crop.darkPixels": "dark pixels",
      "crop.lightPixels": "light pixels",
      "crop.threshold": "Threshold",
      "crop.offsetX": "X offset (canvas px)",
      "crop.offsetXHint":
        "Shifts the glyph horizontally after the ink is centered on the canvas — e.g. center a 1 on its vertical stem instead of its full outline.",
      "trace.eyebrow": "Bezier trace",
      "trace.heading": "Manual outline",
      "trace.addHole": "Add hole",
      "trace.deletePoint": "Delete point",
      "trace.setOuter": "Set as outer",
      "trace.setHole": "Set as hole",
      "trace.undoPoint": "Undo point",
      "trace.clear": "Clear",
      "trace.save": "Save trace",
      "trace.auto": "Auto trace",
      "trace.autoRound": "Roundness (0–1)",
      "trace.viewAria": "Trace view",
      "trace.viewOverlay": "Overlay",
      "trace.viewSideBySide": "Side by side",
      "trace.canvasLabel": "Canvas",
      "trace.referenceLabel": "Reference",
      "trace.note": "Draw the outer outline first. Use Add hole before drawing an inner contour. Click an existing segment to insert a point. Saved contours after the first one are treated as holes. Delete point removes the selected black node, and Set as outer / Set as hole changes contour order.",
      "glyphs.eyebrow": "Glyphs",
      "workspace.modeAria": "Editor mode",
      "workspace.fit": "Fit",
      "workspace.grid": "Grid",
      "workspace.zoom": "Zoom",
      "mode.crop": "Crop",
      "mode.trace": "Trace",
      "image.label": "Reference image",
      "image.none": "No images",
      "image.remove": "Remove",
      "upload.button": "Add images",
      "upload.emptyTitle": "Add reference images",
      "upload.emptyBody": "Drop one or more images here, or pick files. Each saved crop stays linked to its source image, and everything remains in your browser.",
      "export.eyebrow": "Export",
      "export.heading": "Downloads",
      "export.svg": "SVG (glyph)",
      "export.scad": "SCAD (glyph)",
      "export.png": "PNG (glyph)",
      "export.zip": "ZIP (all)",
      "export.project": "Export project",
      "export.import": "Import project",
      "settings.eyebrow": "Settings",
      "settings.heading": "Project",
      "settings.apply": "Apply",
      "settings.charset": "Characters",
      "settings.widthMm": "Width (mm)",
      "settings.heightMm": "Height (mm)",
      "settings.prefix": "Name prefix",
      "settings.note": "Characters define the glyph grid. Width/height set the exported SVG/SCAD size in mm (the editing canvas is 4 px per mm). The prefix names files and OpenSCAD modules.",
      "settings.reloadBundle": "Reload bundled project",
      "settings.reloadBundleConfirm": "Overwrite browser edits — click again",
      "settings.newProject": "New project (clear)",
      "settings.newProjectConfirm": "Erase all project data in this browser — click again",
      "source.unset": "Not set",
      "source.manual": "Manual adjustment",
      "source.auto": "Auto detected",
      "source.from": "From {source}",
      "source.manualDetail": "Adjusted manually in the editor",
      "source.chooseOrSave": "Select or save a glyph first",
      "source.title": "Current crop bounds",
      "source.source": "Source",
      "source.image": "Image",
      "source.imageMissing": "Missing image",
      "source.imageDetail": "Selecting this glyph restores its source image",
      "source.imageDraft": "Saving links this crop to the current image",
      "source.topLeft": "Top left",
      "source.topLeftDetail": "Original image coordinates",
      "source.size": "Crop size",
      "source.sizeDetail": "Fixed size, draggable",
      "status.selectBlackNode": "Select a black node first.",
      "status.alreadyOuter": "Current contour is already the outer outline.",
      "status.needTwoContours": "At least two contours are required before one can be set as a hole.",
      "status.alreadyHole": "Current contour is already a hole.",
      "status.saving": "Saving...",
      "status.saveFailed": "Save failed",
      "status.savedCrop": "Saved crop for {char}.",
      "status.needContour": "At least one contour with 3 or more points is required.",
      "status.savingTrace": "Saving trace...",
      "status.saveTraceFailed": "Save trace failed",
      "status.savedTrace": "Saved trace for {char}.",
      "status.needImage": "Upload a reference image first.",
      "status.loadingImage": "Loading images...",
      "status.imagesAdded": "Added {count} reference image(s).",
      "status.imageLoadFailed": "Could not load that image.",
      "status.tooManyImages": "A project can contain up to {max} reference images.",
      "status.imageInUse": "This image is used by {count} saved crop(s) and cannot be removed.",
      "status.imageRemoved": "Reference image removed.",
      "status.noTrace": "No saved trace for {char} yet.",
      "status.noGlyphPng": "No saved crop for {char} yet.",
      "status.downloaded": "Downloaded {file}.",
      "status.zipEmpty": "Nothing to export yet — save a crop or trace first.",
      "status.zipDone": "Exported {count} files as ZIP.",
      "status.projectExported": "Project file exported.",
      "status.projectImported": "Project imported.",
      "status.importFailed": "Import failed — not a valid project file.",
      "status.fileTooLarge": "File is too large ({limit} MB max).",
      "status.settingsApplied": "Settings applied.",
      "status.bundleLoading": "Loading bundled project...",
      "status.bundleLoaded": "Bundled project loaded.",
      "status.bundleFailed": "Could not load the bundled project.",
      "status.projectCleared": "Started a new empty project.",
      "status.autoTracing": "Auto-tracing {char}...",
      "status.autoTraced": "Auto-traced {char} ({count} contours) — review, then Save trace.",
      "status.autoTraceFailed": "Auto trace failed",
    },
  },
  "zh-Hant": {
    label: "繁體中文",
    htmlLang: "zh-Hant",
    messages: {
      "app.title": "字形描邊工作室",
      "app.documentTitle": "字形描邊工作室 — 圖片轉 SVG / OpenSCAD",
      "app.subtitle": "圖片 → SVG / OpenSCAD",
      "plates.eyebrow": "OpenSCAD",
      "plates.heading": "車牌鑰匙圈產生器",
      "plates.note": "產生台灣車牌鑰匙圈模型（.scad）——1992 年式與新式（2012 年起，3-4）；號碼、顏色、尺寸皆可自訂，字形使用本編輯器目前的描邊。",
      "plates.link": "開啟產生器 ↗",
      "language.label": "語言",
      "preview.eyebrow": "預覽",
      "preview.svgAlt": "描邊 SVG 預覽",
      "preview.pngAlt": "即時裁切 PNG 預覽",
      "crop.eyebrow": "裁切設定",
      "crop.heading": "輸出",
      "crop.save": "儲存裁切",
      "crop.foreground": "前景",
      "crop.darkPixels": "深色像素",
      "crop.lightPixels": "淺色像素",
      "crop.threshold": "閾值",
      "crop.offsetX": "水平偏移（畫布 px）",
      "crop.offsetXHint": "字形先在畫布置中，再套用這個水平偏移——例如讓 1 以豎筆置中，而不是以整個輪廓置中。",
      "trace.eyebrow": "貝茲描邊",
      "trace.heading": "手動畫輪廓",
      "trace.addHole": "新增內洞",
      "trace.deletePoint": "刪除節點",
      "trace.setOuter": "設為外輪廓",
      "trace.setHole": "設為內洞",
      "trace.undoPoint": "復原節點",
      "trace.clear": "清除",
      "trace.save": "儲存描邊",
      "trace.auto": "自動描邊",
      "trace.autoRound": "圓潤度（0–1）",
      "trace.viewAria": "描邊檢視方式",
      "trace.viewOverlay": "疊圖",
      "trace.viewSideBySide": "並排",
      "trace.canvasLabel": "畫布",
      "trace.referenceLabel": "參考圖",
      "trace.note": "先畫外輪廓。要開洞時按「新增內洞」，再在字裡面畫第二個 contour；點擊既有線段可插入節點。儲存後第二個、第三個 contour 都會當成內洞。「刪除節點」會刪掉目前選中的黑色節點，「設為外輪廓 / 設為內洞」會改 contour 順序。",
      "glyphs.eyebrow": "字形",
      "workspace.modeAria": "編輯器模式",
      "workspace.fit": "符合視窗",
      "workspace.grid": "網格",
      "workspace.zoom": "縮放",
      "mode.crop": "裁切",
      "mode.trace": "描邊",
      "image.label": "參考底圖",
      "image.none": "尚無底圖",
      "image.remove": "移除",
      "upload.button": "新增底圖",
      "upload.emptyTitle": "新增參考底圖",
      "upload.emptyBody": "把一張或多張圖片拖到這裡，或點擊選擇檔案。每個裁切都會連結到原始底圖，所有資料仍只保存在瀏覽器中。",
      "export.eyebrow": "匯出",
      "export.heading": "下載",
      "export.svg": "SVG（單字）",
      "export.scad": "SCAD（單字）",
      "export.png": "PNG（單字）",
      "export.zip": "ZIP（全部）",
      "export.project": "匯出專案",
      "export.import": "匯入專案",
      "settings.eyebrow": "設定",
      "settings.heading": "專案",
      "settings.apply": "套用",
      "settings.charset": "字元集",
      "settings.widthMm": "寬（mm）",
      "settings.heightMm": "高（mm）",
      "settings.prefix": "名稱前綴",
      "settings.note": "字元集決定字形清單。寬 / 高是匯出 SVG / SCAD 的 mm 尺寸（編輯畫布為每 mm 4 px）。前綴用於檔名和 OpenSCAD module 名稱。",
      "settings.reloadBundle": "重新載入內建專案",
      "settings.reloadBundleConfirm": "將覆蓋瀏覽器內的編輯——再按一次確認",
      "settings.newProject": "新專案（清空）",
      "settings.newProjectConfirm": "將清除瀏覽器內所有專案資料——再按一次確認",
      "source.unset": "尚未設定",
      "source.manual": "手動調整",
      "source.auto": "自動偵測",
      "source.from": "來自 {source}",
      "source.manualDetail": "使用編輯器手動調整",
      "source.chooseOrSave": "請先選擇或儲存一個字元",
      "source.title": "目前裁切範圍",
      "source.source": "來源",
      "source.image": "底圖",
      "source.imageMissing": "底圖已遺失",
      "source.imageDetail": "選取這個字元時會還原它的來源底圖",
      "source.imageDraft": "儲存後，這個裁切會連結到目前底圖",
      "source.topLeft": "左上角",
      "source.topLeftDetail": "原始圖片座標",
      "source.size": "裁切尺寸",
      "source.sizeDetail": "固定大小，可拖曳移動",
      "status.selectBlackNode": "先選一個黑色節點。",
      "status.alreadyOuter": "目前 contour 已經是外輪廓。",
      "status.needTwoContours": "至少要有兩個 contour，才能把其中一個當成洞。",
      "status.alreadyHole": "目前 contour 已經是內洞。",
      "status.saving": "儲存中...",
      "status.saveFailed": "儲存失敗",
      "status.savedCrop": "已儲存 {char} 的裁切。",
      "status.needContour": "至少需要一個包含 3 個以上節點的 contour。",
      "status.savingTrace": "描邊儲存中...",
      "status.saveTraceFailed": "描邊儲存失敗",
      "status.savedTrace": "已儲存 {char} 的描邊。",
      "status.needImage": "請先上傳參考底圖。",
      "status.loadingImage": "底圖載入中...",
      "status.imagesAdded": "已新增 {count} 張參考底圖。",
      "status.imageLoadFailed": "這張圖片無法載入。",
      "status.tooManyImages": "每個專案最多可保存 {max} 張參考底圖。",
      "status.imageInUse": "這張底圖仍被 {count} 個已儲存裁切使用，無法移除。",
      "status.imageRemoved": "已移除參考底圖。",
      "status.noTrace": "{char} 還沒有已儲存的描邊。",
      "status.noGlyphPng": "{char} 還沒有已儲存的裁切。",
      "status.downloaded": "已下載 {file}。",
      "status.zipEmpty": "還沒有可匯出的內容，請先儲存裁切或描邊。",
      "status.zipDone": "已匯出 {count} 個檔案（ZIP）。",
      "status.projectExported": "已匯出專案檔。",
      "status.projectImported": "已匯入專案。",
      "status.importFailed": "匯入失敗：不是有效的專案檔。",
      "status.fileTooLarge": "檔案過大（上限 {limit} MB）。",
      "status.settingsApplied": "設定已套用。",
      "status.bundleLoading": "內建專案載入中...",
      "status.bundleLoaded": "已載入內建專案。",
      "status.bundleFailed": "內建專案載入失敗。",
      "status.projectCleared": "已開啟新的空白專案。",
      "status.autoTracing": "{char} 自動描邊中...",
      "status.autoTraced": "已自動描邊 {char}（{count} 個 contour）——檢查後按「儲存描邊」。",
      "status.autoTraceFailed": "自動描邊失敗",
    },
  },
};

async function init() {
  const uiState = loadUiState();
  state.language = languageOrDefault(uiState.language);
  const [settings, sources, traces, glyphs, storedImages, storedActiveImageId, refBlob] =
    await Promise.all([
      ProjectStore.get("settings"),
      ProjectStore.get("sources"),
      ProjectStore.get("traces"),
      ProjectStore.get("glyphs"),
      ProjectStore.get("images"),
      ProjectStore.get("activeImageId"),
      ProjectStore.get("refImage"),
    ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.sources = sources || {};
  state.traces = traces || {};
  state.glyphs = glyphs || {};
  state.images = normalizeStoredImages(storedImages);
  const storedImageIds = new Set(state.images.map((image) => image.id));
  state.activeImageId = storedImageIds.has(storedActiveImageId)
    ? storedActiveImageId
    : state.images[0]?.id || null;

  // One-time IndexedDB migration from the pre-v2 single refImage key.
  if (!state.images.length && refBlob instanceof Blob) {
    state.images = [{ id: LEGACY_IMAGE_ID, name: "Reference image", blob: refBlob }];
    state.activeImageId = LEGACY_IMAGE_ID;
    for (const source of Object.values(state.sources)) {
      if (source?.box && !source.imageId) source.imageId = LEGACY_IMAGE_ID;
    }
    await ProjectStore.setMany(
      { images: state.images, activeImageId: state.activeImageId, sources: state.sources },
      ["refImage"]
    );
  }

  state.bundle = await loadBundleManifest();
  const storeEmpty =
    !settings && !sources && !traces && !glyphs && !storedImages && !(refBlob instanceof Blob);
  if (state.bundle && storeEmpty) {
    try {
      await importBundle(state.bundle);
    } catch {
      // A broken bundle must not block the app; start empty instead.
    }
  }
  state.mode = uiState.mode === "trace" ? "trace" : "crop";
  state.traceView = uiState.traceView === "side-by-side" ? "side-by-side" : "overlay";
  state.showGrid = uiState.showGrid !== false;
  state.zoomByMode.crop = numberOrNull(uiState.cropZoom);
  state.zoomByMode.trace = numberOrNull(uiState.traceZoom);
  applySettings();
  state.selected = state.chars.includes(uiState.selected) ? uiState.selected : state.chars[0];
  renderLanguageOptions();
  applyTranslations();
  renderCharButtons();
  renderImageOptions();
  bindEvents();
  els.reloadBundleButton.hidden = !state.bundle;
  if (state.activeImageId) activateImage(state.activeImageId, { persist: false });
  else clearReferenceImage();
  selectChar(state.selected);
  setMode(state.mode);
  updateEmptyState();
}

// Probe for the project.json manifest next to the app. It supplies the 2012
// example data (crop boxes, traces and raster reference sheet) that seeds an
// empty browser store. A failed fetch (including file://) leaves the app empty.
async function loadBundleManifest() {
  try {
    const res = await fetch("./project.json", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.app === "glyph-trace-studio-bundle" ? data : null;
  } catch {
    return null;
  }
}

async function fetchBundleJson(source) {
  if (!source) return {};
  if (typeof source !== "string") return source;
  const res = await fetch(source, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${source}: ${res.status}`);
  return res.json();
}

// Import the bundle into state + IndexedDB. The legacy bundle manifest has
// one optional `ref`; normalize it to the same multi-image records as user
// uploads and v2 project files.
async function importBundle(bundle) {
  clearReferenceImage();
  state.settings = { ...DEFAULT_SETTINGS, ...(bundle.settings || {}) };
  applySettings();
  state.sources = await fetchBundleJson(bundle.sources);
  state.traces = await fetchBundleJson(bundle.traces);
  state.traceDrafts = {};
  state.glyphs = {};
  state.images = [];
  state.activeImageId = null;
  if (typeof bundle.glyphs === "string") {
    await Promise.all(
      state.chars.map(async (char) => {
        try {
          const res = await fetch(bundle.glyphs.replace("{name}", fileBase(state.settings, char)), { cache: "no-store" });
          if (!res.ok) return;
          state.glyphs[char] = await Exporters.blobToDataUrl(await res.blob());
        } catch {
          // Missing glyph PNGs are fine; the char just has no crop yet.
        }
      })
    );
  }
  if (bundle.ref) {
    try {
      const res = await fetch(bundle.ref, { cache: "no-store" });
      if (res.ok) {
        const blob = await res.blob();
        state.images = [{ id: "bundle-ref", name: imageNameFromPath(bundle.ref), blob }];
        state.activeImageId = "bundle-ref";
      }
    } catch {
      // Reference image not shipped with the repo; crop mode will ask for it.
    }
  }
  if (state.activeImageId) {
    for (const source of Object.values(state.sources)) {
      if (source?.box && !source.imageId) source.imageId = state.activeImageId;
    }
  }
  await ProjectStore.setMany(
    {
      settings: state.settings,
      sources: state.sources,
      traces: state.traces,
      glyphs: state.glyphs,
      images: state.images,
      activeImageId: state.activeImageId,
    },
    ["refImage"]
  );
}

// Reset the browser store to a fresh empty project. The defaults are
// persisted (not just deleted) so a page reload does NOT re-import the
// bundled project; "Reload bundled project" brings it back on demand.
async function newProject() {
  if (!state.newProjectConfirm) {
    state.newProjectConfirm = true;
    els.newProjectButton.textContent = t("settings.newProjectConfirm");
    return;
  }
  state.newProjectConfirm = false;
  els.newProjectButton.textContent = t("settings.newProject");
  state.settings = { ...DEFAULT_SETTINGS };
  state.sources = {};
  state.traces = {};
  state.traceDrafts = {};
  state.glyphs = {};
  state.images = [];
  state.activeImageId = null;
  state.lastBox = null;
  state.activeContour = 0;
  state.selectedPoint = null;
  await ProjectStore.setMany(
    {
      settings: state.settings,
      sources: {},
      traces: {},
      glyphs: {},
      images: [],
      activeImageId: null,
    },
    ["refImage"]
  );
  clearReferenceImage();
  applySettings();
  renderCharButtons();
  renderImageOptions();
  state.selected = state.chars[0];
  selectChar(state.selected);
  updateEmptyState();
  setStatus(t("status.projectCleared"), "ok");
}

async function reloadBundle() {
  if (!state.bundle) return;
  if (!state.bundleConfirm) {
    state.bundleConfirm = true;
    els.reloadBundleButton.textContent = t("settings.reloadBundleConfirm");
    return;
  }
  state.bundleConfirm = false;
  els.reloadBundleButton.textContent = t("settings.reloadBundle");
  setStatus(t("status.bundleLoading"));
  try {
    await importBundle(state.bundle);
    applySettings();
    renderCharButtons();
    renderImageOptions();
    if (state.activeImageId) activateImage(state.activeImageId, { persist: false });
    else clearReferenceImage();
    if (!state.chars.includes(state.selected)) state.selected = state.chars[0];
    selectChar(state.selected);
    setStatus(t("status.bundleLoaded"), "ok");
  } catch {
    setStatus(t("status.bundleFailed"), "error");
  }
}

// Recompute everything derived from state.settings (canvas px size, char
// list, trace world size) and sync the settings form.
function applySettings() {
  CANVAS_W = Math.max(8, Math.round(state.settings.svgW * PX_PER_MM));
  CANVAS_H = Math.max(8, Math.round(state.settings.svgH * PX_PER_MM));
  updateTraceWorldSize();
  state.chars = parseCharset(state.settings.chars);
  configureTraceCanvas();
  const aspect = `${CANVAS_W} / ${CANVAS_H}`;
  els.svgPreview.style.aspectRatio = aspect;
  els.pngPreview.style.aspectRatio = aspect;
  els.charsetInput.value = state.settings.chars;
  els.svgWInput.value = state.settings.svgW;
  els.svgHInput.value = state.settings.svgH;
  els.prefixInput.value = state.settings.prefix;
}

async function applySettingsFromForm() {
  const svgW = clampNumber(els.svgWInput.value, 1, 1000, state.settings.svgW);
  const svgH = clampNumber(els.svgHInput.value, 1, 1000, state.settings.svgH);
  const chars = parseCharset(els.charsetInput.value).join("");
  const prefix = els.prefixInput.value.trim() || DEFAULT_SETTINGS.prefix;
  const newW = Math.max(8, Math.round(svgW * PX_PER_MM));
  const newH = Math.max(8, Math.round(svgH * PX_PER_MM));
  const scaleX = newW / CANVAS_W;
  const scaleY = newH / CANVAS_H;
  if (scaleX !== 1 || scaleY !== 1) rescaleTraces(scaleX, scaleY);
  // Keep a bundle-supplied module prefix while the file prefix is unchanged;
  // once the user picks their own prefix it also names the modules.
  const modulePrefix = prefix === state.settings.prefix ? state.settings.modulePrefix || "" : "";
  state.settings = { chars, svgW, svgH, prefix, modulePrefix };
  applySettings();
  if (scaleX !== 1 || scaleY !== 1) await reRenderGlyphs();
  renderCharButtons();
  if (!state.chars.includes(state.selected)) {
    selectChar(state.chars[0]);
  } else {
    if (!state.lastBox && !state.sources[state.selected]) {
      state.box = defaultBox();
      updateFields();
      draw();
    }
    updateButtons();
    updateCharBadges();
    updatePreview();
    if (state.mode === "trace") {
      loadTraceImage();
      drawTrace();
    }
  }
  await persistProject();
  setStatus(t("status.settingsApplied"), "ok");
}

// Traces live in canvas px, so a canvas resize rescales every stored point
// (committed traces and in-progress drafts alike).
function rescaleTraces(scaleX, scaleY) {
  for (const trace of [...Object.values(state.traces), ...Object.values(state.traceDrafts)]) {
    for (const contour of trace.contours || []) {
      for (const point of contour) {
        point.x *= scaleX;
        point.y *= scaleY;
        point.inX *= scaleX;
        point.inY *= scaleY;
        point.outX *= scaleX;
        point.outY *= scaleY;
      }
    }
  }
}

async function reRenderGlyphs() {
  const imageCache = new Map();
  for (const [char, source] of Object.entries(state.sources)) {
    const record = imageById(source?.imageId);
    if (!source?.box || !record) continue;
    if (!imageCache.has(record.id)) {
      try {
        imageCache.set(record.id, await loadStoredImageElement(record));
      } catch {
        imageCache.set(record.id, null);
      }
    }
    const image = imageCache.get(record.id);
    if (image) state.glyphs[char] = renderGlyphPng(source, image);
  }
}

async function persistProject(keys = ["settings", "sources", "traces", "glyphs"]) {
  const values = {
    settings: state.settings,
    sources: state.sources,
    traces: state.traces,
    glyphs: state.glyphs,
  };
  await ProjectStore.setMany(Object.fromEntries(keys.map((key) => [key, values[key]])));
}

function clearReferenceImage() {
  if (state.imageObjectUrl) URL.revokeObjectURL(state.imageObjectUrl);
  state.imageObjectUrl = null;
  state.loadedImageId = null;
  state.imageReady = false;
  state.image = new Image();
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  updateEmptyState();
}

function normalizeStoredImages(raw) {
  if (!Array.isArray(raw)) return [];
  const images = [];
  const seen = new Set();
  for (const entry of raw.slice(0, MAX_IMAGES)) {
    if (
      !entry ||
      !isImageId(entry.id) ||
      seen.has(entry.id) ||
      !(entry.blob instanceof Blob)
    ) {
      continue;
    }
    const name = typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim().slice(0, 128)
      : `Reference image ${images.length + 1}`;
    images.push({ id: entry.id, name, blob: entry.blob });
    seen.add(entry.id);
  }
  return images;
}

function imageById(imageId) {
  return state.images.find((image) => image.id === imageId) || null;
}

function imageNameFromPath(path) {
  const tail = String(path || "").split(/[\\/]/).pop() || "Reference image";
  try {
    return decodeURIComponent(tail).slice(0, 128);
  } catch {
    return tail.slice(0, 128);
  }
}

function newImageId(reservedIds = null) {
  let id;
  do {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") ||
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    id = `img-${random}`.slice(0, 64);
  } while (imageById(id) || reservedIds?.has(id));
  return id;
}

function imageUseCount(imageId) {
  return Object.values(state.sources).filter((source) => source?.imageId === imageId).length;
}

function renderImageOptions() {
  els.imageSelect.innerHTML = "";
  if (!state.images.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("image.none");
    els.imageSelect.append(option);
    els.imageSelect.disabled = true;
    els.removeImageButton.disabled = true;
    return;
  }
  for (const image of state.images) {
    const option = document.createElement("option");
    const uses = imageUseCount(image.id);
    option.value = image.id;
    option.textContent = uses ? `${image.name} (${uses})` : image.name;
    els.imageSelect.append(option);
  }
  els.imageSelect.disabled = false;
  els.removeImageButton.disabled = !state.activeImageId;
  els.imageSelect.value = imageById(state.activeImageId)?.id || state.images[0].id;
}

function loadReference(src) {
  if (state.imageObjectUrl && state.imageObjectUrl !== src) {
    URL.revokeObjectURL(state.imageObjectUrl);
  }
  state.imageObjectUrl = src;
  state.imageReady = false;
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  updateEmptyState();
  updatePreview();
  // Guard the callbacks by identity: a stale onload from a superseded load
  // must not size the canvas from (or flag ready) the newer, unloaded image.
  const image = new Image();
  state.image = image;
  image.onload = () => {
    if (state.image !== image) return;
    state.imageReady = true;
    els.canvas.width = image.naturalWidth;
    els.canvas.height = image.naturalHeight;
    state.box = clampBox(state.box);
    updateFields();
    if (state.mode === "crop") {
      applyZoomPreference();
    }
    updateEmptyState();
    draw();
    updatePreview();
    if (state.mode === "trace") loadTraceImage();
    requestAnimationFrame(centerSelectionInView);
  };
  image.onerror = () => {
    if (state.image !== image) return;
    state.loadedImageId = null;
    setStatus(t("status.imageLoadFailed"), "error");
    updateEmptyState();
  };
  image.src = src;
}

function activateImage(imageId, { persist = true } = {}) {
  const record = imageById(imageId);
  if (!record) {
    state.activeImageId = null;
    renderImageOptions();
    clearReferenceImage();
    return;
  }
  const alreadySelected = state.loadedImageId === record.id && Boolean(state.imageObjectUrl);
  state.activeImageId = record.id;
  renderImageOptions();
  updateSourceSummary();
  if (!alreadySelected) {
    state.loadedImageId = record.id;
    loadReference(URL.createObjectURL(record.blob));
  }
  if (persist) {
    void ProjectStore.set("activeImageId", record.id).catch((error) => {
      setStatus(`${t("status.saveFailed")}: ${error.message}`, "error");
    });
  }
}

async function loadStoredImageElement(record) {
  if (record.id === state.activeImageId && state.imageReady) return state.image;
  const url = URL.createObjectURL(record.blob);
  try {
    return await loadImageElement(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function removeActiveImage() {
  const imageId = state.activeImageId;
  if (!imageId) return;
  const uses = imageUseCount(imageId);
  if (uses) {
    setStatus(t("status.imageInUse", { count: uses }), "error");
    return;
  }
  const index = state.images.findIndex((image) => image.id === imageId);
  if (index < 0) return;
  const images = state.images.filter((image) => image.id !== imageId);
  const activeImageId = images[Math.min(index, images.length - 1)]?.id || null;
  try {
    await ProjectStore.setMany({ images, activeImageId }, ["refImage"]);
    state.images = images;
    state.activeImageId = activeImageId;
    renderImageOptions();
    if (activeImageId) activateImage(activeImageId, { persist: false });
    else clearReferenceImage();
    updateSourceSummary();
    setStatus(t("status.imageRemoved"), "ok");
  } catch (error) {
    setStatus(`${t("status.saveFailed")}: ${error.message}`, "error");
  }
}

// Monotonic token so a slow decode of an earlier pick cannot overwrite a
// later one (the last file the user chose always wins).
let imageFileToken = 0;

async function prepareImageFile(file) {
  const probeUrl = URL.createObjectURL(file);
  try {
    const probe = await loadImageElement(probeUrl);
    let blob = file;
    const maxDim = Math.max(probe.naturalWidth, probe.naturalHeight);
    if (maxDim > MAX_IMAGE_DIM) {
      const scale = MAX_IMAGE_DIM / maxDim;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(probe.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(probe.naturalHeight * scale));
      const scaleCtx = canvas.getContext("2d");
      scaleCtx.imageSmoothingEnabled = true;
      scaleCtx.imageSmoothingQuality = "high";
      scaleCtx.drawImage(probe, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!(blob instanceof Blob)) throw new Error("image conversion failed");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(probeUrl);
  }
}

async function handleImageFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length || files.some((file) => !file.type.startsWith("image/"))) {
    setStatus(t("status.imageLoadFailed"), "error");
    return;
  }
  if (state.images.length + files.length > MAX_IMAGES) {
    setStatus(t("status.tooManyImages", { max: MAX_IMAGES }), "error");
    return;
  }
  if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
    setStatus(t("status.fileTooLarge", { limit: Math.round(MAX_IMAGE_BYTES / 1048576) }), "error");
    return;
  }
  const token = ++imageFileToken;
  setStatus(t("status.loadingImage"));
  try {
    const prepared = [];
    const reservedIds = new Set();
    for (const file of files) {
      const id = newImageId(reservedIds);
      reservedIds.add(id);
      prepared.push({
        id,
        name: (
          file.name || `Reference image ${state.images.length + prepared.length + 1}`
        ).slice(0, 128),
        blob: await prepareImageFile(file),
      });
    }
    if (token !== imageFileToken) return;
    const images = [...state.images, ...prepared];
    const activeImageId = prepared[0].id;
    await ProjectStore.setMany({ images, activeImageId }, ["refImage"]);
    if (token !== imageFileToken) return;
    state.images = images;
    state.activeImageId = activeImageId;
    renderImageOptions();
    activateImage(activeImageId, { persist: false });
    setStatus(t("status.imagesAdded", { count: prepared.length }), "ok");
  } catch {
    if (token === imageFileToken) setStatus(t("status.imageLoadFailed"), "error");
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function updateEmptyState() {
  els.emptyState.hidden = !(state.mode === "crop" && !state.activeImageId);
}

function renderLanguageOptions() {
  els.languageSelect.innerHTML = "";
  for (const [code, config] of Object.entries(LANGUAGES)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = config.label;
    els.languageSelect.append(option);
  }
  els.languageSelect.value = state.language;
}

function setLanguage(language) {
  state.language = languageOrDefault(language);
  els.languageSelect.value = state.language;
  persistUiState();
  applyTranslations();
  updateSourceSummary();
  if (state.mode === "trace") drawTrace();
}

function languageOrDefault(language) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, language) ? language : DEFAULT_LANGUAGE;
}

function t(key, params = {}) {
  const fallbackMessages = LANGUAGES[DEFAULT_LANGUAGE].messages;
  const messages = LANGUAGES[state.language]?.messages || fallbackMessages;
  const template = messages[key] || fallbackMessages[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

function applyTranslations() {
  const config = LANGUAGES[state.language] || LANGUAGES[DEFAULT_LANGUAGE];
  els.root.lang = config.htmlLang;
  document.title = t("app.documentTitle");
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    for (const pair of element.dataset.i18nAttr.split(",")) {
      const [attribute, key] = pair.split(":").map((part) => part.trim());
      if (attribute && key) element.setAttribute(attribute, t(key));
    }
  });
  renderImageOptions();
}

function renderCharButtons() {
  els.charGrid.innerHTML = "";
  for (const char of state.chars) {
    const button = document.createElement("button");
    button.className = "char-button";
    button.type = "button";
    button.textContent = char;
    button.dataset.char = char;
    button.addEventListener("click", () => selectChar(char));
    els.charGrid.append(button);
  }
  updateButtons();
  updateCharBadges();
}

function updateCharBadges() {
  for (const button of els.charGrid.querySelectorAll(".char-button")) {
    const char = button.dataset.char;
    button.classList.toggle("has-glyph", Boolean(state.glyphs[char]));
    button.classList.toggle(
      "has-trace",
      Boolean(state.traces[char]?.contours?.some((contour) => contour.length >= 3))
    );
  }
}

function bindEvents() {
  els.languageSelect.addEventListener("change", () => setLanguage(els.languageSelect.value));
  els.canvas.addEventListener("pointerdown", onPointerDown);
  els.canvas.addEventListener("pointermove", onPointerMove);
  els.canvas.addEventListener("pointerleave", () => {
    if (!state.dragging) els.canvas.style.cursor = "crosshair";
  });
  els.scroller.addEventListener("wheel", onWheelZoom, { passive: false });
  els.traceStage.addEventListener("wheel", onWheelZoom, { passive: false });
  els.traceStage.addEventListener("scroll", () => drawTraceOverlayRulers(), { passive: true });
  window.addEventListener("pointerup", onPointerUp);
  els.zoom.addEventListener("input", () => setZoom(Number(els.zoom.value)));
  els.fitButton.addEventListener("click", fitToView);
  els.gridToggleButton.addEventListener("click", toggleGrid);
  new ResizeObserver(() => {
    if (state.imageReady && !state.dragging) constrainScroll();
  }).observe(els.scroller);
  new ResizeObserver(() => {
    if (state.mode === "trace") {
      constrainScroll();
      drawTraceOverlayRulers();
    }
  }).observe(els.traceStage);
  for (const input of [els.x0, els.y0, els.width, els.height]) {
    input.addEventListener("input", updateBoxFromFields);
  }
  els.polarity.addEventListener("change", () => {
    updateDraftCrop();
    updatePreview();
  });
  els.threshold.addEventListener("input", () => {
    els.thresholdValue.textContent = els.threshold.value;
    updateDraftCrop();
    updatePreview();
  });
  els.offsetX.addEventListener("input", () => {
    updateDraftCrop();
    updatePreview();
  });
  els.saveButton.addEventListener("click", saveCrop);
  els.cropModeButton.addEventListener("click", () => setMode("crop"));
  els.traceModeTopButton.addEventListener("click", () => setMode("trace"));
  els.traceOverlayButton.addEventListener("click", () => setTraceView("overlay"));
  els.traceSideBySideButton.addEventListener("click", () => setTraceView("side-by-side"));
  els.addContourButton.addEventListener("click", addContour);
  els.deletePointButton.addEventListener("click", deleteSelectedPoint);
  els.setOuterButton.addEventListener("click", setContourOuter);
  els.setHoleButton.addEventListener("click", setContourHole);
  els.undoTraceButton.addEventListener("click", undoTracePoint);
  els.clearTraceButton.addEventListener("click", clearTrace);
  els.saveTraceButton.addEventListener("click", saveTrace);
  els.autoTraceButton.addEventListener("click", autoTraceCurrent);
  els.traceCanvas.addEventListener("pointerdown", onTracePointerDown);
  els.traceCanvas.addEventListener("pointermove", onTracePointerMove);
  window.addEventListener("pointerup", onTracePointerUp);

  els.uploadButton.addEventListener("click", () => els.filePicker.click());
  els.emptyUploadButton.addEventListener("click", () => els.filePicker.click());
  els.imageSelect.addEventListener("change", () => activateImage(els.imageSelect.value));
  els.removeImageButton.addEventListener("click", removeActiveImage);
  els.filePicker.addEventListener("change", () => {
    const files = Array.from(els.filePicker.files || []);
    els.filePicker.value = "";
    if (files.length) handleImageFiles(files);
  });
  els.canvasShell.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.scroller.classList.add("drag-over");
    els.emptyState.classList.add("drag-over");
  });
  els.canvasShell.addEventListener("dragleave", () => {
    els.scroller.classList.remove("drag-over");
    els.emptyState.classList.remove("drag-over");
  });
  els.canvasShell.addEventListener("drop", (event) => {
    event.preventDefault();
    els.scroller.classList.remove("drag-over");
    els.emptyState.classList.remove("drag-over");
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) handleImageFiles(files);
  });

  els.downloadSvgButton.addEventListener("click", downloadCurrentSvg);
  els.downloadScadButton.addEventListener("click", downloadCurrentScad);
  els.downloadPngButton.addEventListener("click", downloadCurrentPng);
  els.downloadZipButton.addEventListener("click", downloadZip);
  els.exportProjectButton.addEventListener("click", exportProject);
  els.importProjectButton.addEventListener("click", () => els.projectPicker.click());
  els.projectPicker.addEventListener("change", () => {
    const file = els.projectPicker.files?.[0];
    els.projectPicker.value = "";
    if (file) importProject(file);
  });
  els.applySettingsButton.addEventListener("click", applySettingsFromForm);
  els.reloadBundleButton.addEventListener("click", reloadBundle);
  els.newProjectButton.addEventListener("click", newProject);
}

function selectChar(char) {
  state.selected = char;
  state.activeContour = 0;
  state.selectedPoint = null;
  persistUiState();
  const source = state.sources[char];
  state.box = source ? [...source.box] : defaultBox();
  els.polarity.value = source?.polarity || "dark";
  els.threshold.value = source?.threshold || 110;
  els.thresholdValue.textContent = els.threshold.value;
  els.offsetX.value = Math.round(Number(source?.offset_x) || 0);
  els.previewTitle.textContent = char;
  if (source?.imageId && source.imageId !== state.activeImageId && imageById(source.imageId)) {
    activateImage(source.imageId);
  }
  setStatus("");
  updateButtons();
  updateFields();
  updatePreview();
  loadTraceImage();
  updateTraceButtons();
  drawTrace();
  draw();
  requestAnimationFrame(centerSelectionInView);
}

function updateButtons() {
  for (const button of els.charGrid.querySelectorAll(".char-button")) {
    button.classList.toggle("active", button.dataset.char === state.selected);
  }
}

// Characters without a saved crop inherit the last box the user worked with,
// so the same frame can be dragged from glyph to glyph; before any adjustment
// the box starts at the project W/H (in reference-image px).
function defaultBox() {
  if (state.lastBox) return [...state.lastBox];
  const w = Math.max(1, Math.round(state.settings.svgW));
  const h = Math.max(1, Math.round(state.settings.svgH));
  return [0, 0, w, h];
}

function exportOpts(char) {
  return {
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    svgW: state.settings.svgW,
    svgH: state.settings.svgH,
    shapeId: moduleName(state.settings, char),
    moduleName: moduleName(state.settings, char),
    // Matches the comment in the repo's shipped 1992 .scad files, so app
    // exports round-trip byte-identically.
    comment: `Generated from manual Bezier trace for ${fileBase(state.settings, char)}.svg`,
  };
}

// SVG preview: shows the in-progress draft when one exists (so auto-trace
// results can be reviewed before saving), else the committed trace.
function buildGlyphSvg(char) {
  const draft = state.traceDrafts[char];
  const contours = ((draft ? draft.contours : state.traces[char]?.contours) || []).filter(
    (contour) => contour.length >= 3
  );
  return contours.length ? Exporters.buildSvg(contours, exportOpts(char)) : null;
}

function blankImage() {
  return Exporters.svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}"/>`
  );
}

function updatePreview() {
  if (state.previewFrame) {
    cancelAnimationFrame(state.previewFrame);
    state.previewFrame = null;
  }
  const char = state.selected;
  const svg = buildGlyphSvg(char);
  els.svgPreview.src = svg ? Exporters.svgDataUrl(svg) : blankImage();
  if (state.imageReady) {
    els.pngPreview.src = renderLivePreview();
  } else if (state.glyphs[char]) {
    els.pngPreview.src = state.glyphs[char];
  } else {
    els.pngPreview.src = blankImage();
  }
}

function configureTraceCanvas() {
  // CSS display size only; drawTrace() sizes the backing store to device px.
  els.traceCanvas.style.width = `${TRACE_WORLD_W * TRACE_SCALE}px`;
  els.traceCanvas.style.height = `${TRACE_WORLD_H * TRACE_SCALE}px`;
}

function updateTraceWorldSize() {
  const sideBySideWidth = state.traceView === "side-by-side" ? TRACE_SIDE_GAP + CANVAS_W : 0;
  TRACE_WORLD_W = TRACE_RULER + TRACE_PAD * 2 + CANVAS_W + sideBySideWidth;
  TRACE_WORLD_H = TRACE_RULER + TRACE_PAD * 2 + CANVAS_H;
}

function loadUiState() {
  try {
    return JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistUiState() {
  try {
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        language: state.language,
        mode: state.mode,
        traceView: state.traceView,
        showGrid: state.showGrid,
        selected: state.selected,
        cropZoom: state.zoomByMode.crop,
        traceZoom: state.zoomByMode.trace,
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function applyZoomPreference() {
  const stored = state.zoomByMode[state.mode];
  if (stored != null) {
    setZoom(stored);
    return;
  }
  fitToView();
}

function schedulePreviewUpdate() {
  if (state.previewFrame) return;
  state.previewFrame = requestAnimationFrame(() => {
    state.previewFrame = null;
    updatePreview();
  });
}

function updateFields() {
  const [x0, y0, x1, y1] = state.box.map(Math.round);
  els.x0.value = x0;
  els.y0.value = y0;
  els.width.value = Math.max(1, x1 - x0);
  els.height.value = Math.max(1, y1 - y0);
  updateSourceSummary();
}

function updateBoxFromFields() {
  const x0 = numberValue(els.x0, 0);
  const y0 = numberValue(els.y0, 0);
  const width = Math.max(1, numberValue(els.width, 1));
  const height = Math.max(1, numberValue(els.height, 1));
  state.box = clampBox([x0, y0, x0 + width, y0 + height]);
  updateDraftCrop();
  updatePreview();
  draw();
}

// Live crop adjustments are a draft: they stay in state.box / the form
// controls (and carry between glyphs via lastBox) until "Save crop" commits
// them into state.sources. Persist paths therefore never see unsaved edits.
function updateDraftCrop() {
  state.lastBox = [...state.box];
  updateSourceSummary();
}

function offsetXValue() {
  return Math.round(numberValue(els.offsetX, 0));
}

function updateSourceSummary() {
  const source = state.sources[state.selected];
  const sourceImage = imageById(source?.imageId);
  const draftImage = imageById(state.activeImageId);
  const [x0, y0, x1, y1] = clampBox(state.box).map(Math.round);
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const sourceLabel = source ? sourceLabelFor(source.source) : t("source.unset");
  const sourceDetail =
    source?.source && source.source !== "manual"
      ? t("source.from", { source: escapeHtml(source.source) })
      : t("source.manualDetail");

  els.sourceInfo.innerHTML = `
    <div class="source-title">${t("source.title")}</div>
    <div class="source-grid">
      <div>
        <span>${t("source.source")}</span>
        <strong>${sourceLabel}</strong>
        <small>${source ? sourceDetail : t("source.chooseOrSave")}</small>
      </div>
      <div>
        <span>${t("source.image")}</span>
        <strong>${escapeHtml(
          source ? sourceImage?.name || t("source.imageMissing") : draftImage?.name || t("image.none")
        )}</strong>
        <small>${source ? t("source.imageDetail") : t("source.imageDraft")}</small>
      </div>
      <div>
        <span>${t("source.topLeft")}</span>
        <strong>X ${x0}, Y ${y0}</strong>
        <small>${t("source.topLeftDetail")}</small>
      </div>
      <div>
        <span>${t("source.size")}</span>
        <strong>${width} x ${height} px</strong>
        <small>${t("source.sizeDetail")}</small>
      </div>
    </div>
  `;
}

function sourceLabelFor(source) {
  if (!source) return t("source.unset");
  if (source === "manual") return t("source.manual");
  return t("source.auto");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function numberValue(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function updateZoomLabel() {
  els.zoomValue.textContent = `${Math.round(Number(els.zoom.value))}%`;
}

function setZoom(value, anchor = null) {
  const min = Number(els.zoom.min);
  const max = Number(els.zoom.max);
  const next = Math.max(min, Math.min(max, value));
  els.zoom.value = next;
  updateZoomLabel();
  const surface = zoomSurface();
  if (!surface) return;
  const before = canvasAnchor(anchor, surface.canvas, surface.scroller);
  const pct = next / 100;
  surface.canvas.style.width = `${Math.round(surface.baseWidth * pct)}px`;
  surface.canvas.style.height = `${Math.round(surface.baseHeight * pct)}px`;
  restoreAnchor(before, anchor, surface.canvas, surface.scroller);
  state.zoomByMode[state.mode] = next;
  persistUiState();
  constrainScroll();
  if (state.mode === "trace") drawTrace();
}

function fitToView() {
  const surface = zoomSurface();
  if (!surface) return;
  const pad = 36;
  const fitW = Math.max(1, surface.scroller.clientWidth - pad * 2);
  const fitH = Math.max(1, surface.scroller.clientHeight - pad * 2);
  const fit = Math.min(fitW / surface.baseWidth, fitH / surface.baseHeight) * 100;
  setZoom(fit);
}

function toggleGrid() {
  state.showGrid = !state.showGrid;
  updateGridToggle();
  persistUiState();
  if (state.mode === "trace") drawTrace();
}

function updateGridToggle() {
  els.gridToggleButton.classList.toggle("active", state.showGrid);
  els.gridToggleButton.setAttribute("aria-pressed", String(state.showGrid));
}

function zoomSurface() {
  if (state.mode === "trace") {
    return {
      canvas: els.traceCanvas,
      scroller: els.traceStage,
      baseWidth: TRACE_WORLD_W * TRACE_SCALE,
      baseHeight: TRACE_WORLD_H * TRACE_SCALE,
    };
  }
  if (!state.imageReady) return null;
  return {
    canvas: els.canvas,
    scroller: els.scroller,
    baseWidth: state.image.naturalWidth,
    baseHeight: state.image.naturalHeight,
  };
}

function canvasAnchor(anchor, canvas, scroller) {
  const rect = canvas.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const viewportX = anchor ? anchor.clientX : scrollerRect.left + scroller.clientWidth / 2;
  const viewportY = anchor ? anchor.clientY : scrollerRect.top + scroller.clientHeight / 2;
  return {
    xRatio: rect.width > 0 ? (viewportX - rect.left) / rect.width : 0.5,
    yRatio: rect.height > 0 ? (viewportY - rect.top) / rect.height : 0.5,
    viewportX,
    viewportY,
  };
}

function restoreAnchor(before, anchor, canvas, scroller) {
  const rect = canvas.getBoundingClientRect();
  const viewportX = anchor ? anchor.clientX : before.viewportX;
  const viewportY = anchor ? anchor.clientY : before.viewportY;
  scroller.scrollLeft += before.xRatio * rect.width - (viewportX - rect.left);
  scroller.scrollTop += before.yRatio * rect.height - (viewportY - rect.top);
}

function constrainScroll() {
  const surface = zoomSurface();
  if (!surface) return;
  surface.scroller.scrollLeft = Math.max(
    0,
    Math.min(surface.scroller.scrollLeft, surface.scroller.scrollWidth - surface.scroller.clientWidth)
  );
  surface.scroller.scrollTop = Math.max(
    0,
    Math.min(surface.scroller.scrollTop, surface.scroller.scrollHeight - surface.scroller.clientHeight)
  );
}

function centerSelectionInView() {
  if (!state.imageReady) return;
  const [x0, y0, x1, y1] = clampBox(state.box);
  const scaleX = els.canvas.clientWidth / els.canvas.width;
  const scaleY = els.canvas.clientHeight / els.canvas.height;
  const centerX = ((x0 + x1) / 2) * scaleX;
  const centerY = ((y0 + y1) / 2) * scaleY;
  els.scroller.scrollLeft = els.canvas.offsetLeft + centerX - els.scroller.clientWidth / 2;
  els.scroller.scrollTop = els.canvas.offsetTop + centerY - els.scroller.clientHeight / 2;
  constrainScroll();
}

function onWheelZoom(event) {
  if (!zoomSurface() || (!event.ctrlKey && !event.metaKey)) return;
  event.preventDefault();
  const before = Number(els.zoom.value);
  const next = Math.max(Number(els.zoom.min), Math.min(Number(els.zoom.max), before + (event.deltaY < 0 ? 8 : -8)));
  if (next === before) return;
  setZoom(next, event);
}

function onPointerDown(event) {
  if (!state.imageReady || state.mode !== "crop") return;
  const point = canvasPoint(event);
  const [x0, y0, x1, y1] = clampBox(state.box);
  const width = x1 - x0;
  const height = y1 - y0;
  state.dragging = true;
  if (pointInBox(point, state.box)) {
    state.dragOffset = { x: point.x - x0, y: point.y - y0 };
  } else {
    state.dragOffset = { x: Math.round(width / 2), y: Math.round(height / 2) };
    state.box = boxFromOrigin(point.x - state.dragOffset.x, point.y - state.dragOffset.y, width, height);
  }
  els.canvas.setPointerCapture(event.pointerId);
  updateFields();
  updateDraftCrop();
  schedulePreviewUpdate();
  draw();
}

function onPointerMove(event) {
  if (state.mode !== "crop") return;
  const point = canvasPoint(event);
  if (!state.dragging) {
    els.canvas.style.cursor = pointInBox(point, state.box) ? "move" : "crosshair";
    return;
  }
  const [x0, y0, x1, y1] = clampBox(state.box);
  const width = x1 - x0;
  const height = y1 - y0;
  const offset = state.dragOffset || { x: Math.round(width / 2), y: Math.round(height / 2) };
  state.box = boxFromOrigin(point.x - offset.x, point.y - offset.y, width, height);
  updateFields();
  updateDraftCrop();
  schedulePreviewUpdate();
  draw();
}

function onPointerUp() {
  if (!state.dragging) return;
  state.dragging = false;
  state.dragOffset = null;
  updateDraftCrop();
  updatePreview();
}

function setMode(mode) {
  state.mode = mode;
  persistUiState();
  els.cropModeButton.classList.toggle("active", mode === "crop");
  els.traceModeTopButton.classList.toggle("active", mode === "trace");
  els.traceViewSwitch.hidden = mode !== "trace";
  els.cropControls.hidden = mode !== "crop";
  els.traceControls.hidden = mode !== "trace";
  els.scroller.hidden = mode !== "crop";
  els.traceStage.hidden = mode !== "trace";
  els.gridToggleButton.hidden = mode !== "trace";
  updateTraceViewButtons();
  updateGridToggle();
  updateEmptyState();
  els.zoom.value = String(state.zoomByMode[mode] ?? 100);
  updateZoomLabel();
  if (mode === "trace") {
    loadTraceImage();
    updateTraceButtons();
    applyZoomPreference();
    drawTrace();
    requestAnimationFrame(drawTraceOverlayRulers);
  } else {
    if (state.imageReady) {
      applyZoomPreference();
    }
    draw();
  }
}

function setTraceView(view) {
  const next = view === "side-by-side" ? "side-by-side" : "overlay";
  if (state.traceView === next) return;
  state.traceView = next;
  updateTraceWorldSize();
  configureTraceCanvas();
  updateTraceViewButtons();
  persistUiState();
  if (state.mode !== "trace") return;
  // Fit after a layout switch so both panels are immediately visible in
  // side-by-side mode and the canvas fills the stage again in overlay mode.
  fitToView();
  drawTrace();
  requestAnimationFrame(drawTraceOverlayRulers);
}

function updateTraceViewButtons() {
  const overlay = state.traceView === "overlay";
  els.traceOverlayButton.classList.toggle("active", overlay);
  els.traceSideBySideButton.classList.toggle("active", !overlay);
  els.traceOverlayButton.setAttribute("aria-pressed", String(overlay));
  els.traceSideBySideButton.setAttribute("aria-pressed", String(!overlay));
  els.traceStage.dataset.view = state.traceView;
}

// The working copy edited on the trace canvas. Created lazily from the
// committed trace; committed data is only touched by "Save trace", so
// unsaved edits can never leak into IndexedDB via other persist paths.
function currentTrace() {
  const char = state.selected;
  if (!state.traceDrafts[char]) {
    const committed = state.traces[char];
    state.traceDrafts[char] = committed
      ? structuredClone(committed)
      : { char, contours: [] };
  }
  return state.traceDrafts[char];
}

function activeContour() {
  const trace = currentTrace();
  if (!trace.contours[state.activeContour]) {
    trace.contours[state.activeContour] = [];
  }
  return trace.contours[state.activeContour];
}

function addContour() {
  const trace = currentTrace();
  trace.contours.push([]);
  state.activeContour = trace.contours.length - 1;
  state.selectedPoint = null;
  updateTraceButtons();
  drawTrace();
}

function undoTracePoint() {
  const contour = activeContour();
  contour.pop();
  state.selectedPoint = contour.length ? { contour: state.activeContour, point: contour.length - 1 } : null;
  updateTraceButtons();
  drawTrace();
}

function clearTrace() {
  state.traceDrafts[state.selected] = { char: state.selected, contours: [[]] };
  state.activeContour = 0;
  state.selectedPoint = null;
  updateTraceButtons();
  updatePreview();
  drawTrace();
}

// The tracer runs in a module worker so large masks cannot freeze the UI
// thread; when workers are unavailable or the worker fails to load, it
// degrades to the same synchronous call (after yielding a frame so the
// status message paints first).
let autoTraceWorker = null;
let autoTraceWorkerBroken = false;
let autoTraceJobId = 0;
const autoTraceJobs = new Map();

function failAutoTraceWorker() {
  autoTraceWorkerBroken = true;
  if (autoTraceWorker) autoTraceWorker.terminate();
  autoTraceWorker = null;
  const jobs = [...autoTraceJobs.values()];
  autoTraceJobs.clear();
  for (const job of jobs) job.fallback();
}

async function traceMaskSync(mask, width, height, round) {
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  return AutoTrace.traceMask(mask, width, height, { round });
}

function traceMaskAsync(mask, width, height, round) {
  if (autoTraceWorkerBroken || typeof Worker === "undefined") {
    return traceMaskSync(mask, width, height, round);
  }
  try {
    if (!autoTraceWorker) {
      autoTraceWorker = new Worker(new URL("./autotrace-worker.js", import.meta.url), {
        type: "module",
      });
      autoTraceWorker.onmessage = (event) => {
        const job = autoTraceJobs.get(event.data.id);
        if (!job) return;
        autoTraceJobs.delete(event.data.id);
        if (event.data.error) job.reject(new Error(event.data.error));
        else job.resolve(event.data.contours);
      };
      autoTraceWorker.onerror = () => failAutoTraceWorker();
    }
    return new Promise((resolve, reject) => {
      const id = ++autoTraceJobId;
      autoTraceJobs.set(id, {
        resolve,
        reject,
        fallback: () => traceMaskSync(mask, width, height, round).then(resolve, reject),
      });
      // The mask is cloned (not transferred) so the fallback can still use it.
      autoTraceWorker.postMessage({ id, mask, width, height, round });
    });
  } catch {
    return traceMaskSync(mask, width, height, round);
  }
}

// Run the ported auto-tracer on the saved glyph PNG and stage the result as
// the in-memory draft for review; Save trace persists it (the committed
// trace is untouched until then — reloading the page discards the draft).
async function autoTraceCurrent() {
  const char = state.selected;
  const src = state.glyphs[char];
  if (!src) {
    setStatus(t("status.noGlyphPng", { char }), "error");
    return;
  }
  els.autoTraceButton.disabled = true;
  setStatus(t("status.autoTracing", { char }));
  try {
    const image = await loadImageElement(src);
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const maskCtx = canvas.getContext("2d", { willReadFrequently: true });
    maskCtx.drawImage(image, 0, 0, CANVAS_W, CANVAS_H);
    const data = maskCtx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
    const mask = new Uint8Array(CANVAS_W * CANVAS_H);
    for (let i = 0; i < mask.length; i += 1) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    const round = clampNumber(els.autoRoundInput.value, 0, 1, AutoTrace.DEFAULT_ROUND);
    const contours = await traceMaskAsync(mask, CANVAS_W, CANVAS_H, round);
    if (!contours.length) throw new Error(t("status.needContour"));
    state.traceDrafts[char] = { char, contours };
    state.activeContour = 0;
    state.selectedPoint = null;
    updateTraceButtons();
    updatePreview();
    drawTrace();
    setStatus(t("status.autoTraced", { char, count: contours.length }), "ok");
  } catch (error) {
    setStatus(`${t("status.autoTraceFailed")}: ${error.message}`, "error");
  } finally {
    els.autoTraceButton.disabled = false;
  }
}

function loadTraceImage() {
  const source = state.sources[state.selected];
  const src =
    state.glyphs[state.selected] ||
    (state.imageReady && source?.box && source.imageId === state.activeImageId
      ? renderGlyphPng(source)
      : null);
  // selectChar() and setMode("trace") can run back-to-back during startup;
  // keep the first in-flight or decoded image instead of decoding it twice.
  if (src && src === state.traceImageSrc) return;
  state.traceImageReady = false;
  state.traceImageSrc = src;
  if (!src) {
    drawTrace();
    return;
  }
  const image = new Image();
  state.traceImage = image;
  image.onload = () => {
    if (state.traceImage !== image) return;
    state.traceImageReady = true;
    drawTrace();
  };
  image.onerror = () => {
    if (state.traceImage !== image) return;
    state.traceImageSrc = null;
    drawTrace();
  };
  image.src = src;
}

function onTracePointerDown(event) {
  if (state.mode !== "trace") return;
  const point = tracePoint(event);
  const hit = hitTraceHandle(point);
  if (hit) {
    state.activeContour = hit.contour;
    state.selectedPoint = { contour: hit.contour, point: hit.point };
    state.traceDragging = { ...hit, start: point };
  } else {
    const segment = hitTraceSegment(point);
    if (segment) {
      const insertedIndex = insertTracePointOnSegment(segment);
      state.activeContour = segment.contour;
      state.selectedPoint = { contour: segment.contour, point: insertedIndex };
      state.traceDragging = { contour: segment.contour, point: insertedIndex, kind: "anchor", start: point };
    } else {
      if (!pointInTraceCanvas(point)) return;
      const contour = activeContour();
      contour.push(makeTracePoint(point.x, point.y));
      state.selectedPoint = { contour: state.activeContour, point: contour.length - 1 };
      state.traceDragging = { contour: state.activeContour, point: contour.length - 1, kind: "anchor", start: point };
    }
  }
  updateTraceButtons();
  els.traceCanvas.setPointerCapture(event.pointerId);
  drawTrace();
}

function onTracePointerMove(event) {
  if (state.mode !== "trace") return;
  const point = tracePoint(event);
  if (!state.traceDragging) {
    const hit = hitTraceHandle(point) || hitTraceSegment(point);
    els.traceCanvas.style.cursor = hit ? "move" : pointInTraceCanvas(point) ? "crosshair" : "default";
    return;
  }
  const drag = state.traceDragging;
  const contour = currentTrace().contours[drag.contour];
  const item = contour?.[drag.point];
  if (!item) return;
  if (drag.kind === "anchor") {
    const nextX = clampTraceX(point.x, "anchor");
    const nextY = clampTraceY(point.y, "anchor");
    const dx = nextX - item.x;
    const dy = nextY - item.y;
    item.x = nextX;
    item.y = nextY;
    item.inX += dx;
    item.inY += dy;
    item.outX += dx;
    item.outY += dy;
  } else if (drag.kind === "in") {
    item.inX = clampTraceX(point.x, "control");
    item.inY = clampTraceY(point.y, "control");
  } else if (drag.kind === "out") {
    item.outX = clampTraceX(point.x, "control");
    item.outY = clampTraceY(point.y, "control");
  }
  drawTrace();
}

function onTracePointerUp() {
  state.traceDragging = null;
}

function deleteSelectedPoint() {
  if (!state.selectedPoint) {
    setStatus(t("status.selectBlackNode"), "error");
    return;
  }
  const trace = currentTrace();
  const contour = trace.contours[state.selectedPoint.contour];
  if (!contour) return;
  contour.splice(state.selectedPoint.point, 1);
  if (contour.length === 0) {
    trace.contours.splice(state.selectedPoint.contour, 1);
    state.activeContour = Math.max(0, Math.min(state.activeContour, trace.contours.length - 1));
  } else {
    state.activeContour = Math.min(state.selectedPoint.contour, trace.contours.length - 1);
  }
  state.selectedPoint = null;
  updateTraceButtons();
  drawTrace();
}

function setContourOuter() {
  const trace = currentTrace();
  if (!trace.contours.length) return;
  const index = state.activeContour;
  if (index === 0) {
    setStatus(t("status.alreadyOuter"));
    return;
  }
  const [contour] = trace.contours.splice(index, 1);
  trace.contours.unshift(contour);
  state.activeContour = 0;
  remapSelectedPoint(index, 0);
  updateTraceButtons();
  drawTrace();
}

function setContourHole() {
  const trace = currentTrace();
  if (trace.contours.length < 2) {
    setStatus(t("status.needTwoContours"), "error");
    return;
  }
  const index = state.activeContour;
  if (index > 0) {
    setStatus(t("status.alreadyHole"));
    return;
  }
  const [contour] = trace.contours.splice(index, 1);
  trace.contours.push(contour);
  const nextIndex = trace.contours.length - 1;
  state.activeContour = nextIndex;
  remapSelectedPoint(index, nextIndex);
  updateTraceButtons();
  drawTrace();
}

function remapSelectedPoint(fromIndex, toIndex) {
  if (!state.selectedPoint || state.selectedPoint.contour !== fromIndex) return;
  state.selectedPoint = { contour: toIndex, point: state.selectedPoint.point };
}

function updateTraceButtons() {
  const trace = currentTrace();
  const hasContours = trace.contours.length > 0;
  els.deletePointButton.disabled = !state.selectedPoint;
  els.setOuterButton.disabled = !hasContours || state.activeContour === 0;
  els.setHoleButton.disabled = trace.contours.length < 2 || state.activeContour > 0;
}

function makeTracePoint(x, y) {
  const handle = 18;
  return {
    x,
    y,
    inX: Math.max(-TRACE_CONTROL_MARGIN, x - handle),
    inY: y,
    outX: Math.min(CANVAS_W + TRACE_CONTROL_MARGIN, x + handle),
    outY: y,
  };
}

function tracePoint(event) {
  const rect = els.traceCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * TRACE_WORLD_W - TRACE_IMAGE_X,
    y: ((event.clientY - rect.top) / rect.height) * TRACE_WORLD_H - TRACE_IMAGE_Y,
  };
}

function pointInTraceCanvas(point) {
  return point.x >= 0 && point.x <= CANVAS_W && point.y >= 0 && point.y <= CANVAS_H;
}

function clampTraceX(value, kind) {
  const min = kind === "control" ? -TRACE_CONTROL_MARGIN : 0;
  const max = kind === "control" ? CANVAS_W + TRACE_CONTROL_MARGIN : CANVAS_W;
  return Math.max(min, Math.min(max, value));
}

function clampTraceY(value, kind) {
  const min = kind === "control" ? -TRACE_CONTROL_MARGIN : 0;
  const max = kind === "control" ? CANVAS_H + TRACE_CONTROL_MARGIN : CANVAS_H;
  return Math.max(min, Math.min(max, value));
}

function hitTraceHandle(point) {
  const traces = currentTrace().contours;
  const radius = traceHitRadius();
  for (let ci = traces.length - 1; ci >= 0; ci -= 1) {
    const contour = traces[ci];
    for (let pi = contour.length - 1; pi >= 0; pi -= 1) {
      const item = contour[pi];
      for (const kind of ["anchor", "in", "out"]) {
        const hx = kind === "anchor" ? item.x : item[`${kind}X`];
        const hy = kind === "anchor" ? item.y : item[`${kind}Y`];
        if (Math.hypot(point.x - hx, point.y - hy) <= radius) {
          state.activeContour = ci;
          return { contour: ci, point: pi, kind };
        }
      }
    }
  }
  return null;
}

function hitTraceSegment(point) {
  const traces = currentTrace().contours;
  const maxDistance = traceHitRadius() * 1.4;
  let best = null;
  for (let ci = traces.length - 1; ci >= 0; ci -= 1) {
    const contour = traces[ci];
    if (contour.length < 2) continue;
    const segmentCount = contour.length >= 3 ? contour.length : contour.length - 1;
    for (let pi = 0; pi < segmentCount; pi += 1) {
      const current = contour[pi];
      const next = contour[(pi + 1) % contour.length];
      const hit = nearestPointOnCubic(point, current, next);
      if (hit.distance <= maxDistance && (!best || hit.distance < best.distance)) {
        best = { contour: ci, point: pi, t: hit.t, distance: hit.distance };
      }
    }
  }
  return best;
}

function traceHitRadius() {
  const pxPerUnit = tracePixelsPerUnit();
  return Math.max(2.5, Math.min(10, 9 / pxPerUnit));
}

function tracePixelsPerUnit() {
  const rect = els.traceCanvas.getBoundingClientRect();
  return rect.width > 0 ? rect.width / TRACE_WORLD_W : TRACE_SCALE;
}

function traceGridStep(pxPerUnit) {
  for (const step of GRID_STEPS) {
    if (step * pxPerUnit >= GRID_TARGET_PX) return step;
  }
  return GRID_STEPS[GRID_STEPS.length - 1];
}

function nearestPointOnCubic(target, start, end) {
  let best = { t: 0, distance: Infinity };
  const samples = 32;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = cubicPoint(start, end, t);
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    if (distance < best.distance) best = { t, distance };
  }
  const windowSize = 1 / samples;
  const refineStart = Math.max(0, best.t - windowSize);
  const refineEnd = Math.min(1, best.t + windowSize);
  for (let i = 0; i <= samples; i += 1) {
    const t = refineStart + (refineEnd - refineStart) * (i / samples);
    const point = cubicPoint(start, end, t);
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    if (distance < best.distance) best = { t, distance };
  }
  return best;
}

function cubicPoint(start, end, t) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * start.x + 3 * mt ** 2 * t * start.outX + 3 * mt * t ** 2 * end.inX + t ** 3 * end.x,
    y: mt ** 3 * start.y + 3 * mt ** 2 * t * start.outY + 3 * mt * t ** 2 * end.inY + t ** 3 * end.y,
  };
}

function insertTracePointOnSegment(segment) {
  const contour = currentTrace().contours[segment.contour];
  const start = contour[segment.point];
  const nextIndex = (segment.point + 1) % contour.length;
  const end = contour[nextIndex];
  const split = splitCubic(start, end, segment.t);
  start.outX = split.leftControl.x;
  start.outY = split.leftControl.y;
  end.inX = split.rightControl.x;
  end.inY = split.rightControl.y;

  const inserted = {
    x: split.anchor.x,
    y: split.anchor.y,
    inX: split.anchorIn.x,
    inY: split.anchorIn.y,
    outX: split.anchorOut.x,
    outY: split.anchorOut.y,
  };
  const insertAt = segment.point + 1;
  contour.splice(insertAt, 0, inserted);
  return insertAt;
}

function splitCubic(start, end, t) {
  const p0 = { x: start.x, y: start.y };
  const p1 = { x: start.outX, y: start.outY };
  const p2 = { x: end.inX, y: end.inY };
  const p3 = { x: end.x, y: end.y };
  const q0 = lerpPoint(p0, p1, t);
  const q1 = lerpPoint(p1, p2, t);
  const q2 = lerpPoint(p2, p3, t);
  const r0 = lerpPoint(q0, q1, t);
  const r1 = lerpPoint(q1, q2, t);
  const s = lerpPoint(r0, r1, t);
  return {
    leftControl: q0,
    anchorIn: r0,
    anchor: s,
    anchorOut: r1,
    rightControl: q2,
  };
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

// Size the trace canvas backing store to the displayed pixel density so the
// grid/paths stay crisp at any zoom (instead of CSS-scaling a fixed bitmap).
// The world->device transform is applied; all drawing stays in world units.
function applyTraceTransform() {
  const dpr = window.devicePixelRatio || 1;
  const ideal = tracePixelsPerUnit() * dpr;
  const maxScale = TRACE_MAX_BACKING / Math.max(TRACE_WORLD_W, TRACE_WORLD_H);
  const scale = Math.min(ideal, maxScale);
  const backW = Math.max(1, Math.round(TRACE_WORLD_W * scale));
  const backH = Math.max(1, Math.round(TRACE_WORLD_H * scale));
  if (els.traceCanvas.width !== backW) els.traceCanvas.width = backW;
  if (els.traceCanvas.height !== backH) els.traceCanvas.height = backH;
  traceCtx.setTransform(scale, 0, 0, scale, 0, 0);
}

function drawTrace() {
  applyTraceTransform();
  traceCtx.clearRect(0, 0, TRACE_WORLD_W, TRACE_WORLD_H);
  traceCtx.fillStyle = "#f8fafc";
  traceCtx.fillRect(0, 0, TRACE_WORLD_W, TRACE_WORLD_H);
  traceCtx.fillStyle = "#fff";
  traceCtx.fillRect(TRACE_IMAGE_X, TRACE_IMAGE_Y, CANVAS_W, CANVAS_H);
  if (state.traceView === "side-by-side") {
    const referenceX = traceReferenceX();
    traceCtx.fillRect(referenceX, TRACE_IMAGE_Y, CANVAS_W, CANVAS_H);
    if (state.traceImageReady) drawTraceImage(referenceX, 1);
    drawTracePanelLabel(t("trace.canvasLabel"), TRACE_IMAGE_X);
    drawTracePanelLabel(t("trace.referenceLabel"), referenceX);
  } else if (state.traceImageReady) {
    drawTraceImage(TRACE_IMAGE_X, 0.28);
  }
  drawTraceGrid();
  traceCtx.save();
  traceCtx.translate(TRACE_IMAGE_X, TRACE_IMAGE_Y);
  drawTracePaths();
  traceCtx.restore();
  drawTraceOverlayRulers();
}

function traceReferenceX() {
  return TRACE_IMAGE_X + CANVAS_W + TRACE_SIDE_GAP;
}

function drawTraceImage(x, alpha) {
  traceCtx.save();
  traceCtx.translate(x, TRACE_IMAGE_Y);
  traceCtx.globalAlpha = alpha;
  traceCtx.drawImage(state.traceImage, 0, 0, CANVAS_W, CANVAS_H);
  traceCtx.restore();
}

function drawTracePanelLabel(label, x) {
  const pxPerUnit = tracePixelsPerUnit();
  traceCtx.fillStyle = "#52606d";
  traceCtx.font = `600 ${Math.min(9, Math.max(3, 11 / pxPerUnit))}px Inter, ui-sans-serif, system-ui`;
  traceCtx.textAlign = "left";
  traceCtx.textBaseline = "bottom";
  traceCtx.fillText(label, x, TRACE_IMAGE_Y - Math.max(3, 7 / pxPerUnit));
}

function drawTraceOverlayRulers() {
  if (els.traceStage.hidden) return;
  const width = els.traceStage.clientWidth;
  const height = els.traceStage.clientHeight;
  if (width <= 0 || height <= 0) return;
  setupRulerCanvas(els.traceRulerX, traceRulerXCtx, width, TRACE_RULER_X_H);
  setupRulerCanvas(els.traceRulerY, traceRulerYCtx, TRACE_RULER_Y_W, height);

  const stageRect = els.traceStage.getBoundingClientRect();
  const canvasRect = els.traceCanvas.getBoundingClientRect();
  const pxPerUnit = canvasRect.width / TRACE_WORLD_W;
  const originX = canvasRect.left - stageRect.left + TRACE_IMAGE_X * pxPerUnit;
  const originY = canvasRect.top - stageRect.top + TRACE_IMAGE_Y * pxPerUnit;

  drawHorizontalRuler(traceRulerXCtx, width, TRACE_RULER_X_H, originX, pxPerUnit);
  drawVerticalRuler(traceRulerYCtx, TRACE_RULER_Y_W, height, originY, pxPerUnit);
}

function setupRulerCanvas(canvas, rulerCtx, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
  const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  rulerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rulerCtx.clearRect(0, 0, cssWidth, cssHeight);
}

function drawHorizontalRuler(rulerCtx, width, height, originX, pxPerUnit) {
  rulerCtx.fillStyle = "rgba(248, 250, 252, 0.96)";
  rulerCtx.fillRect(0, 0, width, height);
  rulerCtx.fillStyle = "rgba(216, 224, 231, 0.96)";
  rulerCtx.fillRect(0, 0, TRACE_RULER_Y_W, height);
  rulerCtx.strokeStyle = "rgba(100, 113, 129, 0.38)";
  rulerCtx.lineWidth = 1;
  rulerCtx.beginPath();
  rulerCtx.moveTo(0, height - 0.5);
  rulerCtx.lineTo(width, height - 0.5);
  rulerCtx.stroke();

  rulerCtx.font = "10px Inter, ui-sans-serif, system-ui";
  rulerCtx.textAlign = "center";
  rulerCtx.textBaseline = "top";
  const minorStep = traceGridStep(pxPerUnit);
  const majorStep = minorStep * 5;
  for (let x = 0; x <= CANVAS_W; x += minorStep) {
    const tickX = originX + x * pxPerUnit;
    if (tickX < -20 || tickX > width + 20) continue;
    const major = x % majorStep === 0;
    rulerCtx.strokeStyle = major ? "rgba(82, 96, 109, 0.72)" : "rgba(100, 113, 129, 0.45)";
    rulerCtx.beginPath();
    rulerCtx.moveTo(tickX, height);
    rulerCtx.lineTo(tickX, height - (major ? 13 : 7));
    rulerCtx.stroke();
    if (major) {
      rulerCtx.fillStyle = "#52606d";
      rulerCtx.fillText(String(x), tickX, 3);
    }
  }
}

function drawVerticalRuler(rulerCtx, width, height, originY, pxPerUnit) {
  rulerCtx.fillStyle = "rgba(248, 250, 252, 0.96)";
  rulerCtx.fillRect(0, 0, width, height);
  rulerCtx.fillStyle = "rgba(216, 224, 231, 0.96)";
  rulerCtx.fillRect(0, 0, width, TRACE_RULER_X_H);
  rulerCtx.strokeStyle = "rgba(100, 113, 129, 0.38)";
  rulerCtx.lineWidth = 1;
  rulerCtx.beginPath();
  rulerCtx.moveTo(width - 0.5, 0);
  rulerCtx.lineTo(width - 0.5, height);
  rulerCtx.stroke();

  rulerCtx.font = "10px Inter, ui-sans-serif, system-ui";
  rulerCtx.textAlign = "right";
  rulerCtx.textBaseline = "middle";
  const minorStep = traceGridStep(pxPerUnit);
  const majorStep = minorStep * 5;
  for (let y = 0; y <= CANVAS_H; y += minorStep) {
    const tickY = originY + y * pxPerUnit;
    if (tickY < -20 || tickY > height + 20) continue;
    const major = y % majorStep === 0;
    rulerCtx.strokeStyle = major ? "rgba(82, 96, 109, 0.72)" : "rgba(100, 113, 129, 0.45)";
    rulerCtx.beginPath();
    rulerCtx.moveTo(width, tickY);
    rulerCtx.lineTo(width - (major ? 13 : 7), tickY);
    rulerCtx.stroke();
    if (major) {
      rulerCtx.fillStyle = "#52606d";
      rulerCtx.fillText(String(y), width - 16, tickY);
    }
  }
}

function drawTraceGrid() {
  const pxPerUnit = tracePixelsPerUnit();
  const lineWidth = 1 / pxPerUnit;
  if (state.showGrid) {
    const minor = traceGridStep(pxPerUnit);
    const major = minor * 5;
    for (let x = 0; x <= CANVAS_W; x += minor) {
      const canvasX = TRACE_IMAGE_X + x;
      traceCtx.beginPath();
      traceCtx.moveTo(canvasX, TRACE_IMAGE_Y);
      traceCtx.lineTo(canvasX, TRACE_IMAGE_Y + CANVAS_H);
      traceCtx.strokeStyle = x % major === 0 ? "rgba(71, 85, 105, 0.55)" : "rgba(100, 113, 129, 0.3)";
      traceCtx.lineWidth = lineWidth;
      traceCtx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += minor) {
      const canvasY = TRACE_IMAGE_Y + y;
      traceCtx.beginPath();
      traceCtx.moveTo(TRACE_IMAGE_X, canvasY);
      traceCtx.lineTo(TRACE_IMAGE_X + CANVAS_W, canvasY);
      traceCtx.strokeStyle = y % major === 0 ? "rgba(71, 85, 105, 0.55)" : "rgba(100, 113, 129, 0.3)";
      traceCtx.lineWidth = lineWidth;
      traceCtx.stroke();
    }
  }
  traceCtx.strokeStyle = "rgba(23, 32, 42, 0.28)";
  traceCtx.lineWidth = lineWidth;
  traceCtx.strokeRect(TRACE_IMAGE_X, TRACE_IMAGE_Y, CANVAS_W, CANVAS_H);
  if (state.traceView === "side-by-side") {
    traceCtx.strokeRect(traceReferenceX(), TRACE_IMAGE_Y, CANVAS_W, CANVAS_H);
  }
}

function drawTracePaths() {
  const trace = currentTrace();
  for (let ci = 0; ci < trace.contours.length; ci += 1) {
    const contour = trace.contours[ci];
    if (!contour.length) continue;
    traceCtx.beginPath();
    traceCtx.moveTo(contour[0].x, contour[0].y);
    for (let i = 0; i < contour.length; i += 1) {
      const point = contour[i];
      const next = contour[(i + 1) % contour.length];
      if (i === contour.length - 1 && contour.length < 3) break;
      traceCtx.bezierCurveTo(point.outX, point.outY, next.inX, next.inY, next.x, next.y);
    }
    if (contour.length >= 3) traceCtx.closePath();
    traceCtx.fillStyle = ci === state.activeContour ? "rgba(13, 148, 136, 0.18)" : "rgba(15, 23, 42, 0.12)";
    traceCtx.strokeStyle = ci === state.activeContour ? "#0d9488" : "#334155";
    traceCtx.lineWidth = 1 / TRACE_SCALE;
    if (contour.length >= 3) traceCtx.fill();
    traceCtx.stroke();

    for (const point of contour) {
      drawHandleLine(point.x, point.y, point.inX, point.inY);
      drawHandleLine(point.x, point.y, point.outX, point.outY);
      drawHandle(point.inX, point.inY, "#f59e0b");
      drawHandle(point.outX, point.outY, "#3b82f6");
      const isSelected =
        state.selectedPoint && state.selectedPoint.contour === ci && contour[state.selectedPoint.point] === point;
      drawHandle(point.x, point.y, isSelected ? "#ef4444" : "#0f172a", true);
    }
  }
}

function drawHandleLine(x0, y0, x1, y1) {
  traceCtx.beginPath();
  traceCtx.moveTo(x0, y0);
  traceCtx.lineTo(x1, y1);
  traceCtx.strokeStyle = "rgba(100, 113, 129, 0.55)";
  traceCtx.lineWidth = 1 / TRACE_SCALE;
  traceCtx.stroke();
}

function drawHandle(x, y, color, square = false) {
  const r = HANDLE_R / TRACE_SCALE;
  traceCtx.fillStyle = color;
  traceCtx.strokeStyle = "#fff";
  traceCtx.lineWidth = 1 / TRACE_SCALE;
  if (square) {
    traceCtx.fillRect(x - r, y - r, r * 2, r * 2);
    traceCtx.strokeRect(x - r, y - r, r * 2, r * 2);
  } else {
    traceCtx.beginPath();
    traceCtx.arc(x, y, r, 0, Math.PI * 2);
    traceCtx.fill();
    traceCtx.stroke();
  }
}

function canvasPoint(event) {
  const rect = els.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * els.canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * els.canvas.height;
  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

function normalizeBox(box) {
  const [x0, y0, x1, y1] = box;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function pointInBox(point, box) {
  const [x0, y0, x1, y1] = clampBox(box);
  return point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1;
}

function boxFromOrigin(x, y, width, height) {
  const maxX = els.canvas.width || 2000;
  const maxY = els.canvas.height || 2000;
  const fixedWidth = Math.min(width, maxX);
  const fixedHeight = Math.min(height, maxY);
  const left = Math.max(0, Math.min(maxX - fixedWidth, Math.round(x)));
  const top = Math.max(0, Math.min(maxY - fixedHeight, Math.round(y)));
  return [left, top, left + fixedWidth, top + fixedHeight];
}

function clampBox(box) {
  return clampBoxToSize(box, els.canvas.width || 2000, els.canvas.height || 2000);
}

function clampBoxToSize(box, rawMaxX, rawMaxY) {
  const maxX = Math.max(1, rawMaxX);
  const maxY = Math.max(1, rawMaxY);
  let [x0, y0, x1, y1] = normalizeBox(box);
  x0 = Math.max(0, Math.min(maxX - 1, x0));
  y0 = Math.max(0, Math.min(maxY - 1, y0));
  x1 = Math.max(x0 + 1, Math.min(maxX, x1));
  y1 = Math.max(y0 + 1, Math.min(maxY, y1));
  return [x0, y0, x1, y1];
}

function draw() {
  if (!state.imageReady) return;
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.drawImage(state.image, 0, 0);
  const [x0, y0, x1, y1] = clampBox(state.box);
  const scale = Math.max(0.01, els.canvas.getBoundingClientRect().width / els.canvas.width);
  const oneScreenPx = 1 / scale;
  const handleSize = 4 / scale;
  ctx.save();
  ctx.fillStyle = "rgba(17, 24, 39, 0.28)";
  ctx.fillRect(0, 0, els.canvas.width, y0);
  ctx.fillRect(0, y1, els.canvas.width, els.canvas.height - y1);
  ctx.fillRect(0, y0, x0, y1 - y0);
  ctx.fillRect(x1, y0, els.canvas.width - x1, y1 - y0);
  ctx.strokeStyle = "#ff2d20";
  ctx.lineWidth = oneScreenPx;
  ctx.strokeRect(x0 + oneScreenPx / 2, y0 + oneScreenPx / 2, x1 - x0 - oneScreenPx, y1 - y0 - oneScreenPx);
  ctx.fillStyle = "#ff2d20";
  for (const [hx, hy] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ]) {
    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  }
  ctx.restore();
}

// Extract the glyph: threshold the crop, trim to the foreground bounding box,
// then scale to fit the glyph canvas, centered plus the source's optional
// offset_x. Mirrors glyph_pipeline.render_mask() from the Python pipeline.
function renderGlyphPng(source, image = state.image) {
  const [x0, y0, x1, y1] = clampBoxToSize(
    source.box,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height
  ).map(Math.round);
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = width;
  cropCanvas.height = height;
  const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
  cropCtx.drawImage(image, x0, y0, width, height, 0, 0, width, height);
  const imageData = cropCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const threshold = Number(source.threshold);
  const wantLight = source.polarity === "light";
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const gray = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
      const foreground = wantLight ? gray > threshold : gray < threshold;
      if (!foreground) continue;
      mask[y * width + x] = 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const outCanvas = document.createElement("canvas");
  outCanvas.width = CANVAS_W;
  outCanvas.height = CANVAS_H;
  const outCtx = outCanvas.getContext("2d");
  outCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  if (maxX < minX || maxY < minY) {
    return outCanvas.toDataURL("image/png");
  }

  const trimW = maxX - minX + 1;
  const trimH = maxY - minY + 1;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = trimW;
  maskCanvas.height = trimH;
  const maskCtx = maskCanvas.getContext("2d");
  const maskData = maskCtx.createImageData(trimW, trimH);
  for (let y = 0; y < trimH; y += 1) {
    for (let x = 0; x < trimW; x += 1) {
      if (!mask[(minY + y) * width + minX + x]) continue;
      const idx = (y * trimW + x) * 4;
      maskData.data[idx] = 0;
      maskData.data[idx + 1] = 0;
      maskData.data[idx + 2] = 0;
      maskData.data[idx + 3] = 255;
    }
  }
  maskCtx.putImageData(maskData, 0, 0);

  const scale = Math.min(CANVAS_W / trimW, CANVAS_H / trimH);
  const drawW = Math.max(1, Math.round(trimW * scale));
  const drawH = Math.max(1, Math.round(trimH * scale));
  const offsetX = Math.round(Number(source.offset_x) || 0);
  const dx = Math.max(0, Math.min(CANVAS_W - drawW, Math.floor((CANVAS_W - drawW) / 2) + offsetX));
  const dy = Math.floor((CANVAS_H - drawH) / 2);
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(maskCanvas, dx, dy, drawW, drawH);
  return outCanvas.toDataURL("image/png");
}

function renderLivePreview() {
  return renderGlyphPng({
    box: state.box,
    polarity: els.polarity.value,
    threshold: Number(els.threshold.value),
    offset_x: offsetXValue(),
  });
}

async function saveCrop() {
  if (!state.imageReady) {
    setStatus(t("status.needImage"), "error");
    return;
  }
  updateBoxFromFields();
  updateDraftCrop();
  els.saveButton.disabled = true;
  setStatus(t("status.saving"));
  try {
    const box = clampBox(state.box).map(Math.round);
    const polarity = els.polarity.value;
    const threshold = Number(els.threshold.value);
    const offset_x = offsetXValue();
    const source = {
      char: state.selected,
      source: "manual",
      imageId: state.activeImageId,
      box,
      polarity,
      threshold,
      offset_x,
    };
    state.sources[state.selected] = source;
    state.glyphs[state.selected] = renderGlyphPng(source);
    await persistProject(["sources", "glyphs"]);
    updateCharBadges();
    renderImageOptions();
    updateSourceSummary();
    updatePreview();
    loadTraceImage();
    setStatus(t("status.savedCrop", { char: state.selected }), "ok");
  } catch (error) {
    setStatus(`${t("status.saveFailed")}: ${error.message}`, "error");
  } finally {
    els.saveButton.disabled = false;
  }
}

const CONTROL_MARGIN = 40;

function clampCoord(value, min, max) {
  const num = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(num) ? num : 0));
}

// Port of trace_pipeline.clean_contours(): clamp anchors to the canvas and
// handles to the canvas plus a margin; drop contours with fewer than 3 points.
function cleanContours(contours) {
  const cleaned = [];
  for (const contour of contours) {
    const points = contour.map((point) => ({
      x: clampCoord(point.x, 0, CANVAS_W),
      y: clampCoord(point.y, 0, CANVAS_H),
      inX: clampCoord(point.inX ?? point.x, -CONTROL_MARGIN, CANVAS_W + CONTROL_MARGIN),
      inY: clampCoord(point.inY ?? point.y, -CONTROL_MARGIN, CANVAS_H + CONTROL_MARGIN),
      outX: clampCoord(point.outX ?? point.x, -CONTROL_MARGIN, CANVAS_W + CONTROL_MARGIN),
      outY: clampCoord(point.outY ?? point.y, -CONTROL_MARGIN, CANVAS_H + CONTROL_MARGIN),
    }));
    if (points.length >= 3) cleaned.push(points);
  }
  return cleaned;
}

async function saveTrace() {
  const trace = currentTrace();
  const contours = cleanContours(trace.contours.filter((contour) => contour.length >= 3));
  if (!contours.length) {
    setStatus(t("status.needContour"), "error");
    return;
  }
  els.saveTraceButton.disabled = true;
  setStatus(t("status.savingTrace"));
  try {
    state.traces[state.selected] = { char: state.selected, contours };
    state.traceDrafts[state.selected] = structuredClone(state.traces[state.selected]);
    await persistProject(["traces"]);
    state.activeContour = Math.min(state.activeContour, contours.length - 1);
    state.selectedPoint = null;
    updateCharBadges();
    updatePreview();
    updateTraceButtons();
    drawTrace();
    setStatus(t("status.savedTrace", { char: state.selected }), "ok");
  } catch (error) {
    setStatus(`${t("status.saveTraceFailed")}: ${error.message}`, "error");
  } finally {
    els.saveTraceButton.disabled = false;
  }
}

function downloadCurrentSvg() {
  const contours = savedContours(state.traces, state.selected);
  if (!contours.length) {
    setStatus(t("status.noTrace", { char: state.selected }), "error");
    return;
  }
  const name = `${fileBase(state.settings, state.selected)}.svg`;
  const svg = Exporters.buildSvg(contours, exportOpts(state.selected));
  Exporters.download(name, new Blob([svg], { type: "image/svg+xml" }));
  setStatus(t("status.downloaded", { file: name }), "ok");
}

function downloadCurrentScad() {
  const contours = savedContours(state.traces, state.selected);
  if (!contours.length) {
    setStatus(t("status.noTrace", { char: state.selected }), "error");
    return;
  }
  const name = `${fileBase(state.settings, state.selected)}.scad`;
  const scad = Exporters.buildScad(contours, exportOpts(state.selected));
  Exporters.download(name, new Blob([scad], { type: "text/plain" }));
  setStatus(t("status.downloaded", { file: name }), "ok");
}

// Glyph PNG srcs are data: URLs everywhere (crops render via toDataURL,
// bundle import converts fetched files, project import rejects anything
// else). Anything that is not a data: URL is ignored, never fetched — the
// app must not make network requests on behalf of project data.
function bytesFromSrc(src) {
  return typeof src === "string" && src.startsWith("data:") ? Exporters.dataUrlToBytes(src) : null;
}

function srcToDataUrl(src) {
  return typeof src === "string" && src.startsWith("data:") ? src : null;
}

function downloadCurrentPng() {
  const bytes = bytesFromSrc(state.glyphs[state.selected]);
  if (!bytes) {
    setStatus(t("status.noGlyphPng", { char: state.selected }), "error");
    return;
  }
  const name = `${fileBase(state.settings, state.selected)}.png`;
  Exporters.download(name, new Blob([bytes], { type: "image/png" }));
  setStatus(t("status.downloaded", { file: name }), "ok");
}

function tracesForExport() {
  const out = {};
  for (const char of state.chars) {
    const contours = savedContours(state.traces, char);
    if (contours.length) out[char] = { char, contours };
  }
  return out;
}

async function downloadZip() {
  const entries = [];
  for (const char of state.chars) {
    const contours = savedContours(state.traces, char);
    if (contours.length) {
      entries.push({
        name: `${fileBase(state.settings, char)}.svg`,
        data: Exporters.textBytes(Exporters.buildSvg(contours, exportOpts(char))),
      });
      entries.push({
        name: `${fileBase(state.settings, char)}.scad`,
        data: Exporters.textBytes(Exporters.buildScad(contours, exportOpts(char))),
      });
    }
    const pngBytes = bytesFromSrc(state.glyphs[char]);
    if (pngBytes) {
      entries.push({ name: `${fileBase(state.settings, char)}.png`, data: pngBytes });
    }
  }
  if (!entries.length) {
    setStatus(t("status.zipEmpty"), "error");
    return;
  }
  entries.push({
    name: "traces.json",
    data: Exporters.textBytes(JSON.stringify(tracesForExport(), null, 2) + "\n"),
  });
  Exporters.download("glyphs.zip", Exporters.makeZip(entries));
  setStatus(t("status.zipDone", { count: entries.length }), "ok");
}

async function exportProject() {
  const glyphs = {};
  for (const [char, src] of Object.entries(state.glyphs)) {
    const dataUrl = srcToDataUrl(src);
    if (dataUrl) glyphs[char] = dataUrl;
  }
  const images = await Promise.all(
    state.images.map(async (image) => ({
      id: image.id,
      name: image.name,
      dataUrl: await Exporters.blobToDataUrl(image.blob),
    }))
  );
  const payload = buildProjectPayload({
    settings: state.settings,
    sources: state.sources,
    traces: state.traces,
    glyphs,
    images,
    activeImageId: state.activeImageId,
  });
  Exporters.download(
    "glyph-project.json",
    new Blob([JSON.stringify(payload)], { type: "application/json" })
  );
  setStatus(t("status.projectExported"), "ok");
}

async function importProject(file) {
  if (file.size > MAX_PROJECT_BYTES) {
    setStatus(t("status.fileTooLarge", { limit: Math.round(MAX_PROJECT_BYTES / 1048576) }), "error");
    return;
  }
  try {
    const data = JSON.parse(await file.text());
    if (!isProjectPayload(data)) {
      throw new Error("Not a project file");
    }
    // Validate and decode everything first, then commit in one transaction;
    // a failed import leaves both IndexedDB and the live UI untouched.
    const project = sanitizeImportedProject(data);
    const images = project.images.map((image) => ({
      id: image.id,
      name: image.name,
      blob: Exporters.dataUrlToBlob(image.dataUrl),
    }));
    await ProjectStore.setMany(
      {
        settings: project.settings,
        sources: project.sources,
        traces: project.traces,
        glyphs: project.glyphs,
        images,
        activeImageId: project.activeImageId,
      },
      ["refImage"]
    );
    clearReferenceImage();
    state.settings = project.settings;
    state.sources = project.sources;
    state.traces = project.traces;
    state.traceDrafts = {};
    state.glyphs = project.glyphs;
    state.images = images;
    state.activeImageId = project.activeImageId;
    state.lastBox = null;
    state.activeContour = 0;
    state.selectedPoint = null;
    applySettings();
    renderCharButtons();
    renderImageOptions();
    if (state.activeImageId) activateImage(state.activeImageId, { persist: false });
    else clearReferenceImage();
    selectChar(state.chars.includes(state.selected) ? state.selected : state.chars[0]);
    setStatus(t("status.projectImported"), "ok");
  } catch {
    setStatus(t("status.importFailed"), "error");
  }
}

function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`.trim();
}

init().catch((error) => {
  setStatus(error.message, "error");
});
