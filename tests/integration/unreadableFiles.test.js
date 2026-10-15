import { describe, it, expect, vi } from "vitest";
import Split from "@/pages/Split.vue";
import Merge from "@/pages/Merge.vue";
import PdfToImage from "@/pages/PdfToImage.vue";
import ExtractImages from "@/pages/ExtractImages.vue";
import UploadShell from "@/components/UploadShell.vue";
import PrintToPdfModal from "@/components/PrintToPdfModal.vue";
import { makeFingerprintedPdfBytes, makeSamplePdfBytesNoText, toFakeFile } from "../helpers/samplePdf";
import { encryptPdfBytes } from "../helpers/encryptedPdf";
import { mountWithRouter, flush } from "../helpers/testRouter";

// Every page that opens a PDF has to say so when it cannot, rather than
// leave the upload shell sitting there. Splice has its own tests for this
// (tests/integration/Splice.test.js); these are the other four.
//
// Split and Merge modify the file with pdf-lib, so an owner-password PDF
// (which pdf.js previews happily) must be refused up front. PDF to Image
// and Extract Images only render with pdf.js, so the same file is fine
// there and must *not* be refused.

async function choose(wrapper, bytes, name) {
  wrapper.findComponent(UploadShell).vm.$emit("file-chosen", toFakeFile(bytes, name));
  await flush(wrapper);
  await new Promise((r) => setTimeout(r, 50));
  await flush(wrapper);
}

const notAPdf = () => new TextEncoder().encode("this is not a pdf");
const needsPassword = async () =>
  encryptPdfBytes(await makeFingerprintedPdfBytes([100]), { userPassword: "secret" });
const ownerOnly = async () => encryptPdfBytes(await makeSamplePdfBytesNoText(2));

const pages = [
  { name: "Split", component: Split, modifies: true },
  { name: "Merge", component: Merge, modifies: true },
  { name: "PdfToImage", component: PdfToImage, modifies: false },
  { name: "ExtractImages", component: ExtractImages, modifies: false },
];

for (const page of pages) {
  describe(`${page.name}.vue — a file it cannot open`, () => {
    it("regression: a file that is not a PDF is reported by name", async () => {
      const wrapper = await mountWithRouter(page.component);
      await choose(wrapper, notAPdf(), "scan.pdf");
      const modal = wrapper.findComponent(PrintToPdfModal);
      expect(modal.exists()).toBe(true);
      expect(modal.props("filename")).toBe("scan.pdf");
    });

    it("regression: a PDF that needs a password is reported by name", async () => {
      const wrapper = await mountWithRouter(page.component);
      await choose(wrapper, await needsPassword(), "private.pdf");
      expect(wrapper.findComponent(PrintToPdfModal).props("filename")).toBe("private.pdf");
    });

    it("dismissing the report leaves the upload shell ready for another file", async () => {
      const wrapper = await mountWithRouter(page.component);
      await choose(wrapper, notAPdf(), "scan.pdf");
      await wrapper.find(".modal-close").trigger("click");
      await flush(wrapper);
      expect(wrapper.findComponent(PrintToPdfModal).exists()).toBe(false);
      expect(wrapper.findComponent(UploadShell).exists()).toBe(true);
    });

    if (page.modifies) {
      it("regression: a PDF encrypted with only an owner password is refused, since it cannot be modified", async () => {
        const wrapper = await mountWithRouter(page.component);
        await choose(wrapper, await ownerOnly(), "statement.pdf");
        expect(wrapper.findComponent(PrintToPdfModal).props("filename")).toBe("statement.pdf");
        expect(wrapper.find(".dock").exists()).toBe(false);
      });
    } else {
      it("a PDF encrypted with only an owner password is accepted, since it only has to be read", async () => {
        const wrapper = await mountWithRouter(page.component);
        await choose(wrapper, await ownerOnly(), "statement.pdf");
        expect(wrapper.findComponent(PrintToPdfModal).exists()).toBe(false);
        await vi.waitFor(() => expect(wrapper.find(".dock-title").text()).toBe("statement.pdf"), { timeout: 5000 });
      });
    }
  });
}

describe("Merge.vue — a bad file in a batch", () => {
  it("regression: the good files are still queued, in order, and the bad one is reported", async () => {
    const wrapper = await mountWithRouter(Merge);
    const input = wrapper.findComponent(UploadShell).find('input[type="file"]');
    const files = [
      toFakeFile(await makeFingerprintedPdfBytes([11]), "one.pdf"),
      toFakeFile(await ownerOnly(), "locked.pdf"),
      toFakeFile(await makeFingerprintedPdfBytes([33]), "three.pdf"),
    ];
    Object.defineProperty(input.element, "files", { value: files, configurable: true });
    await input.trigger("change");

    await vi.waitFor(() => expect(wrapper.findAll(".merge-card-name").length).toBe(2), { timeout: 5000 });
    expect(wrapper.findAll(".merge-card-name").map((e) => e.text())).toEqual(["one.pdf", "three.pdf"]);
    expect(wrapper.findComponent(PrintToPdfModal).props("filename")).toBe("locked.pdf");
  });
});
