import { describe, it, expect, vi } from "vitest";
import PdfToImage from "@/pages/PdfToImage.vue";
import UploadShell from "@/components/UploadShell.vue";
import { makeSamplePdfBytesNoText, toFakeFile } from "../helpers/samplePdf";
import { mountWithRouter, flush } from "../helpers/testRouter";

async function mountWithMaster(pageCount) {
  const bytes = await makeSamplePdfBytesNoText(pageCount);
  const wrapper = await mountWithRouter(PdfToImage);
  await wrapper.findComponent(UploadShell).vm.$emit("file-chosen", toFakeFile(bytes, "master.pdf"));
  await flush(wrapper);
  return wrapper;
}

describe("PdfToImage.vue — display", () => {
  it("shows the page-to-PNG count summary", async () => {
    const wrapper = await mountWithMaster(3);
    expect(wrapper.find(".dock-meta").text()).toBe("3 pages → 3 PNGs");
  });

  it("export button says 'Export PNG' for a single page, 'Export ZIP' for multiple", async () => {
    const single = await mountWithMaster(1);
    expect(single.find(".export-btn").text()).toContain("Export PNG");

    const multi = await mountWithMaster(3);
    expect(multi.find(".export-btn").text()).toContain("Export ZIP");
  });
});

describe("PdfToImage.vue — export correctness", () => {
  it("a single-page PDF downloads one real, non-empty PNG directly (not a zip)", async () => {
    const wrapper = await mountWithMaster(1);

    let capturedBlob = null;
    let capturedName = null;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalCreateElement = document.createElement.bind(document);
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "download", {
          set(v) {
            capturedName = v;
          },
          get() {
            return capturedName;
          },
        });
        el.click = () => {};
      }
      return el;
    });

    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(capturedBlob).not.toBeNull(), { timeout: 5000 });

    URL.createObjectURL = originalCreateObjectURL;
    document.createElement.mockRestore();

    expect(capturedBlob.type).toBe("image/png");
    expect(capturedBlob.size).toBeGreaterThan(0);
    expect(capturedName).toBe("master-page-01.png");
  });

  it("a multi-page PDF downloads a ZIP with one correctly-named, non-empty PNG per page", async () => {
    const wrapper = await mountWithMaster(3);

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });

    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(capturedBlob).not.toBeNull(), { timeout: 5000 });
    URL.createObjectURL = originalCreateObjectURL;

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await capturedBlob.arrayBuffer());
    const filenames = Object.keys(zip.files).sort();
    expect(filenames).toEqual(["master-page-01.png", "master-page-02.png", "master-page-03.png"]);

    for (const name of filenames) {
      const bytes = await zip.files[name].async("uint8array");
      expect(bytes.length).toBeGreaterThan(0);
      // PNG magic bytes
      expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });
});

describe("PdfToImage.vue — excluding pages", () => {
  it("renders a bin badge on every page", async () => {
    const wrapper = await mountWithMaster(3);
    expect(wrapper.findAll(".remove-badge-btn")).toHaveLength(3);
  });

  it("excluding a page skips it in the export and updates the summary", async () => {
    const wrapper = await mountWithMaster(3);
    await wrapper.findAll(".remove-badge-btn")[1].trigger("click"); // exclude page 2
    await flush(wrapper);
    expect(wrapper.find(".dock-meta").text()).toContain("2 of 3 pages");
    expect(wrapper.find(".dock-meta").text()).toContain("1 excluded");

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });
    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(capturedBlob).not.toBeNull(), { timeout: 5000 });
    URL.createObjectURL = originalCreateObjectURL;

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await capturedBlob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["master-page-01.png", "master-page-03.png"]);
  });

  it("excluding down to a single remaining page downloads a single PNG, not a zip", async () => {
    const wrapper = await mountWithMaster(3);
    await wrapper.findAll(".remove-badge-btn")[0].trigger("click");
    await wrapper.findAll(".remove-badge-btn")[1].trigger("click");
    await flush(wrapper);
    expect(wrapper.find(".export-btn").text()).toContain("Export PNG");
  });

  it("disables export once every page is excluded", async () => {
    const wrapper = await mountWithMaster(2);
    const bins = wrapper.findAll(".remove-badge-btn");
    await bins[0].trigger("click");
    await bins[1].trigger("click");
    await flush(wrapper);

    expect(wrapper.find(".export-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".dock-meta").text()).toContain("nothing to convert");
  });
});

describe("PdfToImage.vue — names past page 99", () => {
  it("regression: every page's file sorts into page order by name", async () => {
    const bytes = await makeSamplePdfBytesNoText(101, { width: 8, height: 8 });
    const wrapper = await mountWithRouter(PdfToImage);
    await wrapper.findComponent(UploadShell).vm.$emit("file-chosen", toFakeFile(bytes, "long.pdf"));
    await flush(wrapper);

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock";
    });
    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(capturedBlob).not.toBeNull(), { timeout: 30000 });
    URL.createObjectURL = originalCreateObjectURL;

    const JSZip = (await import("jszip")).default;
    const names = Object.keys((await JSZip.loadAsync(await capturedBlob.arrayBuffer())).files);
    expect(names).toHaveLength(101);
    // A plain sort is what ls, most archive tools and many viewers use.
    const sorted = [...names].sort();
    expect(sorted[0]).toBe("long-page-001.png");
    expect(sorted[99]).toBe("long-page-100.png");
    expect(sorted.map((n) => Number(n.match(/(\d+)\.png$/)[1]))).toEqual(
      Array.from({ length: 101 }, (_, i) => i + 1)
    );
  }, 60000);
});
