import { PDFDocument, rgb } from "pdf-lib";

// Builds a real, valid PDF in memory with `pageCount` pages, each labeled
// with its own page number so tests can visually/structurally distinguish
// pages. Returns raw bytes, exactly like what the app gets from
// `file.arrayBuffer()`.
export async function makeSamplePdfBytes(pageCount = 1, { width = 200, height = 200 } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([width, height]);
    page.drawText(`Page ${i}`, { x: 20, y: height / 2, size: 20, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

// Same idea, but draws a filled rectangle instead of text. pdf.js's text
// rendering path calls into font_loader.js's getPathGenerator, which uses
// the browser Path2D API to cache glyph outlines — jsdom doesn't
// implement Path2D (a test-environment gap; every real browser does), so
// tests that need to verify actual rendered pixel output use this
// text-free variant to sidestep that gap entirely, rather than mocking
// around pdf.js's internals.
export async function makeSamplePdfBytesNoText(pageCount = 1, { width = 200, height = 200 } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([width, height]);
    page.drawRectangle({
      x: width * 0.25,
      y: height * 0.25,
      width: width * 0.5,
      height: height * 0.5,
      color: rgb(0, 0, 0),
    });
  }
  return doc.save();
}

// Builds a PDF where every page has a distinct, deliberately-chosen width.
// Page identity survives pdf-lib's copyPages() (unlike text content, which
// is annoying to re-extract reliably in tests), so this lets tests verify
// *which* original page ended up in *which* position after splice / split
// / merge / remove operations, just by reading back page widths.
export async function makeFingerprintedPdfBytes(widths) {
  const doc = await PDFDocument.create();
  for (const width of widths) {
    doc.addPage([width, 100]);
  }
  return doc.save();
}

// Reads back the fingerprint (page widths, in order) from PDF bytes.
export async function readFingerprint(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

// Builds a PDF with a real embedded raster image drawn onto `pageCount`
// pages (same image bytes/every page, if `repeatSameImage` is true — this
// is how pdf.js's `commonObjs` global-image caching gets exercised, since
// pdf.js only caches an image as "global" once it recognizes the same
// XObject is reused across pages).
// jsdom's File/Blob implementation doesn't support `.arrayBuffer()` (every
// real browser does) — rather than fight jsdom's internals, this is a
// minimal stand-in that implements exactly what the app actually calls:
// `.name` and an async `.arrayBuffer()`. Good enough to drive real
// `loadMasterFile`/`handleGapFile`-style code paths under test.
export function toFakeFile(bytes, name, type = "application/pdf") {
  return {
    name,
    type,
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

export async function makePdfBytesWithEmbeddedImage({
  pageCount = 1,
  imageColor = "#0000ff",
  imageSize = 20,
  repeatSameImage = true,
} = {}) {
  const { createCanvas } = await import("canvas");
  const doc = await PDFDocument.create();

  async function embedNewImage() {
    const canvas = createCanvas(imageSize, imageSize);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = imageColor;
    ctx.fillRect(0, 0, imageSize, imageSize);
    // canvas.toBuffer() returns a Node Buffer constructed in Node's own
    // realm. Under Vitest+jsdom, the test module executes in a separate
    // vm realm with its own Uint8Array constructor, so pdf-lib's
    // `instanceof Uint8Array` type check silently fails to recognize the
    // Buffer as valid — re-wrapping the bytes via this realm's Uint8Array
    // fixes it. (Not an app concern: real browsers only ever have one
    // realm.)
    const nodeBuffer = canvas.toBuffer("image/png");
    const bytes = new Uint8Array(nodeBuffer);
    return doc.embedPng(bytes);
  }

  const sharedImage = repeatSameImage ? await embedNewImage() : null;

  for (let i = 0; i < pageCount; i++) {
    const image = sharedImage || (await embedNewImage());
    const page = doc.addPage([100, 100]);
    page.drawImage(image, { x: 10, y: 10, width: imageSize, height: imageSize });
  }

  return doc.save();
}

// Builds a real single-page PNG image as bytes (used for "insert an image"
// flows in Splice).
export async function makeSamplePngBytes({ width = 40, height = 40 } = {}) {
  // A tiny valid PNG (solid color) built by hand via pdf-lib's canvas-free
  // helpers isn't available, so instead we synthesize a minimal PNG buffer
  // using the `canvas` package already present for jsdom's 2D context.
  const { createCanvas } = await import("canvas");
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}
