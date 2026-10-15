import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { mount } from "@vue/test-utils";
import PageViewerModal from "@/components/PageViewerModal.vue";
import { loadPdfDocument } from "@/lib/pdfRender";
import { makeSamplePdfBytesNoText } from "../helpers/samplePdf";
import { warmPdfjs } from "../helpers/renderPdf";

beforeAll(warmPdfjs, 30000);

async function loadDoc(pageCount = 3) {
  const bytes = await makeSamplePdfBytesNoText(pageCount);
  return loadPdfDocument(bytes.slice());
}

let currentWrapper = null;
afterEach(() => {
  // Component registers a window-level keydown listener; always unmount
  // so it doesn't leak into (and break) the next test.
  currentWrapper?.unmount();
  currentWrapper = null;
});

describe("PageViewerModal.vue — pdf mode", () => {
  it("renders the current page and shows 'current of total'", async () => {
    const doc = await loadDoc(5);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 2, pageCount: 5 } },
    });
    expect(currentWrapper.find(".page-viewer-count").text()).toBe("2 of 5");
  });

  it("disables Previous on the first page and Next on the last page", async () => {
    const doc = await loadDoc(3);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 1, pageCount: 3 } },
    });
    expect(currentWrapper.find('[aria-label="Previous"]').attributes("disabled")).toBeDefined();
    expect(currentWrapper.find('[aria-label="Next"]').attributes("disabled")).toBeUndefined();

    await currentWrapper.setProps({ viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 3, pageCount: 3 } });
    expect(currentWrapper.find('[aria-label="Next"]').attributes("disabled")).toBeDefined();
  });

  it("clicking Next emits navigate-pdf with pageNumber + 1", async () => {
    const doc = await loadDoc(5);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 2, pageCount: 5 } },
    });
    await currentWrapper.find('[aria-label="Next"]').trigger("click");
    expect(currentWrapper.emitted("navigate-pdf")[0]).toEqual([3]);
  });

  it("clicking Previous emits navigate-pdf with pageNumber - 1", async () => {
    const doc = await loadDoc(5);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 2, pageCount: 5 } },
    });
    await currentWrapper.find('[aria-label="Previous"]').trigger("click");
    expect(currentWrapper.emitted("navigate-pdf")[0]).toEqual([1]);
  });

  it("ArrowRight/ArrowLeft keyboard shortcuts navigate, Escape closes", async () => {
    const doc = await loadDoc(5);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 2, pageCount: 5 } },
    });
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(currentWrapper.emitted("navigate-pdf")[0]).toEqual([3]);

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(currentWrapper.emitted("navigate-pdf")[1]).toEqual([1]);

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(currentWrapper.emitted("close")).toBeTruthy();
  });

  it("keyboard ArrowRight does nothing at the last page (respects the boundary, doesn't emit past the end)", async () => {
    const doc = await loadDoc(3);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 3, pageCount: 3 } },
    });
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(currentWrapper.emitted("navigate-pdf")).toBeFalsy();
  });

  it("removes its window keydown listener on unmount (no leak to the next mounted instance)", async () => {
    const doc = await loadDoc(3);
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const w = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 1, pageCount: 3 } },
    });
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    w.unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("clicking the close (×) button emits close", async () => {
    const doc = await loadDoc(3);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 1, pageCount: 3 } },
    });
    await currentWrapper.find(".modal-close").trigger("click");
    expect(currentWrapper.emitted("close")).toBeTruthy();
  });

  it("clicking the overlay (outside the card) emits close; clicking the card itself does not", async () => {
    const doc = await loadDoc(3);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 1, pageCount: 3 } },
    });
    await currentWrapper.find(".page-viewer-card").trigger("click");
    expect(currentWrapper.emitted("close")).toBeFalsy();
    await currentWrapper.find(".modal-overlay").trigger("click");
    expect(currentWrapper.emitted("close")).toBeTruthy();
  });

  it("actually renders the page onto the canvas (regression test for the onMounted timing fix)", async () => {
    const doc = await loadDoc(1);
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "pdf", pdfDoc: doc, pageNumber: 1, pageCount: 1 } },
    });
    await vi.waitFor(() => {
      expect(currentWrapper.find(".spinner").exists()).toBe(false);
    });
    const canvas = currentWrapper.find("canvas").element;
    expect(canvas.width).toBeGreaterThan(0);
  });
});

describe("PageViewerModal.vue — image mode", () => {
  it("renders the current image and count", async () => {
    const images = [{ url: "blob:a", label: "img-1" }, { url: "blob:b", label: "img-2" }];
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "image", images, index: 0 } },
    });
    expect(currentWrapper.find(".page-viewer-count").text()).toBe("1 of 2");
    expect(currentWrapper.find("img").attributes("src")).toBe("blob:a");
    expect(currentWrapper.find("img").attributes("alt")).toBe("img-1");
  });

  it("falls back to 'Image N' alt text when no label is provided", async () => {
    const images = [{ url: "blob:a" }];
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "image", images, index: 0 } },
    });
    expect(currentWrapper.find("img").attributes("alt")).toBe("Image 1");
  });

  it("clicking Next emits navigate-image with index + 1", async () => {
    const images = [{ url: "a" }, { url: "b" }, { url: "c" }];
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "image", images, index: 0 } },
    });
    await currentWrapper.find('[aria-label="Next"]').trigger("click");
    expect(currentWrapper.emitted("navigate-image")[0]).toEqual([1]);
  });

  it("disables Previous at index 0 and Next at the last index", async () => {
    const images = [{ url: "a" }, { url: "b" }];
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "image", images, index: 1 } },
    });
    expect(currentWrapper.find('[aria-label="Next"]').attributes("disabled")).toBeDefined();
    expect(currentWrapper.find('[aria-label="Previous"]').attributes("disabled")).toBeUndefined();
  });

  it("does not render a <canvas> at all in image mode", async () => {
    const images = [{ url: "a" }];
    currentWrapper = mount(PageViewerModal, {
      props: { viewer: { mode: "image", images, index: 0 } },
    });
    expect(currentWrapper.find("canvas").exists()).toBe(false);
  });
});
