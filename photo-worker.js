// photo-worker.js — same-origin ES-module Web Worker for off-main-thread image
// decode/downscale/encode. The main thread (createWorkerDownscaler in app.js)
// posts { id, file, maxDimension, quality } and gets back
// { id, ok, blob, width, height } (or { id, ok:false } on any failure — the
// original File is NEVER echoed back, to avoid shipping a (potentially large)
// buffer over postMessage twice). The width/height are the orientation-corrected,
// post-scale dimensions of the encoded JPEG — the gallery uses them to size tiles
// before any image downloads.
//
// On init it runs a real OffscreenCanvas round-trip self-test and posts
// { ready:true|false } so the dispatcher can pick the worker path vs. the
// main-thread fallback (iOS ≤16 lacks OffscreenCanvas-in-worker).
//
// Imports NOTHING. maxDimension/quality arrive in the message (single source of
// truth — the constants live in app.js, not duplicated here). The scaling math
// mirrors downscaleImage exactly.

self.onmessage = async (e) => {
  const { id, file, maxDimension, quality } = e.data || {};
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      self.postMessage({ id, ok: false });
      return;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.(); // free the decoded bitmap immediately after draw
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    if (!blob) {
      self.postMessage({ id, ok: false });
      return;
    }
    self.postMessage({ id, ok: true, blob, width: w, height: h });
  } catch {
    // NEVER echo `file` back — just signal failure; the dispatcher bails to the
    // original File it already holds.
    self.postMessage({ id, ok: false });
  }
};

// Readiness self-test: actually exercise the OffscreenCanvas → 2d ctx →
// convertToBlob round-trip (not just feature-detection) so a browser that
// exposes the constructor but can't encode in a worker is caught here.
(async () => {
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.convertToBlob !== 'function') {
      self.postMessage({ ready: false });
      return;
    }
    const probe = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    self.postMessage({ ready: !!probe });
  } catch {
    self.postMessage({ ready: false });
  }
})();
