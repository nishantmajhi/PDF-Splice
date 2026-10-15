import { describe, it, expect, vi } from "vitest";
import Merge from "@/pages/Merge.vue";
import UploadShell from "@/components/UploadShell.vue";
import MergeFileCard from "@/components/MergeFileCard.vue";
import { makeFingerprintedPdfBytes, toFakeFile, readFingerprint } from "../helpers/samplePdf";
import { mountWithRouter, flush } from "../helpers/testRouter";

async function mountMerge() {
  return mountWithRouter(Merge);
}

function setInputFiles(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

async function addFile(wrapper, widths, name) {
  const bytes = await makeFingerprintedPdfBytes(widths);
  const file = toFakeFile(bytes, name);
  const uploadShell = wrapper.findComponent(UploadShell);
  if (uploadShell.exists()) {
    // First file: the empty-state UploadShell is showing.
    await uploadShell.vm.$emit("file-chosen", file);
  } else {
    // Subsequent files: UploadShell has unmounted (files.length > 0), so
    // add via the "+ Add PDF" card's hidden file input instead.
    const input = wrapper.find('input[type="file"]');
    setInputFiles(input.element, [file]);
    await input.trigger("change");
  }
  await flush(wrapper);
}

// A file whose contents arrive late, the way a large file does.
function slowFile(bytes, name, ms) {
  const file = toFakeFile(bytes, name);
  const read = file.arrayBuffer;
  file.arrayBuffer = () => new Promise((r) => setTimeout(r, ms)).then(read);
  return file;
}

async function dropFiles(wrapper, files) {
  const input = wrapper.findComponent(UploadShell).find('input[type="file"]');
  setInputFiles(input.element, files);
  await input.trigger("change");
}

describe("Merge.vue — adding several files at once", () => {
  it("regression: files dropped together are queued in the order chosen, not the order they finish loading", async () => {
    const wrapper = await mountMerge();
    const first = slowFile(await makeFingerprintedPdfBytes([11]), "first.pdf", 60);
    const second = toFakeFile(await makeFingerprintedPdfBytes([22]), "second.pdf");
    const third = toFakeFile(await makeFingerprintedPdfBytes([33]), "third.pdf");
    await dropFiles(wrapper, [first, second, third]);

    await vi.waitFor(() => expect(wrapper.findAllComponents(MergeFileCard).length).toBe(3), { timeout: 5000 });
    const names = wrapper.findAllComponents(MergeFileCard).map((c) => c.props("file").name);
    expect(names).toEqual(["first.pdf", "second.pdf", "third.pdf"]);

    let captured = null;
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn((b) => ((captured = b), "blob:mock"));
    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(captured).not.toBeNull(), { timeout: 5000 });
    URL.createObjectURL = original;
    expect(await readFingerprint(new Uint8Array(await captured.arrayBuffer()))).toEqual([11, 22, 33]);
  });

  it("regression: a file added while a batch is still loading goes after the batch", async () => {
    const wrapper = await mountMerge();
    await dropFiles(wrapper, [slowFile(await makeFingerprintedPdfBytes([11]), "slow.pdf", 60)]);
    // The upload shell is still showing, so a second drop reaches it too.
    await dropFiles(wrapper, [toFakeFile(await makeFingerprintedPdfBytes([22]), "quick.pdf")]);

    await vi.waitFor(() => expect(wrapper.findAllComponents(MergeFileCard).length).toBe(2), { timeout: 5000 });
    expect(wrapper.findAllComponents(MergeFileCard).map((c) => c.props("file").name)).toEqual(["slow.pdf", "quick.pdf"]);
  });
});

describe("Merge.vue — adding files", () => {
  it("shows the upload shell with 0 files, then the grid after adding one", async () => {
    const wrapper = await mountMerge();
    expect(wrapper.findComponent(UploadShell).exists()).toBe(true);

    await addFile(wrapper, [1, 2], "a.pdf");
    expect(wrapper.findComponent(UploadShell).exists()).toBe(false);
    expect(wrapper.findAllComponents(MergeFileCard).length).toBe(1);
  });

  it("adds files in the order they're chosen and tracks total page count", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [1, 2], "a.pdf");
    await addFile(wrapper, [3, 4, 5], "b.pdf");

    const cards = wrapper.findAllComponents(MergeFileCard);
    expect(cards.map((c) => c.props("file").name)).toEqual(["a.pdf", "b.pdf"]);
    expect(wrapper.find(".dock-meta").text()).toBe("5 pages total");
    expect(wrapper.find(".dock-title").text()).toBe("Merge 2 files");
  });

  it("export is disabled with fewer than 2 files", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [1], "solo.pdf");
    expect(wrapper.find(".export-btn").attributes("disabled")).toBeDefined();

    await addFile(wrapper, [2], "second.pdf");
    expect(wrapper.find(".export-btn").attributes("disabled")).toBeUndefined();
  });
});

describe("Merge.vue — removing files", () => {
  it("removing a file updates the list and page count", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [1, 2], "a.pdf");
    await addFile(wrapper, [3], "b.pdf");
    await addFile(wrapper, [4, 5], "c.pdf");

    const cards = wrapper.findAllComponents(MergeFileCard);
    await cards[1].vm.$emit("remove", 1); // remove "b.pdf"
    await flush(wrapper);

    const remaining = wrapper.findAllComponents(MergeFileCard);
    expect(remaining.map((c) => c.props("file").name)).toEqual(["a.pdf", "c.pdf"]);
    expect(wrapper.find(".dock-meta").text()).toBe("4 pages total");
  });
});

describe("Merge.vue — drag-to-reorder", () => {
  it("dragging card 0 over card 2 moves it to that position live (during dragover, before drop)", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [1], "a.pdf");
    await addFile(wrapper, [2], "b.pdf");
    await addFile(wrapper, [3], "c.pdf");

    let cards = wrapper.findAllComponents(MergeFileCard);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    await cards[0].vm.$emit("drag-start", { dataTransfer });
    // Drag "a" over "c"'s position (index 2)
    await cards[2].vm.$emit("drag-over", { preventDefault: () => {}, dataTransfer });
    await flush(wrapper);

    cards = wrapper.findAllComponents(MergeFileCard);
    expect(cards.map((c) => c.props("file").name)).toEqual(["b.pdf", "c.pdf", "a.pdf"]);
  });

  it("dragging over the same index it's already at is a no-op", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [1], "a.pdf");
    await addFile(wrapper, [2], "b.pdf");

    let cards = wrapper.findAllComponents(MergeFileCard);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    await cards[0].vm.$emit("drag-start", { dataTransfer });
    await cards[0].vm.$emit("drag-over", { preventDefault: () => {}, dataTransfer });
    await flush(wrapper);

    cards = wrapper.findAllComponents(MergeFileCard);
    expect(cards.map((c) => c.props("file").name)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("drag-end clears the dragging state", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [1], "a.pdf");
    await addFile(wrapper, [2], "b.pdf");

    const cards = wrapper.findAllComponents(MergeFileCard);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    await cards[0].vm.$emit("drag-start", { dataTransfer });
    expect(cards[0].props("isDragging")).toBe(true);

    await cards[0].vm.$emit("drag-end");
    await flush(wrapper);
    const after = wrapper.findAllComponents(MergeFileCard);
    expect(after.every((c) => c.props("isDragging") === false)).toBe(true);
  });
});

describe("Merge.vue — export produces correctly ordered output", () => {
  it("exports pages in the current (possibly reordered) file order", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [10, 11], "a.pdf");
    await addFile(wrapper, [20], "b.pdf");
    await addFile(wrapper, [30, 31], "c.pdf");

    // Reorder: drag "a" (index 0) to where "c" is (index 2) -> b, c, a
    let cards = wrapper.findAllComponents(MergeFileCard);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    await cards[0].vm.$emit("drag-start", { dataTransfer });
    await cards[2].vm.$emit("drag-over", { preventDefault: () => {}, dataTransfer });
    await flush(wrapper);

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });

    await wrapper.find(".export-btn").trigger("click");
    await flush(wrapper);
    URL.createObjectURL = originalCreateObjectURL;

    expect(capturedBlob).not.toBeNull();
    const arrayBuffer = await capturedBlob.arrayBuffer();
    const widths = await readFingerprint(new Uint8Array(arrayBuffer));
    // Expected final order after reorder: b(20), c(30,31), a(10,11)
    expect(widths).toEqual([20, 30, 31, 10, 11]);
  });
});

describe("Merge.vue — preview", () => {
  it("clicking a card's preview opens InsertPreviewModal with that file's data", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [1, 2], "target.pdf");

    const card = wrapper.findComponent(MergeFileCard);
    await card.vm.$emit("preview", card.props("file"));
    await flush(wrapper);

    expect(wrapper.text()).toContain("target.pdf");
  });
});

describe("Merge.vue — excluding pages within a file", () => {
  it("toggling a page's bin icon in the preview modal excludes it from the merged output", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [10, 11, 12], "a.pdf");
    await addFile(wrapper, [20, 21], "b.pdf");

    const card = wrapper.findComponent(MergeFileCard);
    await card.vm.$emit("preview", card.props("file"));
    await flush(wrapper);

    // Exclude page 2 of a.pdf (fingerprint value 11).
    const binButtons = wrapper.findAll(".remove-badge-btn");
    await binButtons[1].trigger("click");
    await flush(wrapper);

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });
    await wrapper.find(".export-btn").trigger("click");
    await flush(wrapper);
    URL.createObjectURL = originalCreateObjectURL;

    const arrayBuffer = await capturedBlob.arrayBuffer();
    const widths = await readFingerprint(new Uint8Array(arrayBuffer));
    expect(widths).toEqual([10, 12, 20, 21]);
  });

  it("updates the dock summary to reflect excluded pages", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [10, 11, 12], "a.pdf");
    await addFile(wrapper, [20, 21], "b.pdf");

    const card = wrapper.findComponent(MergeFileCard);
    await card.vm.$emit("preview", card.props("file"));
    await flush(wrapper);
    await wrapper.findAll(".remove-badge-btn")[1].trigger("click");
    await flush(wrapper);

    expect(wrapper.find(".dock-meta").text()).toContain("4 of 5 pages total");
    expect(wrapper.find(".dock-meta").text()).toContain("1 excluded");
  });

  it("disables export when every page across every file is excluded", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [10], "a.pdf");
    await addFile(wrapper, [20], "b.pdf");

    const cards = wrapper.findAllComponents(MergeFileCard);
    await cards[0].vm.$emit("preview", cards[0].props("file"));
    await flush(wrapper);
    await wrapper.findAll(".remove-badge-btn")[0].trigger("click");
    await flush(wrapper);
    await wrapper.find(".modal-close").trigger("click");
    await flush(wrapper);

    const cards2 = wrapper.findAllComponents(MergeFileCard);
    await cards2[1].vm.$emit("preview", cards2[1].props("file"));
    await flush(wrapper);
    await wrapper.findAll(".remove-badge-btn")[0].trigger("click");
    await flush(wrapper);

    expect(wrapper.find(".export-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".dock-meta").text()).toContain("nothing to merge");
  });

  it("replaces the file card's remove button with a bin icon (no XIcon)", async () => {
    const wrapper = await mountMerge();
    await addFile(wrapper, [1, 2], "a.pdf");
    await addFile(wrapper, [3], "b.pdf");
    expect(wrapper.find(".icon-btn").exists()).toBe(true);
  });
});
