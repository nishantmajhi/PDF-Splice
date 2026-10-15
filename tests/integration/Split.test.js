import { describe, it, expect, vi } from "vitest";
import Split from "@/pages/Split.vue";
import UploadShell from "@/components/UploadShell.vue";
import CutPoint from "@/components/CutPoint.vue";
import { makeFingerprintedPdfBytes, toFakeFile, readFingerprint } from "../helpers/samplePdf";
import { mountWithRouter, flush } from "../helpers/testRouter";

async function mountSplit() {
  return mountWithRouter(Split);
}

async function mountWithMaster(widths) {
  const bytes = await makeFingerprintedPdfBytes(widths);
  const wrapper = await mountSplit();
  await wrapper.findComponent(UploadShell).vm.$emit("file-chosen", toFakeFile(bytes, "master.pdf"));
  await flush(wrapper);
  return wrapper;
}

describe("Split.vue — display", () => {
  it("renders one CutPoint per internal gap (pageCount - 1), not after the last page", async () => {
    const wrapper = await mountWithMaster([1, 2, 3, 4]);
    const cutPoints = wrapper.findAllComponents(CutPoint);
    expect(cutPoints.length).toBe(3); // 4 pages -> 3 internal gaps
  });

  it("a single-page PDF has zero cut points", async () => {
    const wrapper = await mountWithMaster([1]);
    expect(wrapper.findAllComponents(CutPoint).length).toBe(0);
  });

  it("shows 'no cuts yet' with the full page count before any cut is made", async () => {
    const wrapper = await mountWithMaster([1, 2, 3]);
    expect(wrapper.find(".dock-meta").text()).toContain("no cuts yet");
    expect(wrapper.find(".dock-meta").text()).toContain("3 pages");
  });
});

describe("Split.vue — toggling cuts", () => {
  it("clicking a CutPoint marks it active; clicking again clears it", async () => {
    const wrapper = await mountWithMaster([1, 2, 3]);
    const cutPoints = wrapper.findAllComponents(CutPoint);
    expect(cutPoints[0].props("active")).toBe(false);

    await cutPoints[0].vm.$emit("toggle");
    await flush(wrapper);
    expect(wrapper.findAllComponents(CutPoint)[0].props("active")).toBe(true);

    await wrapper.findAllComponents(CutPoint)[0].vm.$emit("toggle");
    await flush(wrapper);
    expect(wrapper.findAllComponents(CutPoint)[0].props("active")).toBe(false);
  });

  it("one cut produces 2 output files in the dock summary", async () => {
    const wrapper = await mountWithMaster([1, 2, 3, 4]);
    await wrapper.findAllComponents(CutPoint)[1].vm.$emit("toggle"); // cut after page 2
    await flush(wrapper);
    expect(wrapper.find(".dock-meta").text()).toContain("2 files after split");
    expect(wrapper.find(".export-btn").text()).toContain("Export ZIP");
  });

  it("with no cuts, the export button says 'Export PDF' (single file, not a zip)", async () => {
    const wrapper = await mountWithMaster([1, 2, 3]);
    expect(wrapper.find(".export-btn").text()).toContain("Export PDF");
  });
});

describe("Split.vue — export correctness", () => {
  it("exporting with no cuts downloads a single PDF containing all pages unchanged", async () => {
    const wrapper = await mountWithMaster([10, 20, 30]);

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });

    await wrapper.find(".export-btn").trigger("click");
    await flush(wrapper);
    URL.createObjectURL = originalCreateObjectURL;

    expect(capturedBlob.type).toBe("application/pdf");
    const widths = await readFingerprint(new Uint8Array(await capturedBlob.arrayBuffer()));
    expect(widths).toEqual([10, 20, 30]);
  });

  it("exporting with cuts produces a ZIP containing correctly-split PDFs", async () => {
    const wrapper = await mountWithMaster([10, 20, 30, 40, 50]);
    // Cut after page 2 and after page 4: [1-2], [3-4], [5]
    await wrapper.findAllComponents(CutPoint)[1].vm.$emit("toggle");
    await flush(wrapper);
    await wrapper.findAllComponents(CutPoint)[3].vm.$emit("toggle");
    await flush(wrapper);

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });
    const errorSpy = vi.spyOn(console, "error");

    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(capturedBlob).not.toBeNull(), { timeout: 5000 });
    URL.createObjectURL = originalCreateObjectURL;
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();

    expect(capturedBlob).not.toBeNull();
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await capturedBlob.arrayBuffer());
    const filenames = Object.keys(zip.files).sort();
    expect(filenames).toEqual(["split-1-2.pdf", "split-3-4.pdf", "split-5-5.pdf"]);

    const firstBytes = await zip.files["split-1-2.pdf"].async("uint8array");
    expect(await readFingerprint(firstBytes)).toEqual([10, 20]);
    const secondBytes = await zip.files["split-3-4.pdf"].async("uint8array");
    expect(await readFingerprint(secondBytes)).toEqual([30, 40]);
    const thirdBytes = await zip.files["split-5-5.pdf"].async("uint8array");
    expect(await readFingerprint(thirdBytes)).toEqual([50]);
  });
});

describe("Split.vue — excluding pages", () => {
  it("renders a bin badge on every page", async () => {
    const wrapper = await mountWithMaster([1, 2, 3]);
    expect(wrapper.findAll(".remove-badge-btn")).toHaveLength(3);
  });

  it("excluding a page with no cuts drops it from the single exported PDF", async () => {
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

    const widths = await readFingerprint(new Uint8Array(await capturedBlob.arrayBuffer()));
    expect(widths).toEqual([10, 30]);
  });

  it("excluding every page in one range drops that range's output file entirely", async () => {
    const wrapper = await mountWithMaster([10, 20, 30, 40, 50]);
    // Cut after page 2 and after page 4: [1-2], [3-4], [5]
    await wrapper.findAllComponents(CutPoint)[1].vm.$emit("toggle");
    await wrapper.findAllComponents(CutPoint)[3].vm.$emit("toggle");
    await flush(wrapper);

    // Exclude both pages of the middle range (3 and 4).
    const bins = wrapper.findAll(".remove-badge-btn");
    await bins[2].trigger("click");
    await bins[3].trigger("click");
    await flush(wrapper);

    expect(wrapper.find(".dock-meta").text()).toContain("2 files after split");

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });
    await wrapper.find(".export-btn").trigger("click");
    await flush(wrapper);
    URL.createObjectURL = originalCreateObjectURL;

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await capturedBlob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["split-1-2.pdf", "split-5-5.pdf"]);
  });

  it("disables export and shows a message once every page is excluded", async () => {
    const wrapper = await mountWithMaster([1, 2]);
    const bins = wrapper.findAll(".remove-badge-btn");
    await bins[0].trigger("click");
    await bins[1].trigger("click");
    await flush(wrapper);

    expect(wrapper.find(".export-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".dock-meta").text()).toContain("nothing to split");
  });
});
