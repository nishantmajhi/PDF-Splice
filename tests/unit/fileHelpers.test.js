import { describe, it, expect } from "vitest";
import {
  getExt,
  isImage,
  isPdf,
  padToCount,
  needsPrintToPdf,
  printInstructionsFor,
} from "@/lib/fileHelpers";

describe("getExt", () => {
  it("lowercases and extracts the extension", () => {
    expect(getExt("Report.PDF")).toBe("pdf");
    expect(getExt("photo.JPG")).toBe("jpg");
  });

  it("uses the last extension for multi-dot filenames", () => {
    expect(getExt("archive.tar.gz")).toBe("gz");
  });

  it("BUG: a filename with no extension returns the whole filename, not empty/undefined", () => {
    // "README".split(".").pop() === "README" — getExt has no guard for
    // extension-less filenames, so isImage/isPdf/needsPrintToPdf all
    // silently fall through to "not an image, not a pdf" -> the
    // print-to-PDF modal, which is arguably the safest fallback, but the
    // return value itself is misleading (it looks like a valid "ext").
    expect(getExt("README")).toBe("readme");
  });
});

describe("isImage / isPdf", () => {
  it("recognizes common image extensions case-insensitively", () => {
    for (const ext of ["png", "PNG", "jpg", "JPEG", "gif", "webp", "bmp"]) {
      expect(isImage(`file.${ext}`)).toBe(true);
    }
  });

  it("recognizes pdf case-insensitively", () => {
    expect(isPdf("Doc.PDF")).toBe(true);
    expect(isPdf("doc.pdf")).toBe(true);
  });

  it("does not cross-classify pdf and image", () => {
    expect(isImage("file.pdf")).toBe(false);
    expect(isPdf("file.png")).toBe(false);
  });

  it("does not treat svg as an image (not in the supported list)", () => {
    // Notable gap: SVG is a very common image format but isn't in
    // IMAGE_EXTS, so uploading one anywhere the app accepts "images"
    // routes it to needsPrintToPdf() instead of the image pipeline.
    expect(isImage("icon.svg")).toBe(false);
    expect(needsPrintToPdf("icon.svg")).toBe(true);
  });
});

describe("needsPrintToPdf", () => {
  it("is false for pdf and image files", () => {
    expect(needsPrintToPdf("a.pdf")).toBe(false);
    expect(needsPrintToPdf("a.png")).toBe(false);
  });

  it("is true for office documents and anything else", () => {
    expect(needsPrintToPdf("a.docx")).toBe(true);
    expect(needsPrintToPdf("a.xlsx")).toBe(true);
    expect(needsPrintToPdf("a.txt")).toBe(true);
    expect(needsPrintToPdf("a.mp4")).toBe(true);
  });
});

describe("printInstructionsFor", () => {
  it("returns full guidance (app + steps) for docx/pptx/xlsx/txt", () => {
    for (const ext of ["docx", "pptx", "xlsx", "txt"]) {
      const info = printInstructionsFor(`file.${ext}`);
      expect(info.app).toBeTruthy();
      expect(Array.isArray(info.steps)).toBe(true);
      expect(info.steps.length).toBeGreaterThan(0);
    }
  });

  it("falls back to generic guidance for unknown extensions", () => {
    const info = printInstructionsFor("file.xyz");
    expect(info.app).toBe("the app that opens this file");
    expect(info.steps.length).toBeGreaterThan(0);
  });

  it("doc/ppt/xls entries have full guidance too, matching their docx/pptx/xlsx counterparts", () => {
    // Previously these three short-form entries only set `app`, with no
    // `steps` — PrintToPdfModal.vue's `v-for="step in info.steps"` would
    // silently render zero instructions for a .doc/.ppt/.xls upload. Now
    // fixed to share the same step list as the "x" variants.
    for (const ext of ["doc", "ppt", "xls"]) {
      const info = printInstructionsFor(`file.${ext}`);
      expect(info.app).toBeTruthy();
      expect(Array.isArray(info.steps)).toBe(true);
      expect(info.steps.length).toBeGreaterThan(0);
    }
  });
});

describe("padToCount", () => {
  it("pads to at least the minimum width", () => {
    expect(padToCount(1, 3)).toBe("01");
    expect(padToCount(7, 9, 3)).toBe("007");
  });

  it("widens to the last number's width when that is wider", () => {
    expect(padToCount(1, 100)).toBe("001");
    expect(padToCount(100, 100)).toBe("100");
    expect(padToCount(42, 1500, 3)).toBe("0042");
  });

  it("keeps a run of names in numeric order under a plain sort", () => {
    const names = Array.from({ length: 120 }, (_, i) => `p-${padToCount(i + 1, 120)}`);
    expect([...names].sort()).toEqual(names);
  });
});
