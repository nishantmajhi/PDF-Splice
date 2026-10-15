import { describe, it, expect, vi, beforeAll } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PageThumbnail from "@/components/PageThumbnail.vue";
import { loadPdfDocument } from "@/lib/pdfRender";
import { makeSamplePdfBytesNoText } from "../helpers/samplePdf";
import { warmPdfjs } from "../helpers/renderPdf";

beforeAll(warmPdfjs, 30000);

async function loadDoc(pageCount = 1) {
  const bytes = await makeSamplePdfBytesNoText(pageCount);
  return loadPdfDocument(bytes.slice());
}

describe("PageThumbnail.vue", () => {
  it("actually renders the page (regression test for the onMounted timing fix)", async () => {
    const doc = await loadDoc(1);
    const wrapper = mount(PageThumbnail, {
      props: { pdfDoc: doc, pageNumber: 1, displayNumber: 1 },
    });

    // Give pdf.js's async render pipeline a chance to finish.
    await vi.waitFor(() => {
      expect(wrapper.find("canvas").attributes("style")).not.toContain("display: none");
    }, { timeout: 5000 });

    const canvas = wrapper.find("canvas").element;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    // Skeleton loading placeholder should be gone once loaded.
    expect(wrapper.find(".skeleton").exists()).toBe(false);
  });

  it("shows the skeleton placeholder before the render resolves", async () => {
    const doc = await loadDoc(1);
    const wrapper = mount(PageThumbnail, {
      props: { pdfDoc: doc, pageNumber: 1, displayNumber: 1 },
    });
    // Immediately after mount, before the async render settles.
    expect(wrapper.find(".skeleton").exists()).toBe(true);
  });

  it("displays the given displayNumber, zero-padded", async () => {
    const doc = await loadDoc(1);
    const wrapper = mount(PageThumbnail, {
      props: { pdfDoc: doc, pageNumber: 1, displayNumber: 7 },
    });
    expect(wrapper.find(".page-num").text()).toBe("07");
  });

  it("supports a non-numeric displayNumber (e.g. a page range string like '3–5')", async () => {
    const doc = await loadDoc(1);
    const wrapper = mount(PageThumbnail, {
      props: { pdfDoc: doc, pageNumber: 1, displayNumber: "3\u20135" },
    });
    expect(wrapper.find(".page-num").text()).toBe("3\u20135");
  });

  it("re-renders when pageNumber changes (e.g. after a reorder)", async () => {
    const doc = await loadDoc(3);
    const wrapper = mount(PageThumbnail, {
      props: { pdfDoc: doc, pageNumber: 1, displayNumber: 1 },
    });
    await vi.waitFor(() => expect(wrapper.find(".skeleton").exists()).toBe(false));

    await wrapper.setProps({ pageNumber: 2 });
    // Switching pages should go back to a loading state and eventually
    // resolve again — if the watcher didn't fire, it would just keep
    // showing page 1's already-rendered canvas.
    await vi.waitFor(() => expect(wrapper.find(".skeleton").exists()).toBe(false));
    expect(wrapper.props("pageNumber")).toBe(2);
  });

  it("calls the custom onOpen handler instead of opening the default viewer, when provided", async () => {
    const doc = await loadDoc(1);
    const onOpen = vi.fn();
    const wrapper = mount(PageThumbnail, {
      props: { pdfDoc: doc, pageNumber: 1, displayNumber: 1, onOpen },
    });
    await wrapper.find(".page-card").trigger("click");
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("cancels the in-flight render task on unmount without throwing", async () => {
    const doc = await loadDoc(1);
    const wrapper = mount(PageThumbnail, {
      props: { pdfDoc: doc, pageNumber: 1, displayNumber: 1 },
    });
    expect(() => wrapper.unmount()).not.toThrow();
    await nextTick();
  });
});
