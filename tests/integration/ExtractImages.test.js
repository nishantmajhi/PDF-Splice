import { describe, it, expect, vi } from "vitest";
import ExtractImages from "@/pages/ExtractImages.vue";
import UploadShell from "@/components/UploadShell.vue";
import {
  makePdfBytesWithEmbeddedImage,
  makeSamplePdfBytesNoText,
  toFakeFile,
} from "../helpers/samplePdf";
import { mountWithRouter } from "../helpers/testRouter";
import { usePageViewer } from "@/lib/pageViewer";

async function mountWithMaster(bytes, name = "master.pdf") {
  const wrapper = await mountWithRouter(ExtractImages);
  await wrapper.findComponent(UploadShell).vm.$emit("file-chosen", toFakeFile(bytes, name));
  return wrapper;
}

describe("ExtractImages.vue — scanning and results", () => {
  it("finds and displays a real embedded image after scanning", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 1, imageSize: 30 });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    expect(wrapper.find(".dock-meta").text()).toBe("1 image found");
    const cards = wrapper.findAll(".page-card");
    expect(cards.length).toBe(1);
    expect(cards[0].text()).toContain("30×30");
    expect(cards[0].find("img").attributes("src")).toBe("blob:mock-url");
  });

  it("finds multiple images across multiple pages and numbers them sequentially", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    expect(wrapper.find(".dock-meta").text()).toBe("2 images found");
  });

  it("a PDF with no embedded images shows 0 found, with export disabled", async () => {
    const bytes = await makeSamplePdfBytesNoText(1);
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    expect(wrapper.find(".dock-meta").text()).toBe("0 images found");
    expect(wrapper.find(".export-btn").attributes("disabled")).toBeDefined();
  });

  it("export button reads 'Export Image' for one result, 'Export ZIP' for more than one", async () => {
    const single = await mountWithMaster(await makePdfBytesWithEmbeddedImage({ pageCount: 1 }));
    await vi.waitFor(() => expect(single.find(".dock-meta").exists() && !single.find(".scan-card").exists()).toBe(true), { timeout: 5000 });
    expect(single.find(".export-btn").text()).toContain("Export Image");

    const multi = await mountWithMaster(
      await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false })
    );
    await vi.waitFor(() => expect(multi.find(".dock-meta").exists() && !multi.find(".scan-card").exists()).toBe(true), { timeout: 5000 });
    expect(multi.find(".export-btn").text()).toContain("Export ZIP");
  });
});

describe("ExtractImages.vue — export correctness", () => {
  it("exports a single found image directly as a real, non-empty PNG", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 1, imageSize: 25 });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      if (blob && blob.type === "image/png") capturedBlob = blob;
      return "blob:mock-url";
    });

    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(capturedBlob).not.toBeNull(), { timeout: 5000 });
    URL.createObjectURL = originalCreateObjectURL;

    expect(capturedBlob.size).toBeGreaterThan(0);
  });

  it("exports multiple found images as a ZIP with real, non-empty PNG entries", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    let zipBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      if (blob && blob.type !== "image/png") zipBlob = blob; // the zip itself
      return "blob:mock-url";
    });

    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(zipBlob).not.toBeNull(), { timeout: 5000 });
    URL.createObjectURL = originalCreateObjectURL;

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const filenames = Object.keys(zip.files);
    expect(filenames.length).toBe(2);
    for (const name of filenames) {
      const b = await zip.files[name].async("uint8array");
      expect(b.length).toBeGreaterThan(0);
      expect(Array.from(b.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });
});

describe("ExtractImages.vue — viewer integration", () => {
  it("clicking an image thumbnail opens the shared image viewer at the right index", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    const { viewerState, closeViewer } = usePageViewer();
    closeViewer();
    const cards = wrapper.findAll(".page-card");
    await cards[1].trigger("click");

    expect(viewerState.viewer).not.toBeNull();
    expect(viewerState.viewer.mode).toBe("image");
    expect(viewerState.viewer.index).toBe(1);
    closeViewer();
  });
});

describe("ExtractImages.vue — excluding images", () => {
  it("renders a bin badge on every found image", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    expect(wrapper.findAll(".remove-badge-btn")).toHaveLength(2);
  });

  it("excluding an image updates the summary and leaves it out of the ZIP", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    await wrapper.findAll(".remove-badge-btn")[0].trigger("click");
    expect(wrapper.find(".dock-meta").text()).toContain("1 of 2 images");
    expect(wrapper.find(".dock-meta").text()).toContain("1 excluded");
    // Only one image remains, so the button should now read "Export Image".
    expect(wrapper.find(".export-btn").text()).toContain("Export Image");

    let capturedBlob = null;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });
    await wrapper.find(".export-btn").trigger("click");
    await vi.waitFor(() => expect(capturedBlob).not.toBeNull(), { timeout: 5000 });
    URL.createObjectURL = originalCreateObjectURL;

    expect(capturedBlob.type).toBe("image/png");
    expect(capturedBlob.size).toBeGreaterThan(0);
  });

  it("disables export once every found image is excluded", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    const bins = wrapper.findAll(".remove-badge-btn");
    await bins[0].trigger("click");
    await bins[1].trigger("click");

    expect(wrapper.find(".export-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".dock-meta").text()).toContain("nothing to export");
  });

  it("clicking a bin icon does not also open the image viewer", async () => {
    const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
    const wrapper = await mountWithMaster(bytes);
    await vi.waitFor(() => expect(wrapper.find(".dock-meta").exists() && !wrapper.find(".scan-card").exists()).toBe(true), { timeout: 5000 });

    const { viewerState, closeViewer } = usePageViewer();
    closeViewer();
    await wrapper.findAll(".remove-badge-btn")[0].trigger("click");
    expect(viewerState.viewer).toBeNull();
  });
});

describe("ExtractImages.vue — releasing the preview images", () => {
  // Each found image is a PNG blob shown through an object URL, and an
  // object URL keeps its blob alive until it is revoked or the tab closes.
  // Leaving the page has to let them go.
  function trackUrls() {
    const created = [];
    const revoked = [];
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:preview-${created.length}`;
      created.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url) => revoked.push(url));
    return { created, revoked, restore: () => ((URL.createObjectURL = create), (URL.revokeObjectURL = revoke)) };
  }

  it("regression: leaving the page revokes every preview URL", async () => {
    const urls = trackUrls();
    try {
      const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 3, repeatSameImage: false });
      const wrapper = await mountWithMaster(bytes);
      await vi.waitFor(() => expect(wrapper.findAll(".page-card img")).toHaveLength(3), { timeout: 5000 });
      expect(urls.created).toHaveLength(3);
      expect(urls.revoked).toEqual([]);

      wrapper.unmount();
      expect(urls.revoked.sort()).toEqual([...urls.created].sort());
    } finally {
      urls.restore();
    }
  });

  it("regression: a scan that finishes after the page has gone revokes what it made", async () => {
    const urls = trackUrls();
    try {
      const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
      const wrapper = await mountWithMaster(bytes);
      wrapper.unmount(); // the user navigated away mid-scan
      await new Promise((r) => setTimeout(r, 1500)); // long enough for the scan to have finished
      expect(urls.revoked.sort()).toEqual([...urls.created].sort());
    } finally {
      urls.restore();
    }
  });

  it("closes the image viewer if it is showing this page's images when the page goes", async () => {
    const urls = trackUrls();
    try {
      const bytes = await makePdfBytesWithEmbeddedImage({ pageCount: 2, repeatSameImage: false });
      const wrapper = await mountWithMaster(bytes);
      await vi.waitFor(() => expect(wrapper.findAll(".page-card img")).toHaveLength(2), { timeout: 5000 });
      const { viewerState, closeViewer } = usePageViewer();
      await wrapper.findAll(".page-card")[0].trigger("click");
      expect(viewerState.viewer?.mode).toBe("image");

      wrapper.unmount();
      expect(viewerState.viewer).toBeNull();
      closeViewer();
    } finally {
      urls.restore();
    }
  });

  it("leaves a PDF viewer from another page alone", async () => {
    const { viewerState, openPdfViewer, closeViewer } = usePageViewer();
    const wrapper = await mountWithMaster(await makePdfBytesWithEmbeddedImage({ pageCount: 1 }));
    await vi.waitFor(() => expect(wrapper.find(".scan-card").exists()).toBe(false), { timeout: 5000 });
    const fakeDoc = { numPages: 1 };
    openPdfViewer(fakeDoc, 1, 1);
    wrapper.unmount();
    expect(viewerState.viewer?.pdfDoc).toBe(fakeDoc);
    closeViewer();
  });
});
