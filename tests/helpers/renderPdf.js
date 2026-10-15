import { loadPdfDocument, renderPageToCanvas } from "@/lib/pdfRender";

// Under Node, pdf.js makes its scratch canvases with @napi-rs/canvas, which
// jsdom's 2D context (backed by the `canvas` package) cannot draw from:
// painting any page with a raster image on it fails with "Image or Canvas
// expected". A browser uses DOM canvases, so this factory hands pdf.js
// jsdom canvases instead - the same arrangement, in the test environment.
// Pages without images never reach it, which is why the rest of the suite
// renders without it.
class JsdomCanvasFactory {
  create(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { canvas, context: canvas.getContext("2d") };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

// Renders page 1 of `bytes` through the app's own renderPageToCanvas and
// returns the canvas.
export async function renderFirstPage(bytes, targetWidth = 80) {
  await loadPdfDocument(bytes.slice()); // configures pdf.js's worker, as the app does
  const pdfjs = await import("pdfjs-dist/build/pdf");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), CanvasFactory: JsdomCanvasFactory }).promise;
  const canvas = document.createElement("canvas");
  await renderPageToCanvas(doc, 1, canvas, targetWidth).promise;
  return canvas;
}

// Does the one-time work of the first render outside any timed wait:
// importing pdf.js, parsing its 1.4 MB worker script on the main thread,
// and the canvas package's first drawing. On a cold checkout that is
// several seconds, so a "wait up to 5 s for the thumbnail" test that came
// first in its file was timing the start-up rather than the render, and
// failed on a fresh clone. Call it from beforeAll in any file whose tests
// wait on a real render.
export async function warmPdfjs() {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.create();
  src.addPage([10, 10]).drawRectangle({ x: 2, y: 2, width: 5, height: 5 });
  const doc = await loadPdfDocument(await src.save());
  await renderPageToCanvas(doc, 1, document.createElement("canvas"), 20).promise;
}
