// Module worker wrapping the auto-tracer so large masks cannot freeze the
// UI thread. Protocol: { id, mask (Uint8Array), width, height, round } in,
// { id, contours } or { id, error } out. app.js falls back to running the
// tracer synchronously when workers are unavailable.
import { AutoTrace } from "./autotrace.js";

self.onmessage = (event) => {
  const { id, mask, width, height, round } = event.data;
  try {
    const contours = AutoTrace.traceMask(new Uint8Array(mask), width, height, { round });
    self.postMessage({ id, contours });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
