import { describe, it, expect, beforeEach } from "vitest";
import { usePageViewer } from "@/lib/pageViewer";

// A stand-in for a pdf.js PDFDocumentProxy: a class using native private
// fields, exactly the shape that breaks when deep-wrapped by Vue's
// reactive()/ref(). See pageViewer.js's comment for the full story.
class FakeDoc {
  #secret = "private-field-value";
  numPages = 3;
  readSecret() {
    // Throws if `this` is a Proxy instead of the real instance —
    // mirroring pdf.js's actual failure mode.
    return this.#secret;
  }
}

describe("usePageViewer", () => {
  beforeEach(() => {
    // Each test gets a clean composable call, but the underlying store is
    // a module-level singleton (by design — see pageViewer.js), so
    // explicitly close any viewer left open by a previous test.
    const { closeViewer } = usePageViewer();
    closeViewer();
  });

  it("openPdfViewer stores the pdf.js document WITHOUT wrapping it in a reactive Proxy", () => {
    const { openPdfViewer, viewerState } = usePageViewer();
    const doc = new FakeDoc();
    openPdfViewer(doc, 1, 3);

    expect(viewerState.viewer.pdfDoc).toBe(doc); // strict reference equality
    // The real regression check: calling a method that touches a native
    // private field must not throw "Cannot read private member ... from
    // an object whose class did not declare it".
    expect(() => viewerState.viewer.pdfDoc.readSecret()).not.toThrow();
    expect(viewerState.viewer.pdfDoc.readSecret()).toBe("private-field-value");
  });

  it("openPdfViewer does nothing if given a falsy document", () => {
    const { openPdfViewer, viewerState } = usePageViewer();
    openPdfViewer(null, 1, 3);
    expect(viewerState.viewer).toBeNull();
  });

  it("goToPdfPage updates the page number while preserving the same raw pdfDoc reference", () => {
    const { openPdfViewer, goToPdfPage, viewerState } = usePageViewer();
    const doc = new FakeDoc();
    openPdfViewer(doc, 1, 3);
    goToPdfPage(2);
    expect(viewerState.viewer.pageNumber).toBe(2);
    expect(viewerState.viewer.pdfDoc).toBe(doc);
    expect(() => viewerState.viewer.pdfDoc.readSecret()).not.toThrow();
  });

  it("goToPdfPage is a no-op when no pdf viewer is open", () => {
    const { goToPdfPage, viewerState } = usePageViewer();
    goToPdfPage(5);
    expect(viewerState.viewer).toBeNull();
  });

  it("openImageViewer stores the image list and index", () => {
    const { openImageViewer, viewerState } = usePageViewer();
    const images = [{ url: "a" }, { url: "b" }];
    openImageViewer(images, 1);
    expect(viewerState.viewer.mode).toBe("image");
    expect(viewerState.viewer.images).toBe(images);
    expect(viewerState.viewer.index).toBe(1);
  });

  it("openImageViewer does nothing for an empty array", () => {
    const { openImageViewer, viewerState } = usePageViewer();
    openImageViewer([], 0);
    expect(viewerState.viewer).toBeNull();
  });

  it("goToImageIndex updates the index without touching pdf state", () => {
    const { openImageViewer, goToImageIndex, viewerState } = usePageViewer();
    openImageViewer([{ url: "a" }, { url: "b" }], 0);
    goToImageIndex(1);
    expect(viewerState.viewer.index).toBe(1);
  });

  it("closeViewer clears the viewer", () => {
    const { openImageViewer, closeViewer, viewerState } = usePageViewer();
    openImageViewer([{ url: "a" }], 0);
    closeViewer();
    expect(viewerState.viewer).toBeNull();
  });

  it("switching from pdf mode to image mode fully replaces the viewer object (no stale fields)", () => {
    const { openPdfViewer, openImageViewer, viewerState } = usePageViewer();
    openPdfViewer(new FakeDoc(), 1, 3);
    openImageViewer([{ url: "a" }], 0);
    expect(viewerState.viewer.mode).toBe("image");
    expect(viewerState.viewer.pdfDoc).toBeUndefined();
  });
});
