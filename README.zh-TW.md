# Glyph Trace Studio — img-2-openscad

[English](README.md) | 繁體中文

純前端的字形描邊工作室：上傳一張或多張參考圖（字體照片或掃描、車牌全圖、
招牌⋯），
把每個字元裁切成乾淨的二值化字形，再以貝茲曲線描邊——手動或用內建的自動
描邊——匯出可直接用於 3D 建模／列印的 **SVG** 與 **OpenSCAD** 檔案。

一切都在瀏覽器裡執行——不需伺服器、不需建置、零相依套件。圖片與描邊資料
只存在你瀏覽器的 IndexedDB，不會離開你的電腦。首次開啟會載入可編輯的
2012 年式官方規格字形範例；需要空白工作區時可隨時建立新專案。

本倉庫同時收錄專屬的**台灣車牌鑰匙圈產生器**頁面
（`taiwan-plate.html`）——預覽交通部公路局發布的 2012 年式 36 個字形，
並在瀏覽器裡產生六款完整的 OpenSCAD 車牌鑰匙圈模型：三款 1992 年式版面
與三款新式（2012 年起，3-4）版面；所有版面統一使用 `taiwan-glyphs/`
內的 2012 字形。

## 功能（編輯器 `index.html`）

- **多張參考底圖**——可一次或分次加入多張圖片、從工具列切換，並移除未使用
  的底圖。每個已儲存裁切都會記住來源底圖；選取該字元時會自動切回正確圖片。
  過大的圖會縮小到最長邊 4096 px。
- **裁切模式**——把固定大小的框拖到字元上，選擇前景極性（深色／淺色像素）
  與閾值，存出乾淨的黑字透明背景字形 PNG。裁切框初始為專案的寬／高
  （圖片 px）；調整過後，切換到下一個字元會沿用上一個字元的框。另有
  X 位移（畫布 px）可在墨跡置中後再平移字形，例如讓「1」以豎筆置中，
  而不是以整體外框置中。
- **描邊模式**——在字形上繪製封閉的貝茲輪廓，完整的節點／把手編輯：
  在線段上插入節點、刪除節點、加孔（counter）、調整外框／孔的順序、
  格線＋尺規、縮放。
- **自動描邊**——線段／圓弧分解描邊器（`autotrace.js`），從演算法上重現
  手描風格：總體最小平方直線擬合、軸向吸附、銳角還原、凹圓角、軸向極值
  節點配置與 Schneider 三次曲線擬合。「圓滑度」（0–1）在光柵稜面與理想
  圓弧之間混合肩部把手。結果先暫存供檢視，儲存才生效。
- **匯出**（單字）：`*.svg`（mm 尺寸、`fill-rule="evenodd"`）、`*.scad`
  （OpenSCAD module，取樣多邊形擠出、孔洞相減）、二值化 `*.png`；或一鍵
  ZIP 全部打包（含原始貝茲資料 `traces.json`）。
- **專案檔**——匯出／匯入單一 JSON（全部參考圖、逐字來源關聯、裁切框、
  描邊、設定），方便備份與分享。
- **可自訂**字元集（任意 Unicode 字元）、輸出 mm 尺寸（預設 45×89 mm）、
  檔名／module 名稱前綴。
- 英文／繁體中文介面。

## 台灣車牌鑰匙圈產生器（`taiwan-plate.html`）

- 36 字（0–9、A–Z，每字 45×89 mm）的字形樣本牆，即時渲染自**編輯器目前
  的描邊**（與 `index.html` 編輯的是同一份瀏覽器內專案）；需要
  0–9、A–Z 全部 36 字都有已儲存的描邊才會採用，否則退回倉庫內建的
  `taiwan-glyphs/traces.json`（頁尾會說明目前使用哪個來源、還缺哪些字）。在編輯器修改
  字形後，重新整理本頁即可套用。
- 一鍵下載三款 1992 年式車牌鑰匙圈 `.scad` 模型（汽車 320×150（2-4，
  Customizer 可切換 4-2 兩碼結尾格式）、普通重機 250×140（3-3）、
  大型重機 260×150（2-2）），在瀏覽器內由描邊
  即時產生、內嵌全部字模（`taiwan-plates.js`；幾何都在其 `SPECS` 表）。
- 每個車牌號碼欄位都提供 36 個標準字元、`-` 與 `空`；可選的 `-` 會置中
  顯示，最終尺寸與該版本固定分隔點一致（9×9 或 10×10，厚度同為 3）。
- 一鍵下載三款新式（2012 年起，3-4 七碼版面）車牌模型
  （汽車 380×160、機車 260×140、大型重機 300×150，並可切換紅牌／
  黃牌）——同一套 2012 字模配新式底版：外框凸緣＋凹版面、三個梅花
  防偽標記（左右凹、中間凸）、圓端螺絲孔槽、鑰匙圈孔（幾何在
  `SPECS_2012` 表）。
- 每個檔案開頭的 `//` 註解區（作者、連結、來源、授權）可自訂，一行一條；
  原有文字為預設樣板。預產車牌模型預設為
  `License: CC-Attribution-ShareAlike`；此模型標頭設定與 repository 的
  MIT 授權，以及政府字形來源授權彼此獨立。
- 字形 SVG／SCAD 預產檔獨立放在 `taiwan-glyphs/output/`；三款 1992
  版面模型在 `taiwan-1992/output/`，三款新式模型在 `taiwan-2012/output/`。

## 執行

這是靜態網站——用任何靜態伺服器供應倉庫根目錄：

```
python3 -m http.server 8765        # 然後開啟 http://localhost:8765/
```

或直接原樣部署（GitHub Pages：*Settings → Pages → Deploy from a
branch*，根資料夾）。編輯器在 `/`，車牌專案頁在
`/taiwan-plate.html`。必須透過靜態伺服器開啟——整個 app 是原生
ES modules，瀏覽器不允許從 `file://` 載入。

## 內建範例專案

首次載入且瀏覽器儲存為空時，編輯器會探測旁邊的 `project.json`：
`{app: "glyph-trace-studio-bundle", version, settings, ref, sources,
traces, glyphs}`——字串值會當成靜態檔案抓取，`glyphs` 中的 `{name}`
逐字代入。本倉庫附有 2012 年式字形範例 manifest，僅在瀏覽器儲存為空時
自動匯入，不會覆蓋既有工作。「設定 → 重新載入內建專案」可還原範例，
「設定 → 新專案（清空）」則開啟空白專案。

## 資料格式

- **描邊**（每字）：輪廓列表，每個輪廓是節點列表
  `{x, y, inX, inY, outX, outY}`（錨點＋進／出貝茲把手），單位為編輯
  畫布 px（每 mm 4 px）。第一個輪廓是外框，其餘是孔，以
  `fill-rule="evenodd"` 渲染。
- **專案 JSON（v2）**：`{app, version, settings, sources, traces, glyphs,
  images, activeImageId}`。`images` 是依序排列的 `{id, name, dataUrl}`
  參考底圖；`sources` 每字保存 `imageId`、裁切框、極性、閾值與
  `offset_x`；`glyphs` 是二值化 PNG 的 data URL。含單一 `refImage` 的
  v1 專案會在匯入時自動遷移。

## 檔案結構

全部是原生 ES modules；`package.json` 只為了讓 Node 以 ESM 解析
（`"type": "module"`），沒有任何相依套件、不需要安裝。

- `index.html`／`styles.css`——編輯器單頁 UI。
- `app.js`——編輯器 UI 與流程串接（裁切＋描邊模式、選用的 bundle 載入、
  持久化）；領域邏輯在下列模組。
- `project-schema.js`——專案檔格式：預設值、資源上限、匯入驗證
  （sanitizer）、匯出 payload。
- `glyph-contract.js`——編輯器與車牌頁共用的命名
  （`charSlug`／`fileBase`／`moduleName`）與描邊集合規則。
- `scad-escape.js`——OpenSCAD 字串跳脫。
- `taiwan-plate.html`／`taiwan-plate.js`／`taiwan-plate.css`——台灣車牌
  專案頁（36 字全部描完時讀取編輯器的 IndexedDB 專案，否則以
  `taiwan-glyphs/traces.json` 作為 2012 字形後備）。
- `autotrace.js`——自動描邊器（不依賴 DOM；與原始 Python 實作
  exact-parity 測試）。`autotrace-worker.js` 讓它在 Web Worker 中執行，
  描邊不會凍結 UI。
- `taiwan-plates.js`——車牌鑰匙圈 SCAD 模型產生器（1992 年式在
  `SPECS` 幾何表，新式在 `SPECS_2012`；兩者共用產生器與字模）。
- `exporters.js`——由貝茲描邊產生 SVG／SCAD、ZIP 打包、下載輔助。
- `storage.js`——輕量 IndexedDB key/value 包裝。
- `taiwan-glyphs/`——獨立的 2012 字形套件：`source/` 保存含原始三次
  貝茲控制點的 SVG、`traces.json` 作為瀏覽器後備、`output/` 保存
  `2012_<char>.svg`／`.scad` 預產字形。
- `project.json`＋`taiwan-glyphs/example/`——首次載入的內建範例：
  1632×1900、字元間留白的點陣參考字形表、36 個像素座標裁切框與共用的
  2012 描邊。
- `taiwan-1992/output/`——三款 1992 年式版面模型；內嵌字模已統一為
  2012 字形。
- `taiwan-2012/output/`——三款新式車牌模型的預產檔。
- `tools/build_taiwan_glyphs.mjs`——由 `taiwan-glyphs/source/` 重建
  `traces.json` 與全部預產字形。
- `tools/build_taiwan_plates.mjs`——自 `taiwan-glyphs/traces.json` 重新
  產生 `taiwan-1992/output/` 與 `taiwan-2012/output/` 下共六款車牌模型
  （輸出與 `taiwan-plate.html` 的下載相同）：
  ```
  node tools/build_taiwan_plates.mjs
  ```
- `tools/build_autotrace_fixtures.mjs`——從 `taiwan-glyphs/source/` 重新
  光柵化並建立自動描邊 golden fixtures。一般開發不需執行。
- `tools/tests/`——Node 測試（僅用 stdlib），以及由上述 2012 年式字形建立的
  fixtures；`npm test` 一次跑完五個，CI
  （`.github/workflows/ci.yml`）每次 push 都會執行：
  ```
  node tools/tests/test_autotrace.mjs        # 自動描邊 regression fixtures 72/72 exact
  node tools/tests/test_taiwan_glyphs.mjs    # 字形來源→後備→預產輸出一致性
  node tools/tests/test_taiwan_plates.mjs    # 對 taiwan-1992/output/＋taiwan-2012/output/ byte-identical
  node tools/tests/test_project_schema.mjs   # 專案檔匯入驗證／round-trip
  node tools/tests/test_glyph_contract.mjs   # 跨頁命名＋描邊集合契約
  ```

## 使用匯出的檔案

- **SVG**：匯入任何向量軟體，或在 OpenSCAD 中：
  `linear_extrude(3) import("2012_A.svg", center = true);`
- **SCAD**：`use <2012_A.scad>` 之後呼叫 `glyph_2012_A(h = 3);`——字形
  置中於原點，尺寸為設定的 mm。
- **車牌鑰匙圈模型**：以 OpenSCAD 開啟，用 Customizer 設定車牌號碼、
  顏色、位移與尺寸倍率——預設 0.15 為鑰匙圈大小（約 4–5 cm 寬），
  設為 1 即是原尺寸車牌。

## 授權與素材來源

- 本 app、測試、作者建立的 2012 描邊與其產生的 SVG／SCAD，以
  [MIT](LICENSE) 授權釋出，並須保留下述政府資料來源顯名。
- `tools/tests/fixtures/` 內的二值字形遮罩，是從作者依台灣政府發布的
  2012 年式號牌字形規格自行描邊的 `taiwan-glyphs/source/` 檔案重新
  光柵化而成；不再含有 Wikimedia Commons 1992 參考圖的裁切內容。
  政府原始文件未隨本倉庫散布。
- 政府資料來源：交通部公路局（原交通部公路總局）發布的
  [「新式號牌使用之英文字、數字字體」](https://ws.thb.gov.tw/001/Upload/OldFile/resource/html/doc/%E7%9B%A3%E7%90%86%E6%A5%AD%E5%8B%99/%E7%89%8C%E7%85%A7/3.%E6%96%B0%E5%BC%8F%E8%99%9F%E7%89%8C%E4%BD%BF%E7%94%A8%E4%B9%8B%E8%8B%B1%E6%96%87%E5%AD%97%E3%80%81%E6%95%B8%E5%AD%97%E5%AD%97%E9%AB%94.pdf)。
  此開放資料依公路局的[政府資料開放授權條款第 1 版宣告](https://www.thb.gov.tw/cp.aspx?n=439)
  進行公眾釋出；使用本專案字形及其衍生物時，請保留本項來源顯名。
- 倉庫內建字形已全部統一為台灣新式 2012 年式字形，不再散布先前的
  1992 圖片衍生字形集。
