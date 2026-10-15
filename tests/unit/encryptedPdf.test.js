import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { loadPdfDocument } from "@/lib/pdfRender";
import { assertEditable } from "@/lib/pdfOps";
import { makeFingerprintedPdfBytes } from "../helpers/samplePdf";
import { encryptPdfBytes } from "../helpers/encryptedPdf";

// The fixture has to be what it claims, or every test that uses it passes
// for the wrong reason: pdf.js must open it and pdf-lib must refuse it
// *because* it is encrypted.
describe("the encrypted-PDF fixture", () => {
  it("is refused by pdf-lib as encrypted", async () => {
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([10, 20]));
    await expect(PDFDocument.load(locked)).rejects.toThrow(/is encrypted/);
  });

  it("is opened by pdf.js with its pages intact", async () => {
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([10, 20, 30]));
    const doc = await loadPdfDocument(locked.slice());
    expect(doc.numPages).toBe(3);
    const widths = [];
    for (let i = 1; i <= 3; i++) widths.push((await doc.getPage(i)).view[2]);
    expect(widths).toEqual([10, 20, 30]);
  });

  it("is really encrypted, and decrypts to the original content", async () => {
    const plain = await makeFingerprintedPdfBytes([300]);
    const doc = await PDFDocument.load(plain);
    doc.getPage(0).drawText("MARKER TEXT", { x: 10, y: 40, size: 12 });
    const withText = await doc.save({ useObjectStreams: false });
    const locked = await encryptPdfBytes(withText);
    const latin1 = (b) => Buffer.from(b).toString("latin1");
    // pdf-lib Flate-compresses content streams, so check the /Encrypt
    // entry and that the decrypted page still carries the text.
    expect(latin1(locked)).toMatch(/\/Encrypt \d+ 0 R/);
    const pdfjsDoc = await loadPdfDocument(locked.slice());
    const text = await (await pdfjsDoc.getPage(1)).getTextContent();
    expect(text.items.map((i) => i.str).join("")).toContain("MARKER TEXT");
  });

  it("with a user password, pdf.js will not open it without one", async () => {
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([10]), { userPassword: "pw" });
    await expect(loadPdfDocument(locked.slice())).rejects.toThrow(/password/i);
  });
});

describe("assertEditable", () => {
  it("accepts an ordinary PDF", async () => {
    await expect(assertEditable(await makeFingerprintedPdfBytes([10]))).resolves.toBeUndefined();
  });

  it("rejects an encrypted PDF", async () => {
    const locked = await encryptPdfBytes(await makeFingerprintedPdfBytes([10]));
    await expect(assertEditable(locked)).rejects.toThrow(/encrypted/);
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(assertEditable(new TextEncoder().encode("hello"))).rejects.toThrow();
  });
});
