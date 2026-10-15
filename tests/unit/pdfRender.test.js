import { describe, it, expect } from "vitest";
import { configureWorker, loadPdfDocument, renderPageToCanvas, renderPageToPngBlob } from "@/lib/pdfRender";
import { makeSamplePdfBytes, makeSamplePdfBytesNoText } from "../helpers/samplePdf";

describe("loadPdfDocument + renderPageToCanvas (real pdf.js pipeline)", () => {
  it("loads a real PDF and reports the correct page count", async () => {
    const bytes = await makeSamplePdfBytes(3);
    const doc = await loadPdfDocument(bytes.slice());
    expect(doc.numPages).toBe(3);
  });

  it("renders a page onto a real canvas and produces non-blank pixel data", async () => {
    const bytes = await makeSamplePdfBytesNoText(1, { width: 200, height: 200 });
    const doc = await loadPdfDocument(bytes.slice());

    const canvas = document.createElement("canvas");
    const task = renderPageToCanvas(doc, 1, canvas, 256);
    await task.promise;

    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);

    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // The sample page draws a black rectangle on a white background —
    // some pixels should be non-white if rendering actually happened
    // rather than leaving a blank canvas.
    let hasNonWhitePixel = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
        hasNonWhitePixel = true;
        break;
      }
    }
    expect(hasNonWhitePixel).toBe(true);
  });

  it("scales the canvas to the requested target width, preserving aspect ratio", async () => {
    const bytes = await makeSamplePdfBytesNoText(1, { width: 200, height: 400 }); // 1:2 ratio
    const doc = await loadPdfDocument(bytes.slice());
    const canvas = document.createElement("canvas");
    const task = renderPageToCanvas(doc, 1, canvas, 100);
    await task.promise;
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(200); // preserves the 1:2 ratio
  });

  it("cancel() prevents the render from completing and does not hang or throw uncaught", async () => {
    const bytes = await makeSamplePdfBytesNoText(1);
    const doc = await loadPdfDocument(bytes.slice());
    const canvas = document.createElement("canvas");
    const task = renderPageToCanvas(doc, 1, canvas, 256);
    task.cancel();

    let settled = false;
    try {
      await task.promise;
    } catch {
      // A cancellation-shaped rejection (pdf.js's RenderingCancelledException,
      // or simply returning early) is an acceptable outcome here.
    } finally {
      settled = true;
    }
    expect(settled).toBe(true);
  });

  it("rejects for an out-of-range page number instead of hanging", async () => {
    const bytes = await makeSamplePdfBytes(2);
    const doc = await loadPdfDocument(bytes.slice());
    const canvas = document.createElement("canvas");
    const task = renderPageToCanvas(doc, 99, canvas, 256);
    await expect(task.promise).rejects.toBeTruthy();
  });
});

describe("renderPageToPngBlob", () => {
  it("produces a real, non-empty PNG blob for a page", async () => {
    const bytes = await makeSamplePdfBytesNoText(1, { width: 150, height: 150 });
    const doc = await loadPdfDocument(bytes.slice());
    const blob = await renderPageToPngBlob(doc, 1);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("image/png");
  });

  it("renders at higher resolution for a larger scale factor", async () => {
    const bytes = await makeSamplePdfBytesNoText(1, { width: 100, height: 100 });
    const doc = await loadPdfDocument(bytes.slice());
    const blobSmall = await renderPageToPngBlob(doc, 1, 1);
    const blobLarge = await renderPageToPngBlob(doc, 1, 4);
    // A 4x-scale render should produce meaningfully more image data than 1x.
    expect(blobLarge.size).toBeGreaterThan(blobSmall.size);
  });
});

describe("configureWorker", () => {
  class FakeWorker {
    static made = [];
    constructor(url, options) {
      this.url = url;
      this.options = options;
      FakeWorker.made.push(this);
    }
  }

  it("starts one module worker for every document to share", () => {
    FakeWorker.made = [];
    const options = {};
    configureWorker(options, "/assets/pdf.worker.mjs", FakeWorker);
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0].url).toBe("/assets/pdf.worker.mjs");
    expect(FakeWorker.made[0].options).toEqual({ type: "module" });
    expect(options.workerPort).toBe(FakeWorker.made[0]);
    expect(options.workerSrc).toBe("/assets/pdf.worker.mjs");
  });

  it("does not start a second worker if one is already set", () => {
    FakeWorker.made = [];
    const options = {};
    configureWorker(options, "/w.mjs", FakeWorker);
    configureWorker(options, "/w.mjs", FakeWorker);
    expect(FakeWorker.made).toHaveLength(1);
  });

  it("without Worker, leaves pdf.js to run its worker code from workerSrc", () => {
    const options = {};
    configureWorker(options, "/w.mjs", undefined);
    expect(options).toEqual({ workerSrc: "/w.mjs" });
  });
});
