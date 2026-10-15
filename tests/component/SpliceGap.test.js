import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import SpliceGap from "@/components/SpliceGap.vue";
import { loadPdfDocument } from "@/lib/pdfRender";
import { makeSamplePdfBytesNoText } from "../helpers/samplePdf";

async function makeInsertItem(id, name = "insert.pdf", pageCount = 1) {
  const bytes = await makeSamplePdfBytesNoText(pageCount);
  const pdfDoc = await loadPdfDocument(bytes.slice());
  return { id, name, bytes, pdfDoc, pageCount };
}

function setInputFiles(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

describe("SpliceGap.vue — empty gap", () => {
  it("renders a single collapsed '+' when there are no inserts and it's not active", () => {
    const wrapper = mount(SpliceGap, {
      props: { gapIndex: 0, inserts: [], isActive: false, isConverting: false, pageNumbers: null },
    });
    expect(wrapper.findAll(".gap-collapsed").length).toBe(1);
    expect(wrapper.find(".gap-collapsed").attributes("aria-label")).toBe("Insert a file here");
  });

  it("clicking '+' emits activate with this gap's index", async () => {
    const wrapper = mount(SpliceGap, {
      props: { gapIndex: 4, inserts: [], isActive: false, isConverting: false, pageNumbers: null },
    });
    await wrapper.find(".gap-collapsed").trigger("click");
    expect(wrapper.emitted("activate")[0]).toEqual([4]);
  });

  it("when active, shows the dropzone with a Cancel control instead of the '+'", async () => {
    const wrapper = mount(SpliceGap, {
      props: { gapIndex: 0, inserts: [], isActive: true, isConverting: false, pageNumbers: null },
    });
    expect(wrapper.find(".gap-drop").exists()).toBe(true);
    await wrapper.find(".icon-btn").trigger("click");
    expect(wrapper.emitted("cancel")[0]).toEqual([0]);
  });

  it("shows 'Preparing…' instead of the upload UI while converting", () => {
    const wrapper = mount(SpliceGap, {
      props: { gapIndex: 0, inserts: [], isActive: true, isConverting: true, pageNumbers: null },
    });
    expect(wrapper.text()).toContain("Preparing");
    expect(wrapper.find(".browse-link").exists()).toBe(false);
  });

  it("selecting files via the file input emits file-chosen with (gapIndex, files, boundary=0)", async () => {
    const wrapper = mount(SpliceGap, {
      props: { gapIndex: 2, inserts: [], isActive: true, isConverting: false, pageNumbers: null },
    });
    const input = wrapper.find('input[type="file"]');
    const fakeFile = new File(["x"], "a.pdf");
    setInputFiles(input.element, [fakeFile]);
    await input.trigger("change");

    expect(wrapper.emitted("file-chosen")).toBeTruthy();
    const [gapIndex, files, boundary] = wrapper.emitted("file-chosen")[0];
    expect(gapIndex).toBe(2);
    expect(files).toEqual([fakeFile]);
    expect(boundary).toBe(0);
  });
});

describe("SpliceGap.vue — with queued inserts", () => {
  it("renders a '+' before, between, and after 2 queued inserts (3 total), with correct labels", async () => {
    const itemA = await makeInsertItem("a");
    const itemB = await makeInsertItem("b");
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 0,
        inserts: [itemA, itemB],
        isActive: false,
        isConverting: false,
        pageNumbers: null,
      },
    });
    const pluses = wrapper.findAll(".gap-collapsed");
    expect(pluses.length).toBe(3); // before A, between A/B, after B
    expect(pluses[0].attributes("aria-label")).toBe("Add files before the queued ones");
    expect(pluses[1].attributes("aria-label")).toBe("Add files between these two");
    expect(pluses[2].attributes("aria-label")).toBe("Add files after the queued ones");
  });

  it("renders one filled box per queued insert, each showing its file name as a title", async () => {
    const itemA = await makeInsertItem("a", "First.pdf");
    const itemB = await makeInsertItem("b", "Second.pdf");
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 0,
        inserts: [itemA, itemB],
        isActive: false,
        isConverting: false,
        pageNumbers: null,
      },
    });
    const filled = wrapper.findAll(".gap-drop-filled");
    expect(filled.length).toBe(2);
    expect(filled[0].attributes("title")).toBe("First.pdf");
    expect(filled[1].attributes("title")).toBe("Second.pdf");
  });

  it("clicking the middle '+' (boundary between two inserts) activates with the right boundary index", async () => {
    const itemA = await makeInsertItem("a");
    const itemB = await makeInsertItem("b");
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 5,
        inserts: [itemA, itemB],
        isActive: false,
        isConverting: false,
        pageNumbers: null,
      },
    });
    // Click the middle "+" (index 1 of 3 collapsed buttons: before, between, after)
    await wrapper.findAll(".gap-collapsed")[1].trigger("click");
    expect(wrapper.emitted("activate")[0]).toEqual([5]);

    // Re-mount as active to confirm the dropzone opened at the *middle*
    // boundary specifically, not silently defaulting to the end — since
    // `pendingIndex` is internal state, we verify it via the dropzone's
    // own boundary-aware copy text once uploading is active there.
    await wrapper.setProps({ isActive: true });
    // .gap-drop is shared by both the actual dropzone AND the filled
    // item boxes (both carry that class) — the dropzone itself is the
    // one WITHOUT .gap-drop-filled.
    const dropzoneText = wrapper.find(".gap-drop:not(.gap-drop-filled)").text();
    expect(dropzoneText).toContain("between");
  });

  it("remove button on a queued insert emits remove with (gapIndex, item.id)", async () => {
    const itemA = await makeInsertItem("a");
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 3,
        inserts: [itemA],
        isActive: false,
        isConverting: false,
        pageNumbers: null,
      },
    });
    await wrapper.find(".gap-drop-filled .icon-btn").trigger("click");
    expect(wrapper.emitted("remove")[0]).toEqual([3, "a"]);
  });

  it("uses the pageNumbers map to label a queued insert's display number as a range", async () => {
    const itemA = await makeInsertItem("a", "multi.pdf", 3);
    const pageNumbers = new Map([["a", { start: 5, end: 7 }]]);
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 0,
        inserts: [itemA],
        isActive: false,
        isConverting: false,
        pageNumbers,
      },
    });
    expect(wrapper.find(".page-num").text()).toBe("5\u20137");
  });

  it("labels a single-page insert as just the one number, not a range", async () => {
    const itemA = await makeInsertItem("a", "single.pdf", 1);
    const pageNumbers = new Map([["a", { start: 5, end: 5 }]]);
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 0,
        inserts: [itemA],
        isActive: false,
        isConverting: false,
        pageNumbers,
      },
    });
    // PageThumbnail zero-pads whatever displayNumber it's given — labelFor
    // returning "5" (not a range) still passes through that padding, so
    // the rendered text is "05", not "5".
    expect(wrapper.find(".page-num").text()).toBe("05");
  });

  it("emits preview-insert with the item's data when its thumbnail is clicked", async () => {
    const itemA = await makeInsertItem("a", "clickme.pdf", 2);
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 0,
        inserts: [itemA],
        isActive: false,
        isConverting: false,
        pageNumbers: null,
      },
    });
    await wrapper.find(".page-card").trigger("click");
    expect(wrapper.emitted("preview-insert")).toBeTruthy();
    const payload = wrapper.emitted("preview-insert")[0][0];
    expect(payload.name).toBe("clickme.pdf");
    expect(payload.pageCount).toBe(2);
  });

  it("drag-and-drop reorder emits reorder with (gapIndex, draggedId, targetId)", async () => {
    const itemA = await makeInsertItem("a");
    const itemB = await makeInsertItem("b");
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 1,
        inserts: [itemA, itemB],
        isActive: false,
        isConverting: false,
        pageNumbers: null,
      },
    });
    const boxes = wrapper.findAll(".gap-drop-filled");
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
    };
    await boxes[0].trigger("dragstart", { dataTransfer });
    await boxes[1].trigger("dragover", { dataTransfer });
    await boxes[1].trigger("drop", { dataTransfer });

    expect(wrapper.emitted("reorder")).toBeTruthy();
    expect(wrapper.emitted("reorder")[0]).toEqual([1, "a", "b"]);
  });

  it("dropping an item onto itself does NOT emit reorder", async () => {
    const itemA = await makeInsertItem("a");
    const itemB = await makeInsertItem("b");
    const wrapper = mount(SpliceGap, {
      props: {
        gapIndex: 0,
        inserts: [itemA, itemB],
        isActive: false,
        isConverting: false,
        pageNumbers: null,
      },
    });
    const boxes = wrapper.findAll(".gap-drop-filled");
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    await boxes[0].trigger("dragstart", { dataTransfer });
    await boxes[0].trigger("drop", { dataTransfer });
    expect(wrapper.emitted("reorder")).toBeFalsy();
  });
});
