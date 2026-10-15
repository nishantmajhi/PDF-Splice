import { markRaw } from "vue";

let pdfjsLibPromise = null;

// Lazily load pdf.js only in the browser. The worker is bundled locally by
// Vite (rather than fetched from a version-pinned CDN URL) so it always
// matches the installed pdfjs-dist version and works offline / behind
// blockers. A CDN worker that fails to load doesn't error — pdf.js just
// waits forever on a response that will never come, which is what made
// scans and thumbnails look "stuck" instead of failing visibly.
//
// The `?url` suffix is Vite's documented way to import an asset as a
// resolved URL string — more reliable across dev-server setups (proxies,
// custom base paths, etc.) than constructing the URL by hand with
// `new URL(bareSpecifier, import.meta.url)`.
async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = Promise.all([
      import("pdfjs-dist/build/pdf"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([lib, workerModule]) => {
      configureWorker(lib.GlobalWorkerOptions, workerModule.default);
      return lib;
    });
  }
  return pdfjsLibPromise;
}

// Every document shares one worker. Given only workerSrc, pdf.js starts a
// new Web Worker for each getDocument() call - each loading its own copy
// of the 1.4 MB worker script - and stops it only when that document is
// destroyed, which nothing in this app does. Merging six files left six
// worker threads running until the tab closed. A workerPort is pdf.js's
// documented way to reuse one worker for every document.
//
// Where there is no Worker (the test environment), pdf.js runs its worker
// code on the main thread from workerSrc instead, as before.
export function configureWorker(options, workerUrl, WorkerImpl = globalThis.Worker) {
  options.workerSrc = workerUrl;
  if (typeof WorkerImpl === "function" && !options.workerPort) {
    options.workerPort = new WorkerImpl(workerUrl, { type: "module" });
  }
}

// Wraps a promise so it can never hang the UI forever — rejects with a
// timeout error if the underlying operation doesn't settle in time.
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Kick off the pdfjs-dist dynamic import (and its worker) as soon as this
// module loads — i.e. as soon as the app starts — instead of waiting for
// the first PDF upload to trigger it. pdfjs-dist is a sizeable chunk that
// Vite code-splits behind the dynamic import in getPdfjsLib(), so on a
// fresh session the *first* upload was paying for that fetch + parse right
// before the very first page render, which is what showed up as a visible
// pop-in/flicker only the first time around (later uploads reuse the
// already-loaded module and don't pay that cost, hence no flicker).
if (typeof window !== "undefined") {
  getPdfjsLib();
}

export async function loadPdfDocument(bytesOrUrl) {
  const pdfjsLib = await getPdfjsLib();
  const loadingTask = pdfjsLib.getDocument(bytesOrUrl);
  const doc = await loadingTask.promise;

  // Defense-in-depth on top of every call site using shallowRef/
  // shallowReactive: markRaw() permanently flags this pdf.js document (a
  // class instance with native private fields) so Vue's reactive()/ref()
  // skip wrapping it in a Proxy *no matter where it later ends up* —
  // even if some future code path stores it in a plain ref(), a deeply
  // reactive object, or (as found while testing) a testing utility's own
  // internal reactivity. Without this, the object's private fields throw
  // "Cannot read private member ... from an object whose class did not
  // declare it" the moment a method is called through a Proxy — see
  // pageViewer.js for the full original write-up of this failure mode.
  return markRaw(doc);
}

// Renders a single page of a loaded pdf.js document onto a canvas element.
// Returns a handle with `promise` (resolves when drawing is done) and
// `cancel()` — callers MUST call cancel() on unmount/re-render, otherwise a
// second render can start on the same canvas before the first finishes.
// pdf.js rejects that with "Cannot use the same canvas during multiple
// render() operations", which — if swallowed by a catch — leaves the
// thumbnail blank forever with no visible error.
export function renderPageToCanvas(pdfDoc, pageNumber, canvas, targetWidth = 256) {
  let cancelled = false;
  let renderTask = null;

  const promise = (async () => {
    const page = await pdfDoc.getPage(pageNumber);
    if (cancelled) return;

    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });

    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    if (cancelled) return;
    renderTask = page.render({ canvasContext: context, viewport });
    await renderTask.promise;
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    },
  };
}

// Renders a full page at higher resolution and returns a PNG blob —
// used by the "PDF to Image" tool (one image per page, full quality).
export async function renderPageToPngBlob(pdfDoc, pageNumber, scale = 2) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");

  await page.render({ canvasContext: context, viewport }).promise;

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// Extracts the raw embedded raster images from a page's XObject resources.
// This is different from rendering the page — it pulls the actual embedded
// image data pdf.js has already decoded, rather than rasterizing content.
//
// `seenGlobalIds` is optional — pass the same Set across every page of one
// document to dedupe images that recur on many pages (e.g. a logo or footer
// graphic placed on every slide of a deck). pdf.js caches those once and
// reuses them, so without dedup they'd otherwise show up as one "found"
// image per page they appear on.
export async function extractImagesFromPage(pdfDoc, pageNumber, seenGlobalIds = new Set()) {
  const page = await pdfDoc.getPage(pageNumber);
  const opList = await withTimeout(
    page.getOperatorList(),
    15000,
    `Timed out reading page ${pageNumber}`
  );
  const pdfjsLib = await getPdfjsLib();
  const images = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const isImageOp =
      opList.fnArray[i] === pdfjsLib.OPS.paintImageXObject ||
      opList.fnArray[i] === pdfjsLib.OPS.paintJpegXObject;
    if (!isImageOp) continue;

    const imageName = opList.argsArray[i][0];

    // pdf.js prefixes an object's name with "g_" when it's cached globally
    // (shared across pages) rather than per-page — that only exists on
    // `page.commonObjs`, never `page.objs`. Looking it up in the wrong
    // store doesn't error, it just never resolves, so this previously
    // burned a full timeout per page for every recurring graphic.
    const isGlobal = imageName.startsWith("g_");
    if (isGlobal) {
      if (seenGlobalIds.has(imageName)) continue;
      seenGlobalIds.add(imageName);
    }
    const store = isGlobal ? page.commonObjs : page.objs;

    try {
      const img = await withTimeout(
        new Promise((resolve) => {
          store.get(imageName, resolve);
          // pdf.js resolves synchronously if already available; if not this
          // callback fires once decoding completes.
        }),
        10000,
        `Timed out waiting for image "${imageName}" to decode`
      );
      if (!img) continue;

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      if (img.bitmap) {
        // Newer pdf.js decodes JPEGs via the browser's native decoder and
        // hands back an ImageBitmap instead of a raw pixel array — this is
        // the path most real photos take. Draw it straight to the canvas
        // rather than looking for a `.data` array that won't exist here.
        ctx.drawImage(img.bitmap, 0, 0);
      } else if (img.data) {
        const imageData = ctx.createImageData(img.width, img.height);
        // img.data may be RGB (3 channels) or RGBA (4 channels) depending on source.
        const channels = img.data.length / (img.width * img.height);
        if (channels === 4) {
          imageData.data.set(img.data);
        } else if (channels === 3) {
          for (let px = 0; px < img.width * img.height; px++) {
            imageData.data[px * 4] = img.data[px * 3];
            imageData.data[px * 4 + 1] = img.data[px * 3 + 1];
            imageData.data[px * 4 + 2] = img.data[px * 3 + 2];
            imageData.data[px * 4 + 3] = 255;
          }
        } else {
          continue; // unrecognized pixel format — skip rather than render garbage
        }
        ctx.putImageData(imageData, 0, 0);
      } else {
        continue;
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      images.push({ blob, width: img.width, height: img.height });
    } catch {
      // Some XObjects (masks, inline images pdf.js handles differently)
      // may not resolve cleanly — skip rather than fail the whole page.
    }
  }

  return images;
}
