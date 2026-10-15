// jsdom (even with the `canvas` package installed for real 2D rendering)
// doesn't implement a few browser APIs the app relies on. Polyfill just
// enough to exercise the real code paths in tests.

import { vi } from "vitest";

// jsdom's Blob doesn't implement .arrayBuffer() at all (every real
// browser does). The app's own File-reading code sidesteps this with a
// test-only fake (see tests/helpers/samplePdf.js's toFakeFile), but
// *exported* Blobs (e.g. what the app hands to URL.createObjectURL when
// downloading) are still real jsdom Blobs, so tests that want to verify
// exported file contents need this polyfill.
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// jsdom's HTMLCanvasElement doesn't implement toBlob() even when the
// `canvas` npm package supplies a real 2D context — it only gets
// toDataURL(). Bridge the two so pdfRender.js's renderPageToPngBlob /
// extractImagesFromPage (which call canvas.toBlob) work under test.
if (typeof HTMLCanvasElement !== "undefined" && !HTMLCanvasElement.prototype.toBlob) {
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type = "image/png") {
    const dataUrl = this.toDataURL(type);
    const base64 = dataUrl.split(",")[1];
    const binary = Buffer.from(base64, "base64");
    callback(new Blob([binary], { type }));
  };
}

// jsdom has no ImageData constructor, which pdf.js uses to paint a page
// that contains a raster image. The canvas package's own ImageData is the
// one jsdom's 2D context (backed by that package) accepts.
if (typeof globalThis.ImageData === "undefined") {
  const { ImageData } = await import("canvas");
  globalThis.ImageData = ImageData;
}

// Clicking a download link makes jsdom try to navigate to the blob URL,
// which it cannot, and it prints "Not implemented: navigation" with a stack
// trace for every export in the suite - enough noise to bury a real error.
// A browser would start a download there; do nothing instead. Tests that
// check the file name or contents capture them before the click.
if (typeof HTMLAnchorElement !== "undefined") {
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download")) return;
    return click.call(this);
  };
}

// jsdom doesn't implement URL.createObjectURL/revokeObjectURL. The app
// uses these for downloads and for image-preview <img> src values —
// stub them so that code doesn't throw under test.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = vi.fn();
}
