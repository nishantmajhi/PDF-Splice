import { describe, it, expect, vi, beforeAll } from "vitest";
import { mount } from "@vue/test-utils";
import InsertPreviewModal from "@/components/InsertPreviewModal.vue";
import { loadPdfDocument } from "@/lib/pdfRender";
import { makeSamplePdfBytesNoText } from "../helpers/samplePdf";
import { warmPdfjs } from "../helpers/renderPdf";

beforeAll(warmPdfjs, 30000);

async function makeFile(name = "doc.pdf", pageCount = 3) {
  const bytes = await makeSamplePdfBytesNoText(pageCount);
  const pdfDoc = await loadPdfDocument(bytes.slice());
  return { name, pdfDoc, pageCount };
}

describe("InsertPreviewModal.vue", () => {
  it("shows the file name and page count", async () => {
    const file = await makeFile("Report.pdf", 4);
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    expect(wrapper.find("h3").text()).toBe("Report.pdf");
    expect(wrapper.find(".modal-preview-header p").text()).toBe("4 pages");
  });

  it("singular 'page' for a 1-page file", async () => {
    const file = await makeFile("One.pdf", 1);
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    expect(wrapper.find(".modal-preview-header p").text()).toBe("1 page");
  });

  it("renders one PageThumbnail per page of the file, in order", async () => {
    const file = await makeFile("doc.pdf", 3);
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    await vi.waitFor(() => {
      expect(wrapper.findAll(".skeleton").length).toBe(0);
    });
    const pageNums = wrapper.findAll(".page-num").map((el) => el.text());
    expect(pageNums).toEqual(["01", "02", "03"]);
  });

  it("clicking the close button emits close", async () => {
    const file = await makeFile();
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    await wrapper.find(".modal-close").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("clicking the overlay emits close; clicking inside the card does not", async () => {
    const file = await makeFile();
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    await wrapper.find(".modal-card").trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
    await wrapper.find(".modal-overlay").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("handles a 0-page file gracefully (no thumbnails, no crash)", async () => {
    const file = { name: "empty.pdf", pageCount: 0, pdfDoc: null };
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    expect(wrapper.findAll(".page-card").length).toBe(0);
    expect(wrapper.find(".modal-preview-header p").text()).toBe("0 pages");
  });

  it("renders a bin badge on every page, unmarked by default", async () => {
    const file = await makeFile("doc.pdf", 3);
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    expect(wrapper.findAll(".remove-badge-btn")).toHaveLength(3);
    expect(wrapper.findAll(".remove-slot.marked")).toHaveLength(0);
  });

  it("marks a page as excluded per the excludedPages prop, and shows its tag", async () => {
    const file = await makeFile("doc.pdf", 3);
    const wrapper = mount(InsertPreviewModal, { props: { file, excludedPages: new Set([2]) } });
    const slots = wrapper.findAll(".remove-slot");
    expect(slots[0].classes()).not.toContain("marked");
    expect(slots[1].classes()).toContain("marked");
    expect(slots[2].classes()).not.toContain("marked");
    expect(wrapper.findAll(".remove-tag")).toHaveLength(1);
  });

  it("emits 'toggle-exclude' with the 1-indexed page number when a bin icon is clicked", async () => {
    const file = await makeFile("doc.pdf", 3);
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    await wrapper.findAll(".remove-badge-btn")[1].trigger("click");
    expect(wrapper.emitted("toggle-exclude")).toEqual([[2]]);
  });

  it("clicking a bin icon does not also close the modal", async () => {
    const file = await makeFile("doc.pdf", 3);
    const wrapper = mount(InsertPreviewModal, { props: { file } });
    await wrapper.findAll(".remove-badge-btn")[0].trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });
});
