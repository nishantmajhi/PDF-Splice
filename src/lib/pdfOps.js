import {
  PDFDocument,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import { jpegOrientation, orientationTransform, sniffImageType } from "./imageBytes";

// A single-page PDF sized to the image, one PDF point per pixel. pdf-lib
// embeds PNG and JPEG bytes as they are, so neither is re-encoded.
//
// A JPEG is drawn the way its EXIF orientation says to show it, since that
// is how every viewer - and this app's own file picker - showed it to the
// user. pdf-lib ignores the tag, so without this a portrait phone photo
// became a sideways page. The pixels are left alone and only the matrix
// they are drawn through changes.
async function imageBytesToPdfBytes(bytes, type) {
  const doc = await PDFDocument.create();
  const image = type === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

  const orientation = type === "jpeg" ? jpegOrientation(bytes) : 1;
  const { width, height, matrix } = orientationTransform(orientation, image.width, image.height);
  const page = doc.addPage([width, height]);
  const name = page.node.newXObject("Image", image.ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...matrix),
    drawObject(name),
    popGraphicsState()
  );

  return doc.save();
}

// Convert an image File into a single-page PDF, entirely client-side.
// What the bytes are decides the route, not the file name: PNG and JPEG go
// straight to pdf-lib, and anything else the browser can decode (GIF,
// WebP, BMP, ...) is drawn onto a canvas and re-encoded as PNG first.
export async function convertToPdfBytes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (type) return imageBytesToPdfBytes(bytes, type);

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return imageBytesToPdfBytes(new Uint8Array(await blob.arrayBuffer()), "png");
}

// Throws if pdf-lib cannot load `bytes`, which means none of the functions
// below can modify it. The common case is a PDF encrypted with only an
// owner password: pdf.js opens and previews it without asking for
// anything, and pdf-lib refuses it outright. Call this when a file is
// added, so it is turned away before the user arranges it, rather than
// when Export runs.
export async function assertEditable(bytes) {
  await PDFDocument.load(bytes);
}

// Splice a set of PDFs into a master PDF at given gap indices.
// gapIndex N means "insert after original page N" (0 = before the first page).
// inserts: { [gapIndex]: Array<Uint8Array | { bytes, excludedPages }> } — each
// gap can hold multiple files, spliced in in the order they appear in the
// array. Each queued item may either be raw bytes (whole file, nothing
// excluded) or an object carrying its own 1-indexed excludedPages Set, so a
// user can drop specific pages out of an inserted file before it's spliced
// in. excludedMasterPages is a Set of 1-indexed page numbers to skip from the
// *master* document itself.
export async function spliceIntoMasterPdf(masterBytes, inserts, excludedMasterPages = new Set()) {
  const master = await PDFDocument.load(masterBytes);
  const output = await PDFDocument.create();

  const originalPageCount = master.getPageCount();

  // Gap 0 (before first page)
  await copyInsertsIfPresent(output, inserts, 0);

  for (let i = 0; i < originalPageCount; i++) {
    if (!excludedMasterPages.has(i + 1)) {
      const [copiedPage] = await output.copyPages(master, [i]);
      output.addPage(copiedPage);
    }
    await copyInsertsIfPresent(output, inserts, i + 1);
  }

  return output.save();
}

async function copyInsertsIfPresent(output, inserts, gapIndex) {
  const items = inserts[gapIndex];
  if (!items || items.length === 0) return;
  for (const item of items) {
    const bytes = item instanceof Uint8Array ? item : item.bytes;
    const excludedPages = item instanceof Uint8Array ? new Set() : item.excludedPages || new Set();
    const insertDoc = await PDFDocument.load(bytes);
    const indices = insertDoc.getPageIndices().filter((idx) => !excludedPages.has(idx + 1));
    const pages = await output.copyPages(insertDoc, indices);
    pages.forEach((p) => output.addPage(p));
  }
}

// --- Split ---
// ranges: array of { start, end } (1-indexed, inclusive) — one output PDF per range.
// excludedPages: optional Set of 1-indexed page numbers to drop from the
// master before splitting — a page marked excluded is skipped wherever its
// range falls. If excluding pages empties out an entire range, that range is
// dropped from the output entirely (there's nothing left to split for it).
// Returns an array of { name, bytes }.
export async function splitPdf(masterBytes, ranges, excludedPages = new Set()) {
  const master = await PDFDocument.load(masterBytes);
  const outputs = [];

  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    const indices = [];
    for (let p = start; p <= end; p++) {
      if (!excludedPages.has(p)) indices.push(p - 1);
    }
    if (indices.length === 0) continue;

    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(master, indices);
    pages.forEach((p) => doc.addPage(p));
    const bytes = await doc.save();
    outputs.push({ name: `split-${start}-${end}.pdf`, bytes });
  }

  return outputs;
}

// Split into individual single-page PDFs, one per page.
export async function splitPdfEveryPage(masterBytes) {
  const master = await PDFDocument.load(masterBytes);
  const count = master.getPageCount();
  const ranges = [];
  for (let i = 1; i <= count; i++) ranges.push({ start: i, end: i });
  return splitPdf(masterBytes, ranges);
}

// --- Merge ---
// files: array of entries, in desired order. Each entry is either raw
// Uint8Array bytes (the whole file, nothing excluded) or an object
// { bytes, excludedPages } where excludedPages is a Set of 1-indexed page
// numbers to leave out of that file's contribution to the merged output.
export async function mergePdfs(files) {
  const output = await PDFDocument.create();
  for (const entry of files) {
    const bytes = entry instanceof Uint8Array ? entry : entry.bytes;
    const excludedPages = entry instanceof Uint8Array ? new Set() : entry.excludedPages || new Set();
    const doc = await PDFDocument.load(bytes);
    const indices = doc.getPageIndices().filter((idx) => !excludedPages.has(idx + 1));
    const pages = await output.copyPages(doc, indices);
    pages.forEach((p) => output.addPage(p));
  }
  return output.save();
}

