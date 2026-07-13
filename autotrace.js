// Line/arc-decomposition auto-tracer — a faithful JavaScript port of the
// Python pipeline's scripts/autotrace2.py (plus the mask_to_loops boundary
// extractor from scripts/vectorize.py). DOM-free: operates on a binary mask
// (Uint8Array, row-major) and returns contours in the editor's node format
// ({x, y, inX, inY, outX, outY} per node).
//
// The port mirrors the Python operation-for-operation (including numpy /
// scipy semantics: arange, searchsorted, unwrap, gradient, gaussian_filter1d
// with truncate=4, Python's floor-modulo) so its output matches the original
// tracer; parity over all 36 repo glyphs is checked by
// tools/tests/test_autotrace.mjs.
export const AutoTrace = (() => {
  // The PNGs are ~3x LANCZOS upscales of a coarse binary source, so the
  // staircase steps are 3-5px tall; tolerances are sized to see through them.
  const STEP = 0.5; // boundary resample spacing (px)
  const LINE_TOL = 2.4; // max point deviation for a straight run (px)
  const BOW_TOL = 0.55; // max mid-vs-ends signed-deviation bow for a line (px)
  const MIN_LINE = 20.0; // minimum straight-run arc length (px)
  const AXIS_SNAP_DEG = 4.0; // snap lines this close to horizontal/vertical
  const CORNER_GAP = 6.0; // gaps shorter than this (px) become sharp corners
  const CORNER_MIN_DEG = 15.0; // bend sharper than this at a short gap = corner
  const CHAIN_GAP = 32.0; // max gap (px) between runs merged into a gentle chain
  const CHAIN_DEG = 14.0; // max angle difference for chain merging
  const CHAIN_TOL = 4.8; // single-cubic fit tolerance over a whole chain (px)
  const CHAIN_TOTAL_DEG = 18.0; // cap on total direction change across a chain
  const KEEP_AXIS = 32.0; // min axis-aligned line length kept on outer contours
  const KEEP_DIAG = 80.0; // min non-axis line length kept on outer contours
  const KEEP_HOLE = 70.0; // min line length kept on hole contours
  const CURVE_SMOOTH = 3.0; // gaussian sigma (px) for curve-region smoothing
  const CURVE_CORNER_DEG = 58.0; // turning angle marking a corner inside a curve region
  const CURVE_CORNER_WIN = 4.0; // window (px) each side for the turn test
  const CURVE_CORNER_WIN2 = 12.0; // confirmation window: a real corner still turns hard
  const CURVE_CORNER_DEG2 = 45.0; // at this scale; a big staircase step does not
  const SHORT_REGION = 30.0; // regions shorter than this get one smooth cubic
  const FIT_ERROR = 3.5; // max cubic fit deviation in curve regions (px)
  const EXTREMA_MIN_SEP = 10.0; // merge axis extrema closer than this (px)
  const SMOOTH_JOIN_DEG = 32.0; // line/curve joins bending less than this stay G1
  const JOIN_PROBE = 12.0; // arc length (px) for join tangent probes
  const DEPART_TOL = 2.0; // a region only starts once the raster leaves the line
  const ABSORB_LEN = 45.0; // max region length a gentle chain may swallow
  const ABSORB_DEG = 35.0; // max region turn a gentle chain may swallow
  const CLASSIFY_GAP = 55.0; // corner-classifier applies up to this region length
  const CLASSIFY_DEG = 55.0; // ... and above this bend angle
  const ARC_MAX_LEN = 160.0; // smooth-joined monotone bends up to this length and
  const ARC_MIN_DEG = 50.0; // within this bend range are one rounded-corner arc
  const ARC_MAX_DEG = 115.0;
  const ARC_INFLECT_DEG = 20.0; // max reverse turn still counted as monotone
  const OUTSIDE_TOL = 1.5; // region poking outside the corner wedge -> artifact
  const HUMP_MAX = 8.0; // ... but beyond this it is a real feature (serif flare)
  const FILLET_PULL = 0.27; // concave fillets: edge extension fraction
  const CORNER_SNAP = 7.0; // max distance a corner may move to a line intersection
  const DEFAULT_ROUND = 0.5; // shoulder roundness blend (0 faithful .. 1 ideal arc)
  const ROUND_MIN_DEG = 25.0; // only bends turning at least this much get rounded
  const MIN_AREA = 80.0;
  const MIN_AREA_PX = 4.0; // mask_to_loops noise floor (vectorize.py)

  // Per-trace state (single-threaded, set by traceMask).
  let ROUND_BLEND = DEFAULT_ROUND;
  let CANVAS_W = 180;
  let CANVAS_H = 356;

  // ------------------------------------------------------------- numpy-isms

  // Python floor-modulo: result has the sign of the divisor.
  function pmod(a, b) {
    return ((a % b) + b) % b;
  }

  function hyp(x, y) {
    return Math.hypot(x, y);
  }

  function unit(v) {
    const n = hyp(v[0], v[1]);
    return n > 1e-12 ? [v[0] / n, v[1] / n] : [0.0, 0.0];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
  }

  function clip(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  function degrees(rad) {
    return (rad * 180) / Math.PI;
  }

  function radians(deg) {
    return (deg * Math.PI) / 180;
  }

  function sign(v) {
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }

  function mean(arr) {
    let s = 0;
    for (const v of arr) s += v;
    return s / arr.length; // empty -> NaN, matching numpy's nan mean
  }

  // First index of the maximum (numpy argmax semantics).
  function argmax(arr) {
    let best = 0;
    for (let i = 1; i < arr.length; i += 1) if (arr[i] > arr[best]) best = i;
    return best;
  }

  function argmin(arr) {
    let best = 0;
    for (let i = 1; i < arr.length; i += 1) if (arr[i] < arr[best]) best = i;
    return best;
  }

  // np.unwrap with the default pi discontinuity.
  function unwrap(p) {
    const out = p.slice();
    let correction = 0;
    for (let i = 1; i < p.length; i += 1) {
      const d = p[i] - p[i - 1];
      let ddmod = pmod(d + Math.PI, 2 * Math.PI) - Math.PI;
      if (ddmod === -Math.PI && d > 0) ddmod = Math.PI;
      let ph = ddmod - d;
      if (Math.abs(d) < Math.PI) ph = 0;
      correction += ph;
      out[i] = p[i] + correction;
    }
    return out;
  }

  // np.gradient along axis 0 for an array of [x, y] points.
  function gradient(points) {
    const n = points.length;
    const out = new Array(n);
    for (let i = 0; i < n; i += 1) {
      if (i === 0) out[i] = [points[1][0] - points[0][0], points[1][1] - points[0][1]];
      else if (i === n - 1) out[i] = [points[n - 1][0] - points[n - 2][0], points[n - 1][1] - points[n - 2][1]];
      else out[i] = [(points[i + 1][0] - points[i - 1][0]) / 2, (points[i + 1][1] - points[i - 1][1]) / 2];
    }
    return out;
  }

  // scipy.ndimage.gaussian_filter1d (order 0, truncate 4.0) on a plain array.
  function gaussianFilter1d(input, sigma, mode) {
    const lw = Math.floor(4.0 * sigma + 0.5);
    const weights = new Array(2 * lw + 1);
    let total = 0;
    for (let i = -lw; i <= lw; i += 1) {
      const w = Math.exp((-0.5 / (sigma * sigma)) * i * i);
      weights[i + lw] = w;
      total += w;
    }
    for (let i = 0; i < weights.length; i += 1) weights[i] /= total;
    const n = input.length;
    const out = new Array(n);
    for (let i = 0; i < n; i += 1) {
      let acc = 0;
      for (let k = -lw; k <= lw; k += 1) {
        let j = i + k;
        if (mode === "wrap") j = pmod(j, n);
        else j = clip(j, 0, n - 1); // nearest
        acc += input[j] * weights[k + lw];
      }
      out[i] = acc;
    }
    return out;
  }

  function smoothPoints(points, sigma, mode) {
    const xs = gaussianFilter1d(points.map((p) => p[0]), sigma, mode);
    const ys = gaussianFilter1d(points.map((p) => p[1]), sigma, mode);
    return xs.map((x, i) => [x, ys[i]]);
  }

  // ------------------------------------------------- boundary (vectorize.py)

  function area(loop) {
    let total = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const [x0, y0] = loop[i];
      const [x1, y1] = loop[(i + 1) % loop.length];
      total += x0 * y1 - x1 * y0;
    }
    return total / 2;
  }

  function removeCollinear(loop) {
    let changed = true;
    let points = loop.slice();
    while (changed && points.length > 3) {
      changed = false;
      const out = [];
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const prev = points[pmod(i - 1, points.length)];
        const next = points[(i + 1) % points.length];
        if ((prev[0] === point[0] && point[0] === next[0]) || (prev[1] === point[1] && point[1] === next[1])) {
          changed = true;
          continue;
        }
        out.push(point);
      }
      points = out;
    }
    return points;
  }

  // Pixel-edge boundary loops of a binary mask; replicates the insertion /
  // walk order of the Python dict-based implementation exactly.
  function maskToLoops(mask, width, height) {
    const stride = width + 1;
    const edges = new Map(); // start key -> [end keys]
    const key = (x, y) => y * stride + x;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!mask[y * width + x]) continue;
        if (y === 0 || !mask[(y - 1) * width + x]) addEdge(key(x, y), key(x + 1, y));
        if (x === width - 1 || !mask[y * width + x + 1]) addEdge(key(x + 1, y), key(x + 1, y + 1));
        if (y === height - 1 || !mask[(y + 1) * width + x]) addEdge(key(x + 1, y + 1), key(x, y + 1));
        if (x === 0 || !mask[y * width + x - 1]) addEdge(key(x, y + 1), key(x, y));
      }
    }
    function addEdge(start, end) {
      const list = edges.get(start);
      if (list) list.push(end);
      else edges.set(start, [end]);
    }
    const decode = (k) => [k % stride, Math.floor(k / stride)];
    const loops = [];
    while (edges.size) {
      const start = edges.keys().next().value;
      let current = start;
      const loop = [decode(start)];
      for (;;) {
        const nextPoints = edges.get(current);
        if (!nextPoints || !nextPoints.length) break;
        const nxt = nextPoints.pop();
        if (!nextPoints.length) edges.delete(current);
        current = nxt;
        if (current === start) break;
        loop.push(decode(current));
      }
      if (loop.length >= 4 && Math.abs(area(loop)) >= MIN_AREA_PX) {
        loops.push(removeCollinear(loop));
      }
    }
    return loops;
  }

  function boundaryLoops(mask, width, height) {
    const loops = maskToLoops(mask, width, height);
    loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    return loops.filter((lp) => Math.abs(area(lp)) >= MIN_AREA).map((lp) => lp.map((p) => [p[0], p[1]]));
  }

  // ----------------------------------------------------------------- resample

  function resample(points, step = STEP) {
    const n = points.length;
    const closed = points.concat([points[0]]);
    const seg = new Array(n);
    const dist = new Array(n + 1);
    dist[0] = 0;
    for (let i = 0; i < n; i += 1) {
      seg[i] = hyp(closed[i + 1][0] - closed[i][0], closed[i + 1][1] - closed[i][1]);
      dist[i + 1] = dist[i] + seg[i];
    }
    const total = dist[n];
    const count = Math.ceil(total / step); // np.arange length semantics
    const out = new Array(count);
    for (let k = 0; k < count; k += 1) {
      const t = k * step;
      // np.searchsorted(dist, t, side="right") - 1, clipped
      let lo = 0;
      let hi = dist.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (dist[mid] <= t) lo = mid + 1;
        else hi = mid;
      }
      const idx = clip(lo - 1, 0, n - 1);
      const span = seg[idx] > 1e-12 ? seg[idx] : 1.0;
      const f = (t - dist[idx]) / span;
      out[k] = [closed[idx][0] * (1 - f) + closed[idx + 1][0] * f, closed[idx][1] * (1 - f) + closed[idx + 1][1] * f];
    }
    return out;
  }

  // ------------------------------------------------------------- line finding

  // O(1) total-least-squares line fit over circular index ranges.
  class PrefixFit {
    constructor(pts) {
      const n = pts.length;
      this.n = n;
      this.pts2 = pts.concat(pts); // doubled for wraparound
      this.sx = new Float64Array(2 * n + 1);
      this.sy = new Float64Array(2 * n + 1);
      this.sxx = new Float64Array(2 * n + 1);
      this.syy = new Float64Array(2 * n + 1);
      this.sxy = new Float64Array(2 * n + 1);
      for (let i = 0; i < 2 * n; i += 1) {
        const [x, y] = this.pts2[i];
        this.sx[i + 1] = this.sx[i] + x;
        this.sy[i + 1] = this.sy[i] + y;
        this.sxx[i + 1] = this.sxx[i] + x * x;
        this.syy[i + 1] = this.syy[i] + y * y;
        this.sxy[i + 1] = this.sxy[i] + x * y;
      }
    }

    // TLS line for samples i0..i1 inclusive (doubled index space).
    line(i0, i1) {
      const m = i1 - i0 + 1;
      const sx = this.sx[i1 + 1] - this.sx[i0];
      const sy = this.sy[i1 + 1] - this.sy[i0];
      const sxx = this.sxx[i1 + 1] - this.sxx[i0];
      const syy = this.syy[i1 + 1] - this.syy[i0];
      const sxy = this.sxy[i1 + 1] - this.sxy[i0];
      const mx = sx / m;
      const my = sy / m;
      const cxx = sxx / m - mx * mx;
      const cyy = syy / m - my * my;
      const cxy = sxy / m - mx * my;
      const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      return [[mx, my], [Math.cos(theta), Math.sin(theta)]];
    }

    deviations(i0, i1) {
      const [c, d] = this.line(i0, i1);
      const out = new Array(i1 - i0 + 1);
      for (let i = i0; i <= i1; i += 1) {
        const p = this.pts2[i];
        out[i - i0] = (p[0] - c[0]) * d[1] - (p[1] - c[1]) * d[0];
      }
      return out;
    }

    // Straightness test: bounded deviation AND no systematic bow.
    isLine(i0, i1) {
      const dev = this.deviations(i0, i1);
      let maxAbs = 0;
      for (const v of dev) maxAbs = Math.max(maxAbs, Math.abs(v));
      if (maxAbs > LINE_TOL) return false;
      const m = dev.length;
      const third = Math.max(1, Math.floor(m / 3));
      const mid = mean(dev.slice(third, m - third));
      const ends = mean(dev.slice(0, third).concat(dev.slice(m - third)));
      return Math.abs(mid - ends) <= BOW_TOL;
    }
  }

  // Maximal straight runs as [start, end] sample indices (may wrap: end >= n).
  function findLines(pts, fit) {
    const n = pts.length;
    const minSamples = Math.floor(MIN_LINE / STEP);
    const cand = [];
    const stride = Math.max(1, Math.floor(minSamples / 6));
    let s = 0;
    while (s < n) {
      let hi = s;
      let step = minSamples;
      while (hi - s < n - 1) {
        const trial = Math.min(s + (hi - s) + step, s + n - 1);
        if (trial === hi) break;
        if (fit.isLine(s, trial)) {
          hi = trial;
          step *= 2;
        } else break;
      }
      let loB = hi;
      let hiB = Math.min(s + (hi - s) + step, s + n - 1);
      while (loB < hiB) {
        const mid = Math.floor((loB + hiB + 1) / 2);
        if (fit.isLine(s, mid)) loB = mid;
        else hiB = mid - 1;
      }
      const e = loB;
      if ((e - s) * STEP >= MIN_LINE) cand.push([s, e]);
      s += stride;
    }
    // greedy pick longest; trim overlapping candidates against what is taken
    cand.sort((a, b) => a[0] - a[1] - (b[0] - b[1]));
    const taken = [];

    function longestFree(a0, a1) {
      const blocked = [];
      for (const [b0, b1] of taken) {
        for (const shift of [-n, 0, n]) {
          const lo = b0 + shift;
          const hi = b1 + shift;
          if (lo <= a1 && hi >= a0) blocked.push([Math.max(lo, a0), Math.min(hi, a1)]);
        }
      }
      if (!blocked.length) return [a0, a1];
      blocked.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let best = null;
      let cur = a0;
      for (const [lo, hi] of blocked) {
        if (lo > cur && (best === null || lo - 1 - cur > best[1] - best[0])) best = [cur, lo - 1];
        cur = Math.max(cur, hi + 1);
      }
      if (cur <= a1 && (best === null || a1 - cur > best[1] - best[0])) best = [cur, a1];
      return best;
    }

    for (const [a0, a1] of cand) {
      const free = longestFree(a0, a1);
      if (free === null) continue;
      let [f0, f1] = free;
      if (f0 >= n) {
        f0 -= n;
        f1 -= n;
      }
      if ((f1 - f0) * STEP >= MIN_LINE && fit.isLine(f0, f1)) taken.push([f0, f1]);
    }
    if (!taken.length) return [];
    taken.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // grow each accepted run outward while still within tolerance
    const grown = [];
    for (let k = 0; k < taken.length; k += 1) {
      let [s0, e0] = taken[k];
      const prevE = taken[pmod(k - 1, taken.length)][1] - (k === 0 ? n : 0);
      const nextS = taken[(k + 1) % taken.length][0] + (k === taken.length - 1 ? n : 0);
      while (s0 - 1 >= 0 && s0 - 1 > prevE && fit.isLine(s0 - 1, e0)) s0 -= 1;
      while (e0 + 1 < nextS && e0 + 1 < 2 * n && fit.isLine(s0, e0 + 1)) e0 += 1;
      grown.push([s0, e0]);
    }
    // split any overlap between grown neighbours at the middle
    grown.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let k = 0; k < grown.length; k += 1) {
      const [s0, e0] = grown[k];
      const [s1, e1] = grown[(k + 1) % grown.length];
      const shift = k === grown.length - 1 ? n : 0;
      if (e0 >= s1 + shift) {
        const mid = Math.floor((s1 + shift + e0) / 2);
        grown[k] = [s0, mid];
        grown[(k + 1) % grown.length] = [mid + 1 - shift, e1];
      }
    }
    return grown;
  }

  function snapLine(c, d) {
    const ang = pmod(degrees(Math.atan2(d[1], d[0])), 180.0);
    if (Math.min(ang, 180 - ang) < AXIS_SNAP_DEG) return [c, [1.0, 0.0]];
    if (Math.abs(ang - 90) < AXIS_SNAP_DEG) return [c, [0.0, 1.0]];
    return [c, d];
  }

  function project(p, c, d) {
    const t = (p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1];
    return [c[0] + d[0] * t, c[1] + d[1] * t];
  }

  // ------------------------------------------------------------ curve fitting

  function bezAt(b, t) {
    const mt = 1 - t;
    const w0 = mt * mt * mt;
    const w1 = 3 * mt * mt * t;
    const w2 = 3 * mt * t * t;
    const w3 = t * t * t;
    return [
      w0 * b[0][0] + w1 * b[1][0] + w2 * b[2][0] + w3 * b[3][0],
      w0 * b[0][1] + w1 * b[1][1] + w2 * b[2][1] + w3 * b[3][1],
    ];
  }

  function chordU(pts) {
    const d = new Array(pts.length);
    d[0] = 0;
    for (let i = 1; i < pts.length; i += 1) {
      d[i] = d[i - 1] + hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    const total = d[d.length - 1];
    if (total > 0) return d.map((v) => v / total);
    return d.map((_, i) => (pts.length === 1 ? 0 : i / (pts.length - 1)));
  }

  function genBezier(pts, u, t1, t2) {
    const p0 = pts[0];
    const p3 = pts[pts.length - 1];
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const ui = u[i];
      const mt = 1 - ui;
      const f0 = 3 * mt * mt * ui;
      const f1 = 3 * mt * ui * ui;
      const a0x = f0 * t1[0];
      const a0y = f0 * t1[1];
      const a1x = f1 * t2[0];
      const a1y = f1 * t2[1];
      const baseW0 = mt * mt * mt + 3 * mt * mt * ui;
      const baseW1 = ui * ui * ui + 3 * mt * ui * ui;
      const rx = pts[i][0] - (baseW0 * p0[0] + baseW1 * p3[0]);
      const ry = pts[i][1] - (baseW0 * p0[1] + baseW1 * p3[1]);
      c00 += a0x * a0x + a0y * a0y;
      c01 += a0x * a1x + a0y * a1y;
      c11 += a1x * a1x + a1y * a1y;
      x0 += a0x * rx + a0y * ry;
      x1 += a1x * rx + a1y * ry;
    }
    const det = c00 * c11 - c01 * c01;
    const seg = hyp(p3[0] - p0[0], p3[1] - p0[1]);
    let l1;
    let l2;
    if (Math.abs(det) < 1e-12) {
      l1 = seg / 3;
      l2 = seg / 3;
    } else {
      l1 = (x0 * c11 - x1 * c01) / det;
      l2 = (c00 * x1 - c01 * x0) / det;
      if (l1 < 1e-6 || l2 < 1e-6) {
        l1 = seg / 3;
        l2 = seg / 3;
      }
    }
    return [
      [p0[0], p0[1]],
      [p0[0] + t1[0] * l1, p0[1] + t1[1] * l1],
      [p3[0] + t2[0] * l2, p3[1] + t2[1] * l2],
      [p3[0], p3[1]],
    ];
  }

  function fitErrorMax(pts, b, u) {
    let best = -Infinity;
    let idx = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const at = bezAt(b, u[i]);
      const dx = at[0] - pts[i][0];
      const dy = at[1] - pts[i][1];
      const e = dx * dx + dy * dy;
      if (e > best) {
        best = e;
        idx = i;
      }
    }
    return [best, idx];
  }

  // Max residual after smoothing the residual vector along the curve.
  function smoothedFitError(pts, b, u, winPx = 14.0) {
    const dx = new Array(pts.length);
    const dy = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 1) {
      const at = bezAt(b, u[i]);
      dx[i] = at[0] - pts[i][0];
      dy[i] = at[1] - pts[i][1];
    }
    const sig = Math.max(0.5, winPx / STEP / 2.355);
    const sx = gaussianFilter1d(dx, sig, "nearest");
    const sy = gaussianFilter1d(dy, sig, "nearest");
    let best = 0;
    for (let i = 0; i < pts.length; i += 1) best = Math.max(best, hyp(sx[i], sy[i]));
    return best;
  }

  function reparam(pts, b, u) {
    let cur = u.slice();
    for (let round = 0; round < 6; round += 1) {
      const next = new Array(cur.length);
      for (let i = 0; i < cur.length; i += 1) {
        const t = cur[i];
        const mt = 1 - t;
        const pt = bezAt(b, t);
        const d1x = 3 * mt * mt * (b[1][0] - b[0][0]) + 6 * mt * t * (b[2][0] - b[1][0]) + 3 * t * t * (b[3][0] - b[2][0]);
        const d1y = 3 * mt * mt * (b[1][1] - b[0][1]) + 6 * mt * t * (b[2][1] - b[1][1]) + 3 * t * t * (b[3][1] - b[2][1]);
        const d2x = 6 * mt * (b[2][0] - 2 * b[1][0] + b[0][0]) + 6 * t * (b[3][0] - 2 * b[2][0] + b[1][0]);
        const d2y = 6 * mt * (b[2][1] - 2 * b[1][1] + b[0][1]) + 6 * t * (b[3][1] - 2 * b[2][1] + b[1][1]);
        const diffX = pt[0] - pts[i][0];
        const diffY = pt[1] - pts[i][1];
        const num = diffX * d1x + diffY * d1y;
        const den = d1x * d1x + d1y * d1y + diffX * d2x + diffY * d2y;
        const upd = Math.abs(den) > 1e-9 ? t - num / den : t;
        next[i] = clip(upd, 0.0, 1.0);
      }
      cur = next;
    }
    return cur;
  }

  // Schneider fit with fixed end tangents; recursive split on excess error.
  function fitCubics(pts, t1, t2, err = FIT_ERROR) {
    if (pts.length < 3) {
      const seg = hyp(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) / 3;
      const p0 = pts[0];
      const p3 = pts[pts.length - 1];
      return [[[p0[0], p0[1]], [p0[0] + t1[0] * seg, p0[1] + t1[1] * seg], [p3[0] + t2[0] * seg, p3[1] + t2[1] * seg], [p3[0], p3[1]]]];
    }
    let u = chordU(pts);
    let b = genBezier(pts, u, t1, t2);
    let [e, i] = fitErrorMax(pts, b, u);
    if (e <= err * err) return [b];
    u = reparam(pts, b, u);
    b = genBezier(pts, u, t1, t2);
    [e, i] = fitErrorMax(pts, b, u);
    if (e <= err * err) return [b];
    // forgive residual that is pure staircase noise
    if (e <= 2.5 * err * (2.5 * err) && smoothedFitError(pts, b, u) <= err) return [b];
    if (i <= 1 || i >= pts.length - 2) i = Math.floor(pts.length / 2);
    const w = Math.min(5, i, pts.length - 1 - i);
    const tc = unit([pts[i + w][0] - pts[i - w][0], pts[i + w][1] - pts[i - w][1]]);
    return fitCubics(pts.slice(0, i + 1), t1, [-tc[0], -tc[1]], err).concat(fitCubics(pts.slice(i), tc, t2, err));
  }

  function smoothOpen(seg, sigmaPx) {
    const sig = Math.max(0.4, sigmaPx / STEP);
    const out = smoothPoints(seg, sig, "nearest");
    out[0] = [seg[0][0], seg[0][1]];
    out[out.length - 1] = [seg[seg.length - 1][0], seg[seg.length - 1][1]];
    return out;
  }

  function turningAngles(seg, winPx) {
    const k = Math.max(2, Math.floor(winPx / STEP));
    const n = seg.length;
    const ang = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      const p0 = seg[Math.max(0, i - k)];
      const p1 = seg[i];
      const p2 = seg[Math.min(n - 1, i + k)];
      const ax = p1[0] - p0[0];
      const ay = p1[1] - p0[1];
      const bx = p2[0] - p1[0];
      const by = p2[1] - p1[1];
      const na = hyp(ax, ay);
      const nb = hyp(bx, by);
      if (na < 1e-9 || nb < 1e-9) continue;
      ang[i] = degrees(Math.acos(clip((ax * bx + ay * by) / (na * nb), -1, 1)));
    }
    return ang;
  }

  // (index, level k) where theta crosses k*pi/2 with hysteresis delta.
  function hysteresisCrossings(theta, guard, delta = radians(8)) {
    const n = theta.length;
    const out = [];
    const halfPi = Math.PI / 2;
    const lo = Math.floor(Math.min(...theta) / halfPi);
    const hi = Math.ceil(Math.max(...theta) / halfPi);
    for (let k = lo; k <= hi; k += 1) {
      const level = k * halfPi;
      let state = null; // 'below' / 'above'
      let pending = null;
      for (let i = 0; i < n; i += 1) {
        const v = theta[i];
        if (v < level - delta) {
          if (state === "above" && pending !== null) out.push([pending, k]);
          state = "below";
          pending = null;
        } else if (v > level + delta) {
          if (state === "below" && pending !== null) out.push([pending, k]);
          state = "above";
          pending = null;
        } else {
          if (pending === null && i > 0) {
            const prev = theta[i - 1];
            if ((prev - level) * (v - level) <= 0 || Math.abs(v - level) < Math.abs(prev - level)) pending = i;
          }
          if (pending !== null && i > 0 && (theta[i - 1] - level) * (v - level) <= 0) pending = i;
        }
      }
    }
    return out.filter(([i]) => guard <= i && i < n - guard);
  }

  // -> [corner indices, smooth axis-extrema indices] interior to seg.
  function curveBreakpoints(seg) {
    const n = seg.length;
    const guard = Math.max(3, Math.floor(CURVE_CORNER_WIN / STEP));
    const ang = turningAngles(seg, CURVE_CORNER_WIN);
    // two-scale test: a true corner turns hard at both scales
    const ang2 = turningAngles(seg, CURVE_CORNER_WIN2);
    const corners = [];
    let i = guard;
    while (i < n - guard) {
      if (ang[i] >= CURVE_CORNER_DEG && ang2[i] >= CURVE_CORNER_DEG2) {
        let j = i;
        while (j < n - guard && ang[j] >= CURVE_CORNER_DEG && ang2[j] >= CURVE_CORNER_DEG2) j += 1;
        corners.push(i + argmax(ang.slice(i, j)));
        i = j + guard;
      } else i += 1;
    }
    // axis extrema: hysteresis crossings of the tangent angle through k*90deg
    const tang = gradient(seg);
    let theta = unwrap(tang.map((t) => Math.atan2(t[1], t[0])));
    theta = gaussianFilter1d(theta, Math.max(1.0, 3.0 / STEP), "nearest");
    const crossings = hysteresisCrossings(theta, guard);
    // relocate each extremum onto the local envelope extreme
    const w = Math.floor(12.0 / STEP);
    const located = []; // [index, level, comp, sign]
    for (const [ci, k] of crossings) {
      const comp = pmod(k, 2) === 0 ? 1 : 0; // horizontal tangent -> y extremum
      const lo = Math.max(guard, ci - w);
      const hi = Math.min(n - guard, ci + w + 1);
      if (hi <= lo) continue;
      const vals = [];
      for (let q = lo; q < hi; q += 1) vals.push(seg[q][comp]);
      const isMin = seg[ci][comp] <= mean(vals);
      const take = isMin ? argmin(vals) : argmax(vals);
      located.push([lo + take, k, comp, isMin ? -1 : 1]);
    }
    // keep only the most extreme representative of nearby same-level crossings
    located.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
    const mergeWin = Math.floor(45.0 / STEP);
    const kept = [];
    for (const item of located) {
      const [idx, k, comp, sgn] = item;
      if (kept.length) {
        const [j, k2, comp2, sgn2] = kept[kept.length - 1];
        if (k === k2 && idx - j < mergeWin) {
          const better = sgn * seg[idx][comp] > sgn2 * seg[j][comp2];
          if (better) kept[kept.length - 1] = item;
          continue;
        }
      }
      kept.push(item);
    }
    let extrema = kept.map((item) => item[0]);
    const minSep = Math.floor(EXTREMA_MIN_SEP / STEP);
    extrema = extrema.filter((e) => corners.every((c) => Math.abs(e - c) > minSep));
    extrema.sort((a, b) => a - b);
    const merged = [];
    for (const e of extrema) {
      if (merged.length && e - merged[merged.length - 1] < minSep) continue;
      merged.push(e);
    }
    return [corners, merged];
  }

  function axisTangent(t) {
    if (Math.abs(t[0]) >= Math.abs(t[1])) return [sign(t[0]) || 1.0, 0.0];
    return [0.0, sign(t[1]) || 1.0];
  }

  // TLS line over the first/last stretch of a region, oriented along travel.
  function endTangentLine(seg, atStart, lengthPx = 10.0) {
    const k = Math.max(3, Math.floor(lengthPx / STEP));
    // Python's seg[-k:] clamps to the whole array when k exceeds its length.
    const piece = atStart ? seg.slice(0, k) : seg.slice(Math.max(0, seg.length - k));
    let mx = 0;
    let my = 0;
    for (const p of piece) {
      mx += p[0];
      my += p[1];
    }
    mx /= piece.length;
    my /= piece.length;
    let cov00 = 0;
    let cov01 = 0;
    let cov11 = 0;
    for (const p of piece) {
      const qx = p[0] - mx;
      const qy = p[1] - my;
      cov00 += qx * qx;
      cov01 += qx * qy;
      cov11 += qy * qy;
    }
    const theta = 0.5 * Math.atan2(2 * cov01, cov00 - cov11);
    let d = [Math.cos(theta), Math.sin(theta)];
    const refX = piece[piece.length - 1][0] - piece[0][0];
    const refY = piece[piece.length - 1][1] - piece[0][1];
    if (refX * d[0] + refY * d[1] < 0) d = [-d[0], -d[1]];
    return [[mx, my], d];
  }

  // seg: raw resampled points of the region (endpoints already exact).
  function fitCurveRegion(seg, tIn, tOut, sharpIn, sharpOut, presmoothed = false) {
    const sm = presmoothed ? seg : smoothOpen(seg, CURVE_SMOOTH);
    const [corners, extrema] = curveBreakpoints(sm);
    const breakSet = new Set([0, sm.length - 1]);
    for (const c of corners) breakSet.add(c);
    for (const e of extrema) breakSet.add(e);
    const breaks = [...breakSet].sort((a, b) => a - b);
    const isCorner = new Set(corners);
    const quads = [];
    const sharpStarts = [];
    for (let bi = 0; bi + 1 < breaks.length; bi += 1) {
      const a = breaks[bi];
      const b = breaks[bi + 1];
      const piece = sm.slice(a, b + 1);
      if (piece.length < 2) continue;
      let t1;
      if (a === 0 && tIn !== null) t1 = tIn;
      else {
        t1 = endTangentLine(piece, true)[1];
        if (extrema.includes(a)) t1 = axisTangent(t1);
      }
      let t2;
      if (b === sm.length - 1 && tOut !== null) t2 = tOut;
      else {
        const et = endTangentLine(piece, false)[1];
        t2 = [-et[0], -et[1]];
        if (extrema.includes(b)) t2 = axisTangent(t2);
      }
      let cubs = fitCubics(piece, t1, t2);
      if (cubs.length === 1) cubs = [rounden(cubs[0], t1, t2)];
      for (let k = 0; k < cubs.length; k += 1) {
        quads.push(cubs[k]);
        sharpStarts.push(k === 0 && isCorner.has(a));
      }
    }
    if (sharpStarts.length) sharpStarts[0] = sharpIn;
    return { quads, sharpStarts };
  }

  // ----------------------------------------------------------------- assembly

  function turningAnglesClosed(seg, winPx) {
    const k = Math.max(2, Math.floor(winPx / STEP));
    const n = seg.length;
    const out = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const pPrev = seg[pmod(i - k, n)];
      const pNext = seg[pmod(i + k, n)];
      const ax = seg[i][0] - pPrev[0];
      const ay = seg[i][1] - pPrev[1];
      const bx = pNext[0] - seg[i][0];
      const by = pNext[1] - seg[i][1];
      const na = hyp(ax, ay);
      const nb = hyp(bx, by);
      const d = (ax * bx + ay * by) / Math.max(na * nb, 1e-12);
      out[i] = degrees(Math.acos(clip(d, -1, 1)));
    }
    return out;
  }

  // Loop with no straight runs (bowls, counters).
  function traceClosedCurve(pts) {
    const n = pts.length;
    const sig = Math.max(0.4, CURVE_SMOOTH / STEP);
    const sm = smoothPoints(pts, sig, "wrap");
    const ang = turningAnglesClosed(sm, CURVE_CORNER_WIN);
    let start;
    let sharpSeam;
    if (Math.max(...ang) >= CURVE_CORNER_DEG) {
      start = argmax(ang);
      sharpSeam = true;
    } else {
      const tang = gradient(sm);
      const theta = gaussianFilter1d(unwrap(tang.map((t) => Math.atan2(t[1], t[0]))), Math.max(1.0, 3.0 / STEP), "wrap");
      const horiz = theta.map((v) => Math.abs(Math.sin(v)));
      const top = argmin(sm.map((p) => p[1]));
      const w = Math.floor(25.0 / STEP);
      let best = null;
      for (let o = -w; o <= w; o += 1) {
        const i = pmod(top + o, n);
        if (best === null || horiz[i] < horiz[best]) best = i;
      }
      start = best;
      sharpSeam = false;
    }
    const rot = sm.slice(start).concat(sm.slice(0, start), sm.slice(start, start + 1));
    let tIn = null;
    let tOut = null;
    if (!sharpSeam) {
      const k = Math.max(3, Math.floor(10.0 / STEP));
      const seam = rot.slice(rot.length - k, rot.length - 1).concat(rot.slice(0, k));
      const t = axisTangent(endTangentLine(seam, true, seam.length * STEP)[1]);
      tIn = t;
      tOut = [-t[0], -t[1]];
    }
    const curve = fitCurveRegion(rot, tIn, tOut, sharpSeam, sharpSeam, true);
    return curve.quads.map((q, i) => [q, curve.sharpStarts[i]]);
  }

  // One least-squares cubic with imposed end tangents; reparameterisation
  // rounds are kept only while they actually reduce the max error.
  function fitOneCubic(seg, t1, t2) {
    let u = chordU(seg);
    let best = genBezier(seg, u, t1, t2);
    let [bestErr] = fitErrorMax(seg, best, u);
    for (let round = 0; round < 3; round += 1) {
      u = reparam(seg, best, u);
      const b = genBezier(seg, u, t1, t2);
      const [e] = fitErrorMax(seg, b, u);
      if (e >= bestErr) break;
      best = b;
      bestErr = e;
    }
    return best;
  }

  // True if the region's tangent rotates in one direction only.
  function monotoneTurn(seg) {
    const sm = smoothOpen(seg, 5.0);
    const k = Math.max(2, Math.floor(10.0 / STEP));
    if (sm.length <= 2 * k + 2) return true;
    const thetaArr = [];
    for (let i = 2 * k; i < sm.length; i += 1) {
      thetaArr.push(Math.atan2(sm[i][1] - sm[i - 2 * k][1], sm[i][0] - sm[i - 2 * k][0]));
    }
    const theta = unwrap(thetaArr);
    let pos = 0;
    let neg = 0;
    for (let i = 1; i < theta.length; i += 1) {
      const d = theta[i] - theta[i - 1];
      if (d > 0) pos += d;
      else if (d < 0) neg -= d;
    }
    return Math.min(degrees(pos), degrees(neg)) <= ARC_INFLECT_DEG;
  }

  function lineIntersect(c0, d0, c1, d1) {
    const det = d0[0] * -d1[1] - -d1[0] * d0[1];
    if (Math.abs(det) < 1e-9) return null;
    const rx = c1[0] - c0[0];
    const ry = c1[1] - c0[1];
    const t0 = (rx * -d1[1] - -d1[0] * ry) / det;
    return [c0[0] + d0[0] * t0, c0[1] + d0[1] * t0];
  }

  // Blend a fitted cubic's handle lengths toward the ideal circular /
  // elliptic arc through the same endpoints and end tangents.
  function rounden(quad, t1, t2, amount = null) {
    if (amount === null) amount = ROUND_BLEND;
    if (amount <= 0) return quad;
    const [p0, p1, p2, p3] = quad;
    const dIn = unit(t1);
    const u2 = unit(t2);
    const dOut = [-u2[0], -u2[1]]; // travel direction at each end
    const phi = Math.acos(clip(dIn[0] * dOut[0] + dIn[1] * dOut[1], -1, 1));
    if (degrees(phi) < ROUND_MIN_DEG) return quad;
    const apex = lineIntersect(p0, dIn, p3, dOut);
    if (apex === null) return quad;
    if ((apex[0] - p0[0]) * dIn[0] + (apex[1] - p0[1]) * dIn[1] <= 0) return quad;
    if ((p3[0] - apex[0]) * dOut[0] + (p3[1] - apex[1]) * dOut[1] <= 0) return quad;
    // circular arc inscribed in the wedge
    const k = (4.0 / 3.0) * (Math.tan(phi / 4) / Math.max(Math.tan(phi / 2), 1e-9));
    const h1 = k * hyp(apex[0] - p0[0], apex[1] - p0[1]);
    const h2 = k * hyp(apex[0] - p3[0], apex[1] - p3[1]);
    const l1 = (1 - amount) * hyp(p1[0] - p0[0], p1[1] - p0[1]) + amount * h1;
    const l2 = (1 - amount) * hyp(p2[0] - p3[0], p2[1] - p3[1]) + amount * h2;
    const ut1 = unit(t1);
    const ut2 = unit(t2);
    return [
      [p0[0], p0[1]],
      [p0[0] + ut1[0] * l1, p0[1] + ut1[1] * l1],
      [p3[0] + ut2[0] * l2, p3[1] + ut2[1] * l2],
      [p3[0], p3[1]],
    ];
  }

  // Boundary samples i0..i1 inclusive, circular.
  function spanPoints(pts, i0, i1) {
    const n = pts.length;
    i0 = pmod(i0, n);
    i1 = pmod(i1, n);
    const src = i1 <= i0 ? pts.slice(i0).concat(pts.slice(0, i1 + 1)) : pts.slice(i0, i1 + 1);
    return src.map((p) => [p[0], p[1]]);
  }

  // Best-effort one-cubic fit error over a point run.
  function singleCubicErr(seg, t1 = null, t2 = null) {
    if (t1 === null) t1 = endTangentLine(seg, true)[1];
    if (t2 === null) {
      const et = endTangentLine(seg, false)[1];
      t2 = [-et[0], -et[1]];
    }
    let u = chordU(seg);
    let b = genBezier(seg, u, t1, t2);
    u = reparam(seg, b, u);
    b = genBezier(seg, u, t1, t2);
    const [e] = fitErrorMax(seg, b, u);
    const raw = Math.sqrt(e);
    return Math.max(smoothedFitError(seg, b, u), raw / 2.5);
  }

  // Merge consecutive nearly-collinear runs into 'gentle' chain elements.
  function buildElements(pts, runs, fitted) {
    const n = pts.length;
    const m = runs.length;
    if (m === 1) {
      const [s, e] = runs[0];
      const cd = fitted[0];
      return [{ kind: "line", s, e, entry: cd, exit: cd }];
    }

    function chordDir(k) {
      const [s, e] = runs[k];
      const v = [pts[pmod(e, n)][0] - pts[pmod(s, n)][0], pts[pmod(e, n)][1] - pts[pmod(s, n)][1]];
      const len = Math.max(hyp(v[0], v[1]), 1e-12);
      return [v[0] / len, v[1] / len];
    }

    function chainable(k) {
      const e0 = runs[k][1];
      const s1 = runs[(k + 1) % m][0];
      const d0 = fitted[k][1];
      const d1 = fitted[(k + 1) % m][1];
      const s1u = s1 + ((k + 1) % m === 0 ? n : 0);
      const gap = (s1u - e0) * STEP;
      let ang = degrees(Math.acos(clip(dot(d0, d1), -1, 1)));
      const angC = degrees(Math.acos(clip(dot(chordDir(k), chordDir((k + 1) % m)), -1, 1)));
      ang = Math.max(ang, angC);
      if (gap > CHAIN_GAP || ang > CHAIN_DEG) return false;
      return !(gap <= CORNER_GAP && ang >= CORNER_MIN_DEG);
    }

    const elements = [];
    const starts = [];
    for (let i = 0; i < m; i += 1) if (!chainable(pmod(i - 1, m))) starts.push(i);
    let k = starts.length ? starts[0] : 0;
    let done = 0;
    while (done < m) {
      const k0 = k;
      let k1 = k0;
      while (k1 - k0 < m - 1 && done + (k1 - k0 + 1) < m && chainable(pmod(k1, m))) {
        const dFirst = fitted[pmod(k0, m)][1];
        const dNext = fitted[pmod(k1 + 1, m)][1];
        const total = degrees(Math.acos(clip(dot(dFirst, dNext), -1, 1)));
        if (total > CHAIN_TOTAL_DEG) break;
        const seg = spanPoints(pts, runs[pmod(k0, m)][0], runs[pmod(k1 + 1, m)][1]);
        const err = singleCubicErr(smoothOpen(seg, CURVE_SMOOTH), dFirst, [-dNext[0], -dNext[1]]);
        if (err > CHAIN_TOL) break;
        k1 += 1;
      }
      const first = pmod(k0, m);
      const last = pmod(k1, m);
      elements.push({
        kind: k1 === k0 ? "line" : "gentle",
        s: pmod(runs[first][0], n),
        e: pmod(runs[last][1], n),
        entry: fitted[first],
        exit: fitted[last],
      });
      done += k1 - k0 + 1;
      k = k1 + 1;
    }
    elements.sort((a, b) => pmod(a.s, n) - pmod(b.s, n));
    return elements;
  }

  function isAxis(d) {
    const ang = pmod(degrees(Math.atan2(d[1], d[0])), 180.0);
    return Math.min(ang, 180 - ang) < AXIS_SNAP_DEG || Math.abs(ang - 90) < AXIS_SNAP_DEG;
  }

  function traceLoop(raw, isHole = false) {
    const pts = resample(raw);
    const n = pts.length;
    const fit = new PrefixFit(pts);
    const runs = findLines(pts, fit);

    const fitted = [];
    for (const [s, e] of runs) {
      let [c, d] = fit.line(s, e);
      [c, d] = snapLine(c, d);
      const pe = pts[pmod(e, n)];
      const ps = pts[pmod(s, n)];
      if ((pe[0] - ps[0]) * d[0] + (pe[1] - ps[1]) * d[1] < 0) d = [-d[0], -d[1]];
      fitted.push([c, d]);
    }

    let elements = runs.length ? buildElements(pts, runs, fitted) : [];

    // dissolve short flats into the surrounding curves
    function keeps(el) {
      if (el.kind === "gentle") return true;
      const length = pmod(el.e - el.s, n) * STEP;
      if (isHole) return length >= KEEP_HOLE;
      return length >= (isAxis(el.entry[1]) ? KEEP_AXIS : KEEP_DIAG);
    }

    const dissolved = elements.filter((el) => !keeps(el));
    elements = elements.filter((el) => keeps(el));
    const m = elements.length;

    // True if a dissolved axis-aligned run sits inside the e0..s1 gap.
    function gapHasAxisFlat(e0, s1) {
      const gapSpan = pmod(s1 - e0, n);
      for (const el of dissolved) {
        if (!isAxis(el.entry[1])) continue;
        if (pmod(el.s - e0, n) < gapSpan && pmod(el.e - e0, n) <= gapSpan) return true;
      }
      return false;
    }

    if (!elements.length) {
      return quadsToNodes(traceClosedCurve(pts));
    }

    function lineDev(p, c, d) {
      const qx = p[0] - c[0];
      const qy = p[1] - c[1];
      return Math.abs(qx * d[1] - qy * d[0]);
    }

    // tighten: regions only begin where the raster actually leaves the lines
    for (let k = 0; k < m; k += 1) {
      const el0 = elements[k];
      const el1 = elements[(k + 1) % m];
      let e0 = el0.e;
      let s1u = el1.s + (el1.s <= e0 ? n : 0);
      const [c0, d0] = el0.exit;
      const [c1, d1] = el1.entry;
      while (s1u - e0 > 2 && lineDev(pts[pmod(e0 + 1, n)], c0, d0) <= DEPART_TOL) e0 += 1;
      while (s1u - e0 > 2 && lineDev(pts[pmod(s1u - 1, n)], c1, d1) <= DEPART_TOL) s1u -= 1;
      el0.e = pmod(e0, n);
      el1.s = pmod(s1u, n);
    }

    // let gentle chains swallow short, low-turn neighbouring regions
    for (let k = 0; k < m; k += 1) {
      const el0 = elements[k];
      const el1 = elements[(k + 1) % m];
      const e0 = el0.e;
      const s1 = el1.s;
      const gapLen = pmod(s1 - e0, n) * STEP;
      if (gapLen <= CORNER_GAP || gapLen > ABSORB_LEN) continue;
      const seg = spanPoints(pts, e0, s1);
      const dIn = endTangentLine(seg, true)[1];
      const dOut = endTangentLine(seg, false)[1];
      const turn = degrees(Math.acos(clip(dot(dIn, dOut), -1, 1)));
      if (turn > ABSORB_DEG) continue;
      const cands = [el1, el0].filter((el) => el.kind === "gentle");
      if (!cands.length) continue;
      let into = cands[0];
      for (const el of cands) if (pmod(el.e - el.s, n) > pmod(into.e - into.s, n)) into = el;
      if (into === el1) {
        el1.s = e0;
        el1.entry = endTangentLine(seg, true);
      } else {
        el0.e = s1;
        el0.exit = endTangentLine(seg, false);
      }
    }

    // loop orientation: interior lies to this side of the travel direction
    let shoelace = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      shoelace += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    const loopSign = shoelace > 0 ? 1.0 : -1.0;

    function insideDist(p, c, d) {
      const qx = p[0] - c[0];
      const qy = p[1] - c[1];
      return loopSign * (-d[1] * qx + d[0] * qy);
    }

    const debug = typeof process !== "undefined" && process.env && process.env.AT2_DEBUG;
    if (debug) {
      for (const el of elements) {
        console.log(`  el ${el.kind} s=${el.s} e=${el.e} ${pts[pmod(el.s, n)].map(Math.round)} -> ${pts[pmod(el.e, n)].map(Math.round)}`);
      }
    }
    const junctions = [];
    for (let k = 0; k < m; k += 1) {
      const el0 = elements[k];
      const el1 = elements[(k + 1) % m];
      let e0 = el0.e;
      let s1 = el1.s;
      const [c0, d0] = el0.exit;
      const [c1, d1] = el1.entry;
      let gapLen = pmod(s1 - e0, n) * STEP;
      const cross = d0[0] * d1[1] - d0[1] * d1[0];
      const angle = Math.abs(degrees(Math.atan2(cross, dot(d0, d1))));
      const concave = sign(cross) === -loopSign && angle >= CLASSIFY_DEG;
      const convex = sign(cross) === loopSign && angle >= CLASSIFY_DEG;
      if (CORNER_GAP < gapLen && gapLen <= CLASSIFY_GAP && (concave || convex)) {
        const region = spanPoints(pts, e0, s1);
        if (convex) {
          // real corner rounding stays inside the wedge; an upscale hump
          // pokes outside -> treat as a sharp corner
          let out0 = -Infinity;
          let out1 = -Infinity;
          for (const p of region) {
            out0 = Math.max(out0, -insideDist(p, c0, d0));
            out1 = Math.max(out1, -insideDist(p, c1, d1));
          }
          const outside = Math.max(out0, out1);
          if (OUTSIDE_TOL < outside && outside <= HUMP_MAX) {
            const corner = lineIntersect(c0, d0, c1, d1);
            if (corner !== null) {
              junctions.push({ type: "corner", pt: corner, sharp: true });
              continue;
            }
          }
        } else {
          // concave stroke join: extend the straight edges into the transition
          const pull = Math.floor((gapLen * FILLET_PULL) / STEP);
          e0 = pmod(e0 + pull, n);
          s1 = pmod(s1 - pull, n);
          gapLen = pmod(s1 - e0, n) * STEP;
        }
      }
      if (gapLen <= CORNER_GAP) {
        if (angle >= CORNER_MIN_DEG) {
          const corner = lineIntersect(c0, d0, c1, d1);
          const pe = pts[pmod(e0, n)];
          const ps = pts[pmod(s1, n)];
          const mid = [(pe[0] + ps[0]) / 2, (pe[1] + ps[1]) / 2];
          if (corner !== null && hyp(corner[0] - mid[0], corner[1] - mid[1]) <= CORNER_SNAP) {
            junctions.push({ type: "corner", pt: corner, sharp: true });
            continue;
          }
        }
        // nearly parallel: gentle bend, one smooth node at the meeting point
        const pa = project(pts[pmod(e0, n)], c0, d0);
        const pb = project(pts[pmod(s1, n)], c1, d1);
        junctions.push({ type: "corner", pt: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], sharp: angle >= CORNER_MIN_DEG });
        continue;
      }
      const seg = spanPoints(pts, e0, s1);
      if (debug) {
        console.log(
          `  jct ${k}: gap ${gapLen.toFixed(1)} angle ${angle.toFixed(1)} concave=${concave} convex=${convex} at ${pts[pmod(e0, n)].map(Math.round)}..${pts[pmod(s1, n)].map(Math.round)}`
        );
      }
      if (seg.length < 3) {
        junctions.push({
          type: "corner",
          pt: [(seg[0][0] + seg[seg.length - 1][0]) / 2, (seg[0][1] + seg[seg.length - 1][1]) / 2],
          sharp: angle >= CORNER_MIN_DEG,
        });
        continue;
      }
      let arcOk = false;
      if (
        SHORT_REGION < gapLen &&
        gapLen <= ARC_MAX_LEN &&
        ARC_MIN_DEG <= angle &&
        angle <= ARC_MAX_DEG &&
        monotoneTurn(seg) &&
        !gapHasAxisFlat(e0, s1)
      ) {
        // the bend apex must sit fairly centrally
        const inter = lineIntersect(c0, d0, c1, d1);
        if (inter !== null) {
          const dists = seg.map((p) => hyp(p[0] - inter[0], p[1] - inter[1]));
          const apex = argmin(dists);
          const l1 = apex;
          const l2 = seg.length - 1 - apex;
          arcOk = Math.min(l1, l2) >= 0.35 * Math.max(l1, l2, 1);
        }
      }
      if (arcOk) {
        // a plain rounded corner between two strokes: one G1 cubic
        seg[0] = project(seg[0], c0, d0);
        seg[seg.length - 1] = project(seg[seg.length - 1], c1, d1);
        const sm = smoothOpen(seg, CURVE_SMOOTH);
        const quad = rounden(fitOneCubic(sm, d0, [-d1[0], -d1[1]]), d0, [-d1[0], -d1[1]]);
        junctions.push({
          type: "curve",
          curve: { quads: [quad], sharpStarts: [false] },
          sharpIn: false,
          sharpOut: false,
          entryPt: [seg[0][0], seg[0][1]],
          exitPt: [seg[seg.length - 1][0], seg[seg.length - 1][1]],
        });
        continue;
      }
      // second chance: a ragged short edge (foot / leg bottom) that fits an
      // axis line under relaxed tolerance becomes corner - edge - corner
      if (SHORT_REGION < gapLen && gapLen <= 2 * CLASSIFY_GAP) {
        const k0 = Math.max(2, Math.floor(0.2 * seg.length));
        const core = seg.slice(k0, seg.length - k0);
        if (core.length >= 8) {
          let [cl, dl] = endTangentLine(core, true, core.length * STEP);
          [cl, dl] = snapLine(cl, dl);
          const dev = core.map((p) => (p[0] - cl[0]) * dl[1] - (p[1] - cl[1]) * dl[0]);
          const sig = Math.max(0.5, 14.0 / STEP / 2.355);
          const smDev = gaussianFilter1d(dev, sig, "nearest");
          const a0 = degrees(Math.acos(clip(Math.abs(dot(dl, d0)), 0, 1)));
          const a1 = degrees(Math.acos(clip(Math.abs(dot(dl, d1)), 0, 1)));
          let maxDev = 0;
          for (const v of dev) maxDev = Math.max(maxDev, Math.abs(v));
          let maxSm = 0;
          for (const v of smDev) maxSm = Math.max(maxSm, Math.abs(v));
          if (isAxis(dl) && maxDev <= 2.5 * LINE_TOL && maxSm <= 1.2 * LINE_TOL && Math.min(a0, a1) >= CORNER_MIN_DEG) {
            const pA = lineIntersect(c0, d0, cl, dl);
            const pB = lineIntersect(cl, dl, c1, d1);
            if (
              pA !== null &&
              pB !== null &&
              (pB[0] - pA[0]) * dl[0] + (pB[1] - pA[1]) * dl[1] > 12.0 &&
              hyp(pA[0] - seg[0][0], pA[1] - seg[0][1]) <= 0.6 * gapLen &&
              hyp(pB[0] - seg[seg.length - 1][0], pB[1] - seg[seg.length - 1][1]) <= 0.6 * gapLen
            ) {
              const third = [(pB[0] - pA[0]) / 3, (pB[1] - pA[1]) / 3];
              const quad = [
                [pA[0], pA[1]],
                [pA[0] + third[0], pA[1] + third[1]],
                [pB[0] - third[0], pB[1] - third[1]],
                [pB[0], pB[1]],
              ];
              junctions.push({
                type: "curve",
                curve: { quads: [quad], sharpStarts: [true] },
                sharpIn: true,
                sharpOut: true,
                entryPt: [pA[0], pA[1]],
                exitPt: [pB[0], pB[1]],
              });
              continue;
            }
          }
        }
      }
      // probe on the raw boundary so the projection jump cannot fake a join
      const probe = Math.max(2, Math.floor(JOIN_PROBE / STEP));
      const probeIn = unit([seg[Math.min(seg.length - 1, probe)][0] - seg[0][0], seg[Math.min(seg.length - 1, probe)][1] - seg[0][1]]);
      const poIdx = Math.max(0, seg.length - 1 - probe);
      const probeOut = unit([seg[seg.length - 1][0] - seg[poIdx][0], seg[seg.length - 1][1] - seg[poIdx][1]]);
      const angIn = degrees(Math.acos(clip(dot(d0, probeIn), -1, 1)));
      const angOut = degrees(Math.acos(clip(dot(d1, probeOut), -1, 1)));
      const sharpIn = angIn > SMOOTH_JOIN_DEG;
      const sharpOut = angOut > SMOOTH_JOIN_DEG;
      let entryPt = null;
      let exitPt = null;
      let tIn = d0;
      let tOut = [-d1[0], -d1[1]];
      if (sharpIn) {
        const [cs, ds] = endTangentLine(seg, true);
        const cross2 = lineIntersect(c0, d0, cs, ds);
        if (cross2 !== null && hyp(cross2[0] - seg[0][0], cross2[1] - seg[0][1]) <= CORNER_SNAP) entryPt = cross2;
        tIn = ds;
      }
      if (sharpOut) {
        const [ce, de] = endTangentLine(seg, false);
        const cross2 = lineIntersect(ce, de, c1, d1);
        if (cross2 !== null && hyp(cross2[0] - seg[seg.length - 1][0], cross2[1] - seg[seg.length - 1][1]) <= CORNER_SNAP) exitPt = cross2;
        tOut = [-de[0], -de[1]];
      }
      if (debug) {
        console.log(`  jct ${k} probes: ang_in=${angIn} ang_out=${angOut} sharp=${sharpIn},${sharpOut}`);
        console.log(`    t_in=${tIn} t_out=${tOut} entry=${entryPt} exit=${exitPt}`);
        console.log(`    seg0=${seg[0]} segN=${seg[seg.length - 1]} len=${seg.length}`);
      }
      seg[0] = entryPt !== null ? entryPt : project(seg[0], c0, d0);
      seg[seg.length - 1] = exitPt !== null ? exitPt : project(seg[seg.length - 1], c1, d1);
      let curve;
      if (gapLen <= SHORT_REGION) {
        // short transition (fillet / rounded corner): one smooth cubic
        const sm = smoothOpen(seg, CURVE_SMOOTH);
        const quad = rounden(fitOneCubic(sm, tIn, tOut), tIn, tOut);
        curve = { quads: [quad], sharpStarts: [false] };
      } else {
        curve = fitCurveRegion(seg, tIn, tOut, sharpIn, sharpOut);
      }
      junctions.push({
        type: "curve",
        curve,
        sharpIn,
        sharpOut,
        entryPt: [seg[0][0], seg[0][1]],
        exitPt: [seg[seg.length - 1][0], seg[seg.length - 1][1]],
      });
    }

    // assemble: element k, then junction k, ...
    const segs = [];
    for (let k = 0; k < m; k += 1) {
      const prevJ = junctions[pmod(k - 1, m)];
      const thisJ = junctions[k];
      const el = elements[k];
      const d0 = el.entry[1];
      const d1 = el.exit[1];
      let pStart;
      let startSharp;
      if (prevJ.type === "corner") {
        pStart = prevJ.pt;
        startSharp = prevJ.sharp;
      } else {
        pStart = prevJ.exitPt;
        startSharp = prevJ.sharpOut;
      }
      const pEnd = thisJ.type === "corner" ? thisJ.pt : thisJ.entryPt;
      if (el.kind === "line") {
        const third = [(pEnd[0] - pStart[0]) / 3, (pEnd[1] - pStart[1]) / 3];
        segs.push([
          [
            [pStart[0], pStart[1]],
            [pStart[0] + third[0], pStart[1] + third[1]],
            [pEnd[0] - third[0], pEnd[1] - third[1]],
            [pEnd[0], pEnd[1]],
          ],
          startSharp,
        ]);
      } else {
        // gentle chain: one smooth cubic (or few, if the fit insists)
        let seg = spanPoints(pts, el.s, el.e);
        seg = smoothOpen(seg, CURVE_SMOOTH);
        seg[0] = [pStart[0], pStart[1]];
        seg[seg.length - 1] = [pEnd[0], pEnd[1]];
        const cubs = fitCubics(seg, d0, [-d1[0], -d1[1]], CHAIN_TOL);
        for (let i = 0; i < cubs.length; i += 1) segs.push([cubs[i], i === 0 ? startSharp : false]);
      }
      if (thisJ.type === "curve") {
        const cur = thisJ.curve;
        for (let i = 0; i < cur.quads.length; i += 1) {
          segs.push([cur.quads[i], i > 0 ? cur.sharpStarts[i] : thisJ.sharpIn]);
        }
      }
    }
    return quadsToNodes(segs);
  }

  function clampCanvas(v, limit) {
    return Math.max(0.0, Math.min(limit, v));
  }

  // Join consecutive cubics into the editor's node format; collinearize
  // handles at smooth nodes.
  function quadsToNodes(segs) {
    const quads = segs.map(([q]) => q);
    let sharp = segs.map(([, s]) => s);
    const nseg = quads.length;
    let nodes = [];
    for (let i = 0; i < nseg; i += 1) {
      const prev = quads[pmod(i - 1, nseg)];
      const cur = quads[i];
      const ax = (prev[3][0] + cur[0][0]) / 2;
      const ay = (prev[3][1] + cur[0][1]) / 2;
      nodes.push({
        x: clampCanvas(ax, CANVAS_W),
        y: clampCanvas(ay, CANVAS_H),
        inX: prev[2][0],
        inY: prev[2][1],
        outX: cur[1][0],
        outY: cur[1][1],
      });
    }
    [nodes, sharp] = dedupeNodes(nodes, sharp);
    for (let i = 0; i < nodes.length; i += 1) {
      if (sharp[i]) continue;
      const node = nodes[i];
      const a = [node.x, node.y];
      const hin = [node.inX, node.inY];
      const hout = [node.outX, node.outY];
      const u1 = unit([a[0] - hin[0], a[1] - hin[1]]);
      const u2 = unit([hout[0] - a[0], hout[1] - a[1]]);
      const t = unit([u1[0] + u2[0], u1[1] + u2[1]]);
      if (hyp(t[0], t[1]) < 1e-6) continue;
      const lin = hyp(a[0] - hin[0], a[1] - hin[1]);
      const lout = hyp(hout[0] - a[0], hout[1] - a[1]);
      node.inX = a[0] - t[0] * lin;
      node.inY = a[1] - t[1] * lin;
      node.outX = a[0] + t[0] * lout;
      node.outY = a[1] + t[1] * lout;
    }
    return nodes;
  }

  function dedupeNodes(nodes, sharp, eps = 0.75) {
    const out = [];
    const outSharp = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const sh = sharp[i];
      if (out.length) {
        const p = out[out.length - 1];
        if (hyp(node.x - p.x, node.y - p.y) < eps) {
          p.outX = node.outX;
          p.outY = node.outY;
          outSharp[outSharp.length - 1] = outSharp[outSharp.length - 1] || sh;
          continue;
        }
      }
      out.push(node);
      outSharp.push(sh);
    }
    if (out.length > 1 && hyp(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < eps) {
      const last = out[out.length - 1];
      out[0].inX = last.inX;
      out[0].inY = last.inY;
      out[0].x = last.x;
      out[0].y = last.y;
      outSharp[0] = outSharp[0] || outSharp[outSharp.length - 1];
      out.pop();
      outSharp.pop();
    }
    return [out, outSharp];
  }

  // ------------------------------------------------------------------- entry

  // mask: truthy foreground per pixel, row-major width×height.
  // options: { round: 0..1 shoulder roundness (default 0.5) }.
  function traceMask(mask, width, height, options = {}) {
    ROUND_BLEND = options.round === undefined ? DEFAULT_ROUND : Number(options.round);
    CANVAS_W = width;
    CANVAS_H = height;
    const loops = boundaryLoops(mask, width, height);
    let outer = -1;
    let outerArea = -Infinity;
    for (let i = 0; i < loops.length; i += 1) {
      const a = Math.abs(area(loops[i]));
      if (a > outerArea) {
        outerArea = a;
        outer = i;
      }
    }
    const contours = [];
    for (let i = 0; i < loops.length; i += 1) {
      const nodes = traceLoop(loops[i], i !== outer);
      if (nodes.length >= 3) contours.push(nodes);
    }
    return contours;
  }

  return {
    traceMask,
    maskToLoops,
    area,
    DEFAULT_ROUND,
    // Internal pieces exposed for the parity test suite only.
    _internals: {
      resample,
      boundaryLoops,
      findLines,
      PrefixFit,
      endTangentLine,
      spanPoints,
      smoothOpen,
      fitOneCubic,
      rounden,
      gaussianFilter1d,
      unwrap,
    },
  };
})();
