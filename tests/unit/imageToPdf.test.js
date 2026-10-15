import { describe, it, expect, vi, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { convertToPdfBytes } from "@/lib/pdfOps";
import { toFakeFile } from "../helpers/samplePdf";
import { orientedJpeg, nearestQuadrant } from "../helpers/exifJpeg";
import { renderFirstPage } from "../helpers/renderPdf";

// Real image bytes from node-canvas, re-wrapped in this realm's Uint8Array
// (see makePdfBytesWithEmbeddedImage in helpers/samplePdf.js for why).
async function imageBytes(type, width, height) {
  const { createCanvas } = await import("canvas");
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c00";
  ctx.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer(type));
}

async function pageSize(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes);
  expect(doc.getPageCount()).toBe(1);
  const { width, height } = doc.getPage(0).getSize();
  return [Math.round(width), Math.round(height)];
}

// jsdom has no createImageBitmap. For the formats pdf-lib cannot embed,
// the app decodes through it and re-encodes on a canvas; stand in for the
// browser's decoder with a real jsdom canvas of the given size.
function stubDecoder(width, height) {
  const fn = vi.fn(async () => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d").fillRect(0, 0, width, height);
    return c;
  });
  globalThis.createImageBitmap = fn;
  return fn;
}

afterEach(() => {
  delete globalThis.createImageBitmap;
});

// What a viewer shows for each EXIF orientation of the stored image
//   R G
//   B Y
// read from the tag's definition ("row 0 is the visual top/right/..., column
// 0 is the visual left/top/..."), as [top-left, top-right, bottom-left,
// bottom-right]. Deliberately written out rather than computed, so it is
// not the same arithmetic as the code under test.
const DISPLAYED = {
  1: ["R", "G", "B", "Y"], // row 0 top,    column 0 left
  2: ["G", "R", "Y", "B"], // row 0 top,    column 0 right
  3: ["Y", "B", "G", "R"], // row 0 bottom, column 0 right
  4: ["B", "Y", "R", "G"], // row 0 bottom, column 0 left
  5: ["R", "B", "G", "Y"], // row 0 left,   column 0 top
  6: ["B", "R", "Y", "G"], // row 0 right,  column 0 top
  7: ["Y", "G", "B", "R"], // row 0 right,  column 0 bottom
  8: ["G", "Y", "R", "B"], // row 0 left,   column 0 bottom
};

// Renders page 1 with the app's own pdf.js pipeline and reads the colour
// at the centre of each quadrant.
async function renderedQuadrants(pdfBytes) {
  const canvas = await renderFirstPage(pdfBytes, 80);
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  return [
    [w / 4, h / 4],
    [(3 * w) / 4, h / 4],
    [w / 4, (3 * h) / 4],
    [(3 * w) / 4, (3 * h) / 4],
  ].map(([x, y]) => nearestQuadrant(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data));
}

describe("convertToPdfBytes — a photo's EXIF orientation", () => {
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const name = o === 1 ? "orientation 1 (upright) is drawn as stored" : `regression: orientation ${o} is drawn the way a viewer shows it`;
    it(name, async () => {
      const file = toFakeFile(await orientedJpeg(o), `IMG_${o}.jpg`, "image/jpeg");
      const pdf = await convertToPdfBytes(file);
      // Stored 40x20; orientations 5-8 turn it a quarter, so the page is 20x40.
      expect(await pageSize(pdf)).toEqual(o >= 5 ? [20, 40] : [40, 20]);
      expect(await renderedQuadrants(pdf)).toEqual(DISPLAYED[o]);
    });
  }

  it("regression: a little-endian EXIF block after the JFIF header is honoured too", async () => {
    const file = toFakeFile(await orientedJpeg(6, { littleEndian: true, afterApp0: true }), "p.jpg");
    const pdf = await convertToPdfBytes(file);
    expect(await pageSize(pdf)).toEqual([20, 40]);
    expect(await renderedQuadrants(pdf)).toEqual(DISPLAYED[6]);
  });

  it("the JPEG is embedded as it is, not re-encoded", async () => {
    const jpeg = await orientedJpeg(6);
    const pdf = await convertToPdfBytes(toFakeFile(jpeg, "p.jpg"));
    const scan = Buffer.from(pdf).indexOf(Buffer.from(jpeg.subarray(0, 64)));
    expect(scan).toBeGreaterThan(0);
  });
});

describe("convertToPdfBytes — choosing how to embed an image", () => {
  it("embeds a PNG as a page the size of the image", async () => {
    const file = toFakeFile(await imageBytes("image/png", 40, 30), "shot.png", "image/png");
    expect(await pageSize(await convertToPdfBytes(file))).toEqual([40, 30]);
  });

  it("embeds a JPEG as a page the size of the image", async () => {
    const file = toFakeFile(await imageBytes("image/jpeg", 40, 30), "photo.jpg", "image/jpeg");
    expect(await pageSize(await convertToPdfBytes(file))).toEqual([40, 30]);
  });

  it("accepts an upper-case .JPEG extension", async () => {
    const file = toFakeFile(await imageBytes("image/jpeg", 12, 8), "IMG_0001.JPEG", "image/jpeg");
    expect(await pageSize(await convertToPdfBytes(file))).toEqual([12, 8]);
  });

  it("regression: a PNG saved with a .jpg name is embedded as the PNG it is", async () => {
    const file = toFakeFile(await imageBytes("image/png", 40, 30), "download.jpg", "image/jpeg");
    expect(await pageSize(await convertToPdfBytes(file))).toEqual([40, 30]);
  });

  it("regression: a JPEG saved with a .png name is embedded as the JPEG it is", async () => {
    const file = toFakeFile(await imageBytes("image/jpeg", 40, 30), "scan.png", "image/png");
    expect(await pageSize(await convertToPdfBytes(file))).toEqual([40, 30]);
  });

  it("regression: a WebP saved with a .jpg name goes through the browser's decoder", async () => {
    // RIFF....WEBP: what browsers often save under a .jpg name.
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const decode = stubDecoder(25, 15);
    const file = toFakeFile(webp, "image.jpg", "image/jpeg");
    expect(await pageSize(await convertToPdfBytes(file))).toEqual([25, 15]);
    expect(decode).toHaveBeenCalledOnce();
  });

  it("decodes a GIF through the browser and embeds the re-encoded PNG", async () => {
    const decode = stubDecoder(30, 10);
    const file = toFakeFile(new TextEncoder().encode("GIF89a..."), "anim.gif", "image/gif");
    expect(await pageSize(await convertToPdfBytes(file))).toEqual([30, 10]);
    expect(decode).toHaveBeenCalledOnce();
  });

  it("does not call the browser decoder for a PNG or a JPEG", async () => {
    const decode = stubDecoder(1, 1);
    await convertToPdfBytes(toFakeFile(await imageBytes("image/png", 5, 5), "a.png"));
    await convertToPdfBytes(toFakeFile(await imageBytes("image/jpeg", 5, 5), "b.jpg"));
    expect(decode).not.toHaveBeenCalled();
  });
});
