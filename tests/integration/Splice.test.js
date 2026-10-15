import { describe, it, expect, vi } from "vitest";
import Splice from "@/pages/Splice.vue";
import UploadShell from "@/components/UploadShell.vue";
import SpliceGap from "@/components/SpliceGap.vue";
import PrintToPdfModal from "@/components/PrintToPdfModal.vue";
import { makeFingerprintedPdfBytes, toFakeFile } from "../helpers/samplePdf";
import { encryptPdfBytes } from "../helpers/encryptedPdf";
import { mountWithRouter, flush } from "../helpers/testRouter";
import { PDFDocument } from "pdf-lib";

// Builds a fake File-like object (with arrayBuffer()) from PDF bytes,
// exactly like what a real <input type=file> would hand the app — see
// toFakeFile()'s comment for why this isn't a real jsdom File.
function toFile(bytes, name) {
  return toFakeFile(bytes, name, "application/pdf");
}

async function mountSplice() {
  return mountWithRouter(Splice);
}

async function mountWithMaster(widths) {
  const bytes = await makeFingerprintedPdfBytes(widths);
  const wrapper = await mountSplice();
  await wrapper.findComponent(UploadShell).vm.$emit("file-chosen", toFile(bytes, "master.pdf"));
  await flush(wrapper);
  return wrapper;
}

async function insertAt(wrapper, gapIndex, widths, insertIndex) {
  const bytes = await makeFingerprintedPdfBytes(widths);
  const spliceGaps = wrapper.findAllComponents(SpliceGap);
  const target = spliceGaps[gapIndex];
  await target.vm.$emit(
    "file-chosen",
    gapIndex,
    [toFile(bytes, `insert-${widths.join("-")}.pdf`)],
    insertIndex
  );
  await flush(wrapper);
}

describe("Splice.vue — loading and basic display", () => {
  it("shows the upload shell before a file is loaded, then the grid after", async () => {
    const wrapper = await mountSplice();
    expect(wrapper.findComponent(UploadShell).exists()).toBe(true);
    expect(wrapper.find(".dock").exists()).toBe(false);

    const bytes = await makeFingerprintedPdfBytes([1, 2, 3]);
    await wrapper.findComponent(UploadShell).vm.$emit("file-chosen", toFile(bytes, "master.pdf"));
    await flush(wrapper);

    expect(wrapper.findComponent(UploadShell).exists()).toBe(false);
    expect(wrapper.find(".dock").exists()).toBe(true);
    expect(wrapper.find(".dock-title").text()).toBe("master.pdf");
  });

  it("shows the correct total page count and no 'added' note with no inserts", async () => {
    const wrapper = await mountWithMaster([1, 2, 3, 4]);
    expect(wrapper.find(".dock-meta").text()).toContain("4 pages");
    expect(wrapper.find(".dock-meta").text()).not.toContain("added");
  });

  it("renders one SpliceGap per boundary (pageCount + 1) and one PageThumbnail per master page", async () => {
    const wrapper = await mountWithMaster([1, 2, 3]);
    const spliceGaps = wrapper.findAllComponents(SpliceGap);
    expect(spliceGaps.length).toBe(4); // 3 pages -> 4 boundaries
  });
});

describe("Splice.vue — inserting and numbering", () => {
  it("inserting one file at the first gap shows it as page 1 and shifts the master pages", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);
    await insertAt(wrapper, 0, [999], 0);

    expect(wrapper.find(".dock-meta").text()).toContain("4 pages");
    expect(wrapper.find(".dock-meta").text()).toContain("1 added");

    const pageNums = wrapper.findAll(".page-num").map((el) => el.text());
    expect(pageNums).toEqual(["01", "02", "03", "04"]);
  });

  it("inserting in the middle numbers everything correctly around it", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);
    await insertAt(wrapper, 1, [999], 0);

    const pageNums = wrapper.findAll(".page-num").map((el) => el.text());
    expect(pageNums).toEqual(["01", "02", "03", "04"]);
  });

  it("inserting a multi-page file numbers it as a range and continues correctly after", async () => {
    const wrapper = await mountWithMaster([10, 20]);
    await insertAt(wrapper, 1, [901, 902, 903], 0);

    const pageNums = wrapper.findAll(".page-num").map((el) => el.text());
    expect(pageNums[0]).toBe("01");
    expect(pageNums[1]).toBe("2\u20134");
    expect(pageNums[2]).toBe("05");
  });

  it("multiple inserts queued at the same gap are numbered in insertion order", async () => {
    const wrapper = await mountWithMaster([10, 20]);
    await insertAt(wrapper, 0, [1], 0);
    await insertAt(wrapper, 0, [2], 1);

    const pageNums = wrapper.findAll(".page-num").map((el) => el.text());
    expect(pageNums).toEqual(["01", "02", "03", "04"]);
  });

  it("removing an insert renumbers everything after it", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);
    await insertAt(wrapper, 0, [999], 0);
    expect(wrapper.find(".dock-meta").text()).toContain("4 pages");

    await wrapper.find(".gap-drop-filled .icon-btn").trigger("click");
    await flush(wrapper);

    expect(wrapper.find(".dock-meta").text()).toContain("3 pages");
    expect(wrapper.find(".dock-meta").text()).not.toContain("added");
    const pageNums = wrapper.findAll(".page-num").map((el) => el.text());
    expect(pageNums).toEqual(["01", "02", "03"]);
  });
});

describe("Splice.vue — full export round-trip", () => {
  it("exports a PDF with pages in the correct final order after multiple inserts", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);
    await insertAt(wrapper, 0, [1], 0);
    await insertAt(wrapper, 2, [2], 0);
    await insertAt(wrapper, 3, [3], 0);

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
    const bytes = new Uint8Array(arrayBuffer);
    const doc = await PDFDocument.load(bytes);
    const widths = doc.getPages().map((p) => Math.round(p.getWidth()));
    expect(widths).toEqual([1, 10, 20, 2, 30, 3]);
  });
});

describe("Splice.vue — print-to-pdf blocking", () => {
  it("shows the PrintToPdfModal instead of inserting when a blocked file type is chosen", async () => {
    const wrapper = await mountWithMaster([10, 20]);
    const spliceGaps = wrapper.findAllComponents(SpliceGap);
    const docxFile = new File(["x"], "resume.docx");
    await spliceGaps[0].vm.$emit("file-chosen", 0, [docxFile], 0);
    await flush(wrapper);

    expect(wrapper.findComponent(PrintToPdfModal).exists()).toBe(true);
    expect(wrapper.find(".dock-meta").text()).not.toContain("added");
  });
});

describe("Splice.vue — PDFs that cannot be modified", () => {
  // pdf.js opens a PDF encrypted with only an owner password and previews
  // it; pdf-lib, which does the splicing, refuses to load it at all. Such
  // a file has to be turned away when it is added, not when Export runs.
  async function chooseMaster(wrapper, bytes, name) {
    await wrapper.findComponent(UploadShell).vm.$emit("file-chosen", toFile(bytes, name));
    await flush(wrapper);
  }

  it("regression: an encrypted master PDF is refused with the print-to-PDF modal", async () => {
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([10, 20, 30]));
    const wrapper = await mountSplice();
    await chooseMaster(wrapper, locked, "statement.pdf");

    const modal = wrapper.findComponent(PrintToPdfModal);
    expect(modal.exists()).toBe(true);
    expect(modal.props("filename")).toBe("statement.pdf");
    expect(wrapper.find(".dock").exists()).toBe(false);
  });

  it("regression: a master PDF that needs a password to open is refused", async () => {
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([10]), { userPassword: "secret" });
    const wrapper = await mountSplice();
    await chooseMaster(wrapper, locked, "private.pdf");

    expect(wrapper.findComponent(PrintToPdfModal).props("filename")).toBe("private.pdf");
  });

  it("regression: a file that is not a PDF at all is refused", async () => {
    const wrapper = await mountSplice();
    await chooseMaster(wrapper, new TextEncoder().encode("not a pdf"), "notes.pdf");

    expect(wrapper.findComponent(PrintToPdfModal).props("filename")).toBe("notes.pdf");
  });

  it("the upload shell is still there after the modal is dismissed", async () => {
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([10]));
    const wrapper = await mountSplice();
    await chooseMaster(wrapper, locked, "statement.pdf");
    await wrapper.find(".modal-close").trigger("click");
    await flush(wrapper);

    expect(wrapper.findComponent(PrintToPdfModal).exists()).toBe(false);
    expect(wrapper.findComponent(UploadShell).exists()).toBe(true);
  });

  it("regression: an encrypted PDF dropped into a gap is refused, and nothing is queued", async () => {
    const wrapper = await mountWithMaster([10, 20]);
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([901]));
    await wrapper.findAllComponents(SpliceGap)[1].vm.$emit("file-chosen", 1, [toFile(locked, "locked.pdf")], 0);
    await flush(wrapper);

    expect(wrapper.findComponent(PrintToPdfModal).props("filename")).toBe("locked.pdf");
    expect(wrapper.find(".dock-meta").text()).not.toContain("added");
    expect(await exportWidths(wrapper)).toEqual([10, 20]);
  });

  it("regression: one encrypted file in a batch refuses the whole batch", async () => {
    const wrapper = await mountWithMaster([10, 20]);
    const fine = await makeFingerprintedPdfBytes([901]);
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([902]));
    await wrapper
      .findAllComponents(SpliceGap)[1]
      .vm.$emit("file-chosen", 1, [toFile(fine, "fine.pdf"), toFile(locked, "locked.pdf")], 0);
    await flush(wrapper);

    expect(wrapper.findComponent(PrintToPdfModal).exists()).toBe(true);
    expect(wrapper.find(".dock-meta").text()).not.toContain("added");
  });
});

describe("Splice.vue — excluding master pages", () => {
  it("renders a bin badge on every master page", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);
    expect(wrapper.findAll(".remove-badge-btn")).toHaveLength(3);
  });

  it("toggling a master page's bin icon excludes it from the exported PDF", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);
    await wrapper.findAll(".remove-badge-btn")[1].trigger("click"); // exclude page 2 (width 20)
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

    const bytes = new Uint8Array(await capturedBlob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    const widths = doc.getPages().map((p) => Math.round(p.getWidth()));
    expect(widths).toEqual([10, 30]);
  });

  it("updates the dock summary and disables export once every page is excluded", async () => {
    const wrapper = await mountWithMaster([10, 20]);
    const bins = wrapper.findAll(".remove-badge-btn");
    await bins[0].trigger("click");
    await bins[1].trigger("click");
    await flush(wrapper);

    expect(wrapper.find(".dock-meta").text()).toContain("nothing to export");
    expect(wrapper.find(".export-btn").attributes("disabled")).toBeDefined();
  });

  it("a master page excluded around an insert still splices the insert in at the right spot", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);
    await insertAt(wrapper, 1, [999], 0); // insert after page 1

    // Exclude master page 2 (width 20) — it's now the 2nd PageThumbnail overall.
    const bins = wrapper.findAll(".remove-badge-btn");
    await bins[1].trigger("click");
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

    const bytes = new Uint8Array(await capturedBlob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    const widths = doc.getPages().map((p) => Math.round(p.getWidth()));
    expect(widths).toEqual([10, 999, 30]);
  });
});

async function exportWidths(wrapper) {
  let capturedBlob = null;
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = vi.fn((blob) => {
    capturedBlob = blob;
    return "blob:mock";
  });
  await wrapper.find(".export-btn").trigger("click");
  await flush(wrapper);
  URL.createObjectURL = originalCreateObjectURL;
  if (!capturedBlob) return null;
  const doc = await PDFDocument.load(new Uint8Array(await capturedBlob.arrayBuffer()));
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

async function excludeInsertPages(wrapper, pageNumbers) {
  await wrapper.find(".gap-drop-filled .page-card").trigger("click");
  await flush(wrapper);
  const modalBins = wrapper.findAll(".modal-preview-grid .remove-badge-btn");
  for (const n of pageNumbers) await modalBins[n - 1].trigger("click");
  await flush(wrapper);
  await wrapper.find(".modal-close").trigger("click");
  await flush(wrapper);
}

describe("Splice.vue — page counts with multi-page inserts", () => {
  it("regression: the dock counts an inserted file's pages, not the file", async () => {
    const wrapper = await mountWithMaster([10]);
    await insertAt(wrapper, 1, [901, 902, 903], 0);

    expect(wrapper.find(".dock-meta").text()).toContain("4 of 4 pages");
    expect(await exportWidths(wrapper)).toEqual([10, 901, 902, 903]);
  });

  it("regression: export stays enabled while inserted pages remain", async () => {
    // One master page and a three-page insert. Excluding the master page
    // and one inserted page leaves two pages to export. Counting the
    // insert as a single page made that 2 - 2 = 0, so the dock said
    // "nothing to export" and disabled the button.
    const wrapper = await mountWithMaster([10]);
    await insertAt(wrapper, 1, [901, 902, 903], 0);
    await wrapper.findAll(".remove-slot .remove-badge-btn")[0].trigger("click");
    await excludeInsertPages(wrapper, [2]);

    expect(wrapper.find(".dock-meta").text()).toContain("2 of 4 pages");
    expect(wrapper.find(".export-btn").attributes("disabled")).toBeUndefined();
    expect(await exportWidths(wrapper)).toEqual([901, 903]);
  });

  it("regression: the count never goes negative", async () => {
    const wrapper = await mountWithMaster([10]);
    await insertAt(wrapper, 1, [901, 902, 903], 0);
    await wrapper.findAll(".remove-slot .remove-badge-btn")[0].trigger("click");
    await excludeInsertPages(wrapper, [1, 2, 3]);

    expect(wrapper.find(".dock-meta").text()).toContain("nothing to export");
    expect(wrapper.find(".export-btn").attributes("disabled")).toBeDefined();
  });
});

describe("Splice.vue — page numbers with exclusions", () => {
  // Each label is the page number that page will have in the exported
  // file. An excluded page has none, so it shows the number the next
  // included page takes: the position it would return to if restored.
  it("regression: pages after an excluded master page are numbered as they will be exported", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);
    await wrapper.findAll(".remove-slot .remove-badge-btn")[0].trigger("click");
    await flush(wrapper);
    await insertAt(wrapper, 2, [901, 902], 0);

    const pageNums = wrapper.findAll(".page-num").map((el) => el.text());
    // master 10 (excluded), master 20, insert 901-902, master 30
    expect(pageNums).toEqual(["01", "01", "2–3", "04"]);
    expect(await exportWidths(wrapper)).toEqual([20, 901, 902, 30]);
  });

  it("regression: an insert with an excluded page is numbered by the pages it keeps", async () => {
    const wrapper = await mountWithMaster([10, 20]);
    await insertAt(wrapper, 0, [901, 902, 903], 0);
    await excludeInsertPages(wrapper, [2]);

    const pageNums = wrapper.findAll(".page-num").map((el) => el.text());
    expect(pageNums).toEqual(["1–2", "03", "04"]);
    expect(await exportWidths(wrapper)).toEqual([901, 903, 10, 20]);
  });
});

describe("Splice.vue — excluding pages within a queued insert", () => {
  it("opening an insert's preview and toggling a page excludes just that page from the spliced output", async () => {
    const wrapper = await mountWithMaster([10, 20]);
    await insertAt(wrapper, 0, [901, 902, 903], 0);

    // Open the insert's preview by clicking its thumbnail.
    await wrapper.find(".gap-drop-filled .page-card").trigger("click");
    await flush(wrapper);

    // The insert preview modal shows 3 page bins; exclude the middle one (902).
    const modalBins = wrapper.findAll(".modal-preview-grid .remove-badge-btn");
    expect(modalBins).toHaveLength(3);
    await modalBins[1].trigger("click");
    await flush(wrapper);
    await wrapper.find(".modal-close").trigger("click");
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

    const bytes = new Uint8Array(await capturedBlob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    const widths = doc.getPages().map((p) => Math.round(p.getWidth()));
    expect(widths).toEqual([901, 903, 10, 20]);
  });
});
