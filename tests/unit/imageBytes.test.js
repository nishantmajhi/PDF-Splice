import { describe, it, expect } from "vitest";
import { jpegOrientation, orientationTransform, sniffImageType } from "@/lib/imageBytes";
import { exifSegment } from "../helpers/exifJpeg";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("sniffImageType", () => {
  it("recognises the PNG signature", () => {
    expect(sniffImageType(Uint8Array.from([...PNG_SIG, 0, 0, 0, 13]))).toBe("png");
  });

  it("recognises a JPEG by its start-of-image marker", () => {
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1]))).toBe("jpeg");
  });

  it("returns null for formats pdf-lib cannot embed", () => {
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBP"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("BM"))).toBeNull();
  });

  it("returns null for a truncated signature", () => {
    expect(sniffImageType(Uint8Array.from(PNG_SIG.slice(0, 7)))).toBeNull();
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it("does not take a PNG signature with one byte wrong", () => {
    const b = Uint8Array.from(PNG_SIG);
    b[4] = 0x0a; // a PNG mangled by a text-mode transfer
    expect(sniffImageType(b)).toBeNull();
  });
});

describe("jpegOrientation", () => {
  const SOI = [0xff, 0xd8];
  const JFIF = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const SOS = [0xff, 0xda, 0, 2];
  const jpeg = (...parts) => Uint8Array.from([...SOI, ...parts.flatMap((p) => [...p]), ...SOS, 0x12, 0x34]);

  it("reads a big-endian orientation straight after SOI", () => {
    for (let o = 1; o <= 8; o++) expect(jpegOrientation(jpeg(exifSegment(o)))).toBe(o);
  });

  it("reads a little-endian orientation after a JFIF header", () => {
    expect(jpegOrientation(jpeg(JFIF, exifSegment(6, { littleEndian: true })))).toBe(6);
  });

  it("is 1 when there is no EXIF block", () => {
    expect(jpegOrientation(jpeg(JFIF))).toBe(1);
  });

  it("ignores an EXIF block after the image data starts", () => {
    const b = Uint8Array.from([...SOI, ...SOS, ...exifSegment(6)]);
    expect(jpegOrientation(b)).toBe(1);
  });

  it("skips an APP1 that is XMP, not EXIF", () => {
    const xmp = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0<x/>");
    const seg = [0xff, 0xe1, (xmp.length + 2) >> 8, (xmp.length + 2) & 0xff, ...xmp];
    expect(jpegOrientation(jpeg(seg, exifSegment(8)))).toBe(8);
    expect(jpegOrientation(jpeg(seg))).toBe(1);
  });

  it("finds the tag among other IFD0 entries", () => {
    // An EXIF block with a second entry (ImageWidth) ahead of Orientation.
    const tiff = new Uint8Array(38);
    const dv = new DataView(tiff.buffer);
    tiff.set([0x4d, 0x4d], 0);
    dv.setUint16(2, 42);
    dv.setUint32(4, 8);
    dv.setUint16(8, 2);
    dv.setUint16(10, 0x0100);
    dv.setUint16(12, 3);
    dv.setUint32(14, 1);
    dv.setUint16(18, 640);
    dv.setUint16(22, 0x0112);
    dv.setUint16(24, 3);
    dv.setUint32(26, 1);
    dv.setUint16(30, 3);
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const two = [0xff, 0xe1, 0, payload.length + 2, ...payload];
    expect(jpegOrientation(jpeg(two))).toBe(3);
  });

  it("is 1 for an out-of-range value", () => {
    expect(jpegOrientation(jpeg(exifSegment(9)))).toBe(1);
    expect(jpegOrientation(jpeg(exifSegment(0)))).toBe(1);
  });

  it("is 1 when the tag is not a SHORT", () => {
    const seg = exifSegment(6);
    seg[4 + 6 + 13] = 4; // past the APP1 header and the Exif marker: the type field, now LONG
    expect(jpegOrientation(jpeg(seg))).toBe(1);
  });

  it("is 1, not an exception, for truncated or corrupt input", () => {
    const whole = jpeg(exifSegment(6));
    for (let n = 0; n < whole.length; n++) {
      expect(() => jpegOrientation(whole.subarray(0, n))).not.toThrow();
    }
    expect(jpegOrientation(Uint8Array.from([...SOI, 0xff, 0xe1, 0, 1]))).toBe(1);
    expect(jpegOrientation(Uint8Array.from([...SOI, 0x00, 0x00]))).toBe(1);
  });

  it("does not read past a segment that claims more bytes than there are", () => {
    const seg = exifSegment(6);
    seg[2] = 0xff; // length far beyond the buffer
    expect(jpegOrientation(jpeg(seg))).toBe(1);
  });
});

describe("orientationTransform", () => {
  // Where the stored image's corners land: apply [a b c d e f] to the unit
  // square's corners. The stored top-left pixel is at (u, v) = (0, 1).
  const apply = ([a, b, c, d, e, f], [u, v]) => [a * u + c * v + e, b * u + d * v + f];
  const STORED_TOP_LEFT = [0, 1];

  it("leaves orientation 1 as pdf-lib's own drawImage would", () => {
    expect(orientationTransform(1, 40, 20)).toEqual({ width: 40, height: 20, matrix: [40, 0, 0, 20, 0, 0] });
  });

  it("treats a missing or unknown orientation as 1", () => {
    for (const o of [undefined, 0, 9, 1.5]) {
      expect(orientationTransform(o, 40, 20)).toEqual({ width: 40, height: 20, matrix: [40, 0, 0, 20, 0, 0] });
    }
  });

  it("swaps the page's sides for the quarter turns, 5 to 8", () => {
    for (const o of [5, 6, 7, 8]) expect(orientationTransform(o, 40, 20)).toMatchObject({ width: 20, height: 40 });
    for (const o of [2, 3, 4]) expect(orientationTransform(o, 40, 20)).toMatchObject({ width: 40, height: 20 });
  });

  it("maps the unit square exactly onto the page for every orientation", () => {
    for (let o = 1; o <= 8; o++) {
      const { width, height, matrix } = orientationTransform(o, 40, 20);
      const xs = [];
      const ys = [];
      for (const corner of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const [x, y] = apply(matrix, corner);
        xs.push(x);
        ys.push(y);
      }
      expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, width, 0, height]);
    }
  });

  it("puts the stored top-left pixel where the tag says (page y grows upward)", () => {
    const where = (o) => {
      const { width, height, matrix } = orientationTransform(o, 40, 20);
      const [x, y] = apply(matrix, STORED_TOP_LEFT);
      return `${x === 0 ? "left" : x === width ? "right" : "?"}-${y === height ? "top" : y === 0 ? "bottom" : "?"}`;
    };
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(where)).toEqual([
      "left-top", "right-top", "right-bottom", "left-bottom",
      "left-top", "right-top", "right-bottom", "left-bottom",
    ]);
  });
});
