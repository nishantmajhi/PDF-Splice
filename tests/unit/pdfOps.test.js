import { describe, it, expect } from "vitest";
import {
  spliceIntoMasterPdf,
  splitPdf,
  splitPdfEveryPage,
  mergePdfs,
} from "@/lib/pdfOps";
import { makeFingerprintedPdfBytes, readFingerprint } from "../helpers/samplePdf";

describe("spliceIntoMasterPdf", () => {
  it("inserts nothing when the inserts map is empty (round-trips the master unchanged)", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20, 30]);
    const out = await spliceIntoMasterPdf(master, {});
    expect(await readFingerprint(out)).toEqual([10, 20, 30]);
  });

  it("inserts at gap 0 (before the first page)", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20, 30]);
    const insertA = await makeFingerprintedPdfBytes([999]);
    const out = await spliceIntoMasterPdf(master, { 0: [insertA] });
    expect(await readFingerprint(out)).toEqual([999, 10, 20, 30]);
  });

  it("inserts after the last page (gapIndex === original page count)", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20, 30]);
    const insertA = await makeFingerprintedPdfBytes([999]);
    const out = await spliceIntoMasterPdf(master, { 3: [insertA] });
    expect(await readFingerprint(out)).toEqual([10, 20, 30, 999]);
  });

  it("inserts in the middle at the correct gap", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20, 30]);
    const insertA = await makeFingerprintedPdfBytes([999]);
    // gap 1 = "after original page 1" = between page 10 and page 20
    const out = await spliceIntoMasterPdf(master, { 1: [insertA] });
    expect(await readFingerprint(out)).toEqual([10, 999, 20, 30]);
  });

  it("preserves insert order when multiple files are queued at the same gap", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20]);
    const insertA = await makeFingerprintedPdfBytes([991]);
    const insertB = await makeFingerprintedPdfBytes([992]);
    const out = await spliceIntoMasterPdf(master, { 1: [insertA, insertB] });
    expect(await readFingerprint(out)).toEqual([10, 991, 992, 20]);
  });

  it("handles a multi-page inserted PDF (all its pages land together, in order)", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20]);
    const insertA = await makeFingerprintedPdfBytes([901, 902, 903]);
    const out = await spliceIntoMasterPdf(master, { 1: [insertA] });
    expect(await readFingerprint(out)).toEqual([10, 901, 902, 903, 20]);
  });

  it("handles inserts at multiple gaps simultaneously", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20, 30]);
    const before = await makeFingerprintedPdfBytes([1]);
    const middle = await makeFingerprintedPdfBytes([2]);
    const after = await makeFingerprintedPdfBytes([3]);
    const out = await spliceIntoMasterPdf(master, { 0: [before], 1: [middle], 3: [after] });
    expect(await readFingerprint(out)).toEqual([1, 10, 2, 20, 30, 3]);
  });

  it("handles an empty master (0 pages) with only inserts", async () => {
    const master = await makeFingerprintedPdfBytes([]);
    const insertA = await makeFingerprintedPdfBytes([5, 6]);
    const out = await spliceIntoMasterPdf(master, { 0: [insertA] });
    // NOTE: pdf-lib itself adds a phantom default-size (595×841, A4) page
    // when saving a document that would otherwise have zero pages — this
    // is pdf-lib's behavior, not spliceIntoMasterPdf's. It only matters
    // for a genuinely 0-page master, which the UI never produces (a real
    // uploaded PDF always has >=1 page), so this documents the edge case
    // rather than guarding against it.
    expect(await readFingerprint(out)).toEqual([5, 6, 595]);
  });

  it("skips excluded master pages while still splicing inserts at their gap", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20, 30]);
    const insertA = await makeFingerprintedPdfBytes([999]);
    // Exclude master page 2 (value 20), insert still goes after gap 1 (after original page 1).
    const out = await spliceIntoMasterPdf(master, { 1: [insertA] }, new Set([2]));
    expect(await readFingerprint(out)).toEqual([10, 999, 30]);
  });

  it("accepts { bytes, excludedPages } insert items and drops those pages from the inserted file", async () => {
    const master = await makeFingerprintedPdfBytes([10, 20]);
    const insertA = await makeFingerprintedPdfBytes([1, 2, 3]);
    const out = await spliceIntoMasterPdf(master, {
      1: [{ bytes: insertA, excludedPages: new Set([2]) }],
    });
    expect(await readFingerprint(out)).toEqual([10, 1, 3, 20]);
  });

  it("supports mixing plain bytes and { bytes, excludedPages } insert items at the same gap", async () => {
    const master = await makeFingerprintedPdfBytes([10]);
    const insertA = await makeFingerprintedPdfBytes([1, 2]);
    const insertB = await makeFingerprintedPdfBytes([3, 4]);
    const out = await spliceIntoMasterPdf(master, {
      0: [insertA, { bytes: insertB, excludedPages: new Set([1]) }],
    });
    expect(await readFingerprint(out)).toEqual([1, 2, 4, 10]);
  });
});

describe("splitPdf", () => {
  it("splits into the given ranges, preserving page order within each range", async () => {
    const master = await makeFingerprintedPdfBytes([1, 2, 3, 4, 5]);
    const outputs = await splitPdf(master, [
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(outputs).toHaveLength(2);
    expect(await readFingerprint(outputs[0].bytes)).toEqual([1, 2]);
    expect(await readFingerprint(outputs[1].bytes)).toEqual([3, 4, 5]);
  });

  it("names each output file after its page range", async () => {
    const master = await makeFingerprintedPdfBytes([1, 2, 3]);
    const outputs = await splitPdf(master, [{ start: 1, end: 3 }]);
    expect(outputs[0].name).toBe("split-1-3.pdf");
  });

  it("supports a single-page range", async () => {
    const master = await makeFingerprintedPdfBytes([1, 2, 3]);
    const outputs = await splitPdf(master, [{ start: 2, end: 2 }]);
    expect(await readFingerprint(outputs[0].bytes)).toEqual([2]);
  });

  it("returns the whole document unchanged for a single full-range split (no cuts)", async () => {
    const master = await makeFingerprintedPdfBytes([1, 2, 3]);
    const outputs = await splitPdf(master, [{ start: 1, end: 3 }]);
    expect(outputs).toHaveLength(1);
    expect(await readFingerprint(outputs[0].bytes)).toEqual([1, 2, 3]);
  });

  it("drops excluded pages from whichever range they fall in", async () => {
    const master = await makeFingerprintedPdfBytes([1, 2, 3, 4, 5]);
    const outputs = await splitPdf(
      master,
      [
        { start: 1, end: 2 },
        { start: 3, end: 5 },
      ],
      new Set([2, 4])
    );
    expect(outputs).toHaveLength(2);
    expect(await readFingerprint(outputs[0].bytes)).toEqual([1]);
    expect(await readFingerprint(outputs[1].bytes)).toEqual([3, 5]);
  });

  it("drops a range entirely from the output when every page in it is excluded", async () => {
    const master = await makeFingerprintedPdfBytes([1, 2, 3, 4, 5]);
    const outputs = await splitPdf(
      master,
      [
        { start: 1, end: 2 },
        { start: 3, end: 5 },
      ],
      new Set([1, 2])
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe("split-3-5.pdf");
    expect(await readFingerprint(outputs[0].bytes)).toEqual([3, 4, 5]);
  });

  it("excluding every page across every range produces no outputs at all", async () => {
    const master = await makeFingerprintedPdfBytes([1, 2, 3]);
    const outputs = await splitPdf(master, [{ start: 1, end: 3 }], new Set([1, 2, 3]));
    expect(outputs).toHaveLength(0);
  });
});

describe("splitPdfEveryPage", () => {
  it("produces one single-page PDF per page, in order", async () => {
    const master = await makeFingerprintedPdfBytes([1, 2, 3]);
    const outputs = await splitPdfEveryPage(master);
    expect(outputs).toHaveLength(3);
    expect(await readFingerprint(outputs[0].bytes)).toEqual([1]);
    expect(await readFingerprint(outputs[1].bytes)).toEqual([2]);
    expect(await readFingerprint(outputs[2].bytes)).toEqual([3]);
  });
});

describe("mergePdfs", () => {
  it("concatenates PDFs in the given order", async () => {
    const a = await makeFingerprintedPdfBytes([1, 2]);
    const b = await makeFingerprintedPdfBytes([3]);
    const c = await makeFingerprintedPdfBytes([4, 5]);
    const out = await mergePdfs([a, b, c]);
    expect(await readFingerprint(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("merging a single file returns it unchanged", async () => {
    const a = await makeFingerprintedPdfBytes([1, 2, 3]);
    const out = await mergePdfs([a]);
    expect(await readFingerprint(out)).toEqual([1, 2, 3]);
  });

  it("merging zero files produces pdf-lib's phantom default page (not a truly empty PDF)", async () => {
    const out = await mergePdfs([]);
    // Same pdf-lib quirk as above. Merge.vue guards against this in the
    // UI (`files.length < 2` disables export), so this documents the
    // underlying function's behavior rather than a live bug.
    expect(await readFingerprint(out)).toEqual([595]);
  });

  it("accepts { bytes, excludedPages } entries and drops the excluded pages from that file's contribution", async () => {
    const a = await makeFingerprintedPdfBytes([1, 2, 3]);
    const b = await makeFingerprintedPdfBytes([4, 5]);
    const out = await mergePdfs([
      { bytes: a, excludedPages: new Set([2]) },
      { bytes: b, excludedPages: new Set() },
    ]);
    expect(await readFingerprint(out)).toEqual([1, 3, 4, 5]);
  });

  it("supports mixing plain bytes and { bytes, excludedPages } entries in the same call", async () => {
    const a = await makeFingerprintedPdfBytes([1, 2]);
    const b = await makeFingerprintedPdfBytes([3, 4]);
    const out = await mergePdfs([a, { bytes: b, excludedPages: new Set([1]) }]);
    expect(await readFingerprint(out)).toEqual([1, 2, 4]);
  });

  it("excluding every page of a file contributes nothing from it, without erroring", async () => {
    const a = await makeFingerprintedPdfBytes([1, 2]);
    const b = await makeFingerprintedPdfBytes([3]);
    const out = await mergePdfs([
      { bytes: a, excludedPages: new Set([1, 2]) },
      { bytes: b, excludedPages: new Set() },
    ]);
    expect(await readFingerprint(out)).toEqual([3]);
  });
});
