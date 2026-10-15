import { describe, it, expect, vi, beforeAll } from "vitest";
import { mount } from "@vue/test-utils";
import MergeFileCard from "@/components/MergeFileCard.vue";
import { loadPdfDocument } from "@/lib/pdfRender";
import { makeSamplePdfBytesNoText } from "../helpers/samplePdf";
import { warmPdfjs } from "../helpers/renderPdf";

beforeAll(warmPdfjs, 30000);

async function makeFile(name = "doc.pdf", pageCount = 2) {
  const bytes = await makeSamplePdfBytesNoText(pageCount);
  const pdfDoc = await loadPdfDocument(bytes.slice());
  return { name, bytes, pageCount, pdfDoc };
}

describe("MergeFileCard.vue", () => {
  it("renders the thumbnail (regression test for the onMounted timing fix)", async () => {
    const file = await makeFile();
    const wrapper = mount(MergeFileCard, { props: { file, index: 0, isDragging: false } });
    await vi.waitFor(() => expect(wrapper.find(".skeleton").exists()).toBe(false), { timeout: 5000 });
    const canvas = wrapper.find("canvas").element;
    expect(canvas.width).toBeGreaterThan(0);
  });

  it("shows the file name and page count", async () => {
    const file = await makeFile("Report.pdf", 4);
    const wrapper = mount(MergeFileCard, { props: { file, index: 0, isDragging: false } });
    expect(wrapper.find(".merge-card-name").text()).toBe("Report.pdf");
    expect(wrapper.find(".merge-card-meta").text()).toBe("4 pages");
  });

  it("singular 'page' for a 1-page file", async () => {
    const file = await makeFile("One.pdf", 1);
    const wrapper = mount(MergeFileCard, { props: { file, index: 0, isDragging: false } });
    expect(wrapper.find(".merge-card-meta").text()).toBe("1 page");
  });

  it("emits preview with the file's data when the card is clicked", async () => {
    const file = await makeFile();
    const wrapper = mount(MergeFileCard, { props: { file, index: 0, isDragging: false } });
    await wrapper.find(".merge-card").trigger("click");
    expect(wrapper.emitted("preview")).toBeTruthy();
    // Not toBe(): Vue/test-utils' props handling doesn't guarantee the
    // emitted value is the exact same object reference (it may be a
    // reactive-wrapped view of it) — the app only cares that the right
    // data comes through, which InsertPreviewModal reads by field.
    expect(wrapper.emitted("preview")[0][0]).toEqual(file);
  });

  it("emits remove with the index (not the file) when the bin button is clicked", async () => {
    const file = await makeFile();
    const wrapper = mount(MergeFileCard, { props: { file, index: 3, isDragging: false } });
    await wrapper.find(".icon-btn").trigger("click");
    expect(wrapper.emitted("remove")).toBeTruthy();
    expect(wrapper.emitted("remove")[0]).toEqual([3]);
  });

  it("clicking remove does NOT also trigger a preview emit (click.stop works)", async () => {
    const file = await makeFile();
    const wrapper = mount(MergeFileCard, { props: { file, index: 0, isDragging: false } });
    await wrapper.find(".icon-btn").trigger("click");
    expect(wrapper.emitted("preview")).toBeFalsy();
  });

  it("displays the 1-indexed position, zero-padded", async () => {
    const file = await makeFile();
    const wrapper = mount(MergeFileCard, { props: { file, index: 8, isDragging: false } });
    expect(wrapper.find(".page-num").text()).toBe("09");
  });

  it("applies the dragging class when isDragging is true", async () => {
    const file = await makeFile();
    const wrapper = mount(MergeFileCard, { props: { file, index: 0, isDragging: true } });
    expect(wrapper.find(".merge-card").classes()).toContain("dragging");
  });
});
