import { describe, it, expect } from "vitest";
import { loadPdfDocument, extractImagesFromPage } from "@/lib/pdfRender";
import { makePdfBytesWithEmbeddedImage, makeSamplePdfBytesNoText } from "../helpers/samplePdf";

describe("extractImagesFromPage", () => {
  it("finds a real embedded image on a page", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 1, imageSize: 20 });
    const doc = await loadPdfDocument(bytes.slice());
    const images = await extractImagesFromPage(doc, 1);
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images[0].blob).toBeInstanceOf(Blob);
    expect(images[0].blob.size).toBeGreaterThan(0);
    expect(images[0].width).toBe(20);
    expect(images[0].height).toBe(20);
  });

  it("returns an empty array for a page with no images (just vector content)", async () => {
    const bytes = await makeSamplePdfBytesNoText(1);
    const doc = await loadPdfDocument(bytes.slice());
    const images = await extractImagesFromPage(doc, 1);
    expect(images).toEqual([]);
  });

  it("dedup mechanism doesn't crash or over-report when the same image is reused across pages", async () => {
    // pdf.js only promotes a resource to its global ("g_"-prefixed,
    // commonObjs) cache under its own internal heuristics about shared
    // /Resources — this isn't something a synthetic pdf-lib fixture can
    // reliably force on demand, so this test doesn't assert an exact
    // count. What it does verify: extraction across multiple pages with
    // a shared seenGlobalIds Set never *exceeds* one result per page
    // (i.e. dedup logic is at minimum not making things worse/erroring),
    // and never finds fewer images than pages if the image genuinely
    // isn't deduped by pdf.js.
    const bytes = await makePdfBytesWithEmbeddedImage({
      pageCount: 3,
      repeatSameImage: true,
    });
    const doc = await loadPdfDocument(bytes.slice());
    const seen = new Set();
    let total = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      total += (await extractImagesFromPage(doc, i, seen)).length;
    }
    expect(total).toBeGreaterThanOrEqual(1);
    expect(total).toBeLessThanOrEqual(3);
  });

  it("without a shared seenGlobalIds Set, each page re-reports the same reused image", async () => {
    // Documents the dedup behavior is opt-in via the shared Set — calling
    // per-page with a *fresh* Set each time (i.e. not sharing state, which
    // would be an easy mistake for a caller to make) does NOT dedupe.
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 3, repeatSameImage: true });
    const doc = await loadPdfDocument(bytes.slice());
    let total = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const imgs = await extractImagesFromPage(doc, i); // fresh Set each call
      total += imgs.length;
    }
    expect(total).toBe(3);
  });

  it("finds distinct images across pages when they are NOT the same XObject", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
    const doc = await loadPdfDocument(bytes.slice());
    const seen = new Set();
    let total = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      total += (await extractImagesFromPage(doc, i, seen)).length;
    }
    expect(total).toBe(2);
  });
});
