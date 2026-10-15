// Facts about an image file read from its bytes rather than its name.
// No DOM and no pdf-lib here, so all of it is testable on plain arrays.

// What the file actually is, from its signature: "png", "jpeg", or null
// for anything else. The extension is not evidence - browsers save WebP
// and PNG images under a .jpg name often enough that trusting it turned
// ordinary downloads into "we can't convert this file".
export function sniffImageType(bytes) {
  const b = bytes;
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "jpeg";
  }
  return null;
}

// The EXIF Orientation (tag 0x0112) of a JPEG, 1-8, or 1 if there is none
// or anything about it is malformed. Phones store a portrait photo as the
// sensor read it - landscape - and set this tag so viewers turn it; every
// browser and photo viewer honours it, so it is what the user has seen.
export function jpegOrientation(bytes) {
  const b = bytes;
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  let at = 2; // after SOI
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return 1;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return 1; // image data or end: no EXIF before it
    const length = u16(at + 2);
    if (length < 2) return 1;
    const start = at + 4;
    const end = at + 2 + length;
    if (
      marker === 0xe1 &&
      end <= b.length &&
      b[start] === 0x45 && b[start + 1] === 0x78 && b[start + 2] === 0x69 &&
      b[start + 3] === 0x66 && b[start + 4] === 0 && b[start + 5] === 0 // "Exif\0\0"
    ) {
      return tiffOrientation(b.subarray(start + 6, end));
    }
    at = end;
  }
  return 1;
}

function tiffOrientation(t) {
  if (t.length < 8) return 1;
  let little;
  if (t[0] === 0x49 && t[1] === 0x49) little = true;
  else if (t[0] === 0x4d && t[1] === 0x4d) little = false;
  else return 1;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  if (dv.getUint16(2, little) !== 42) return 1;
  const ifd = dv.getUint32(4, little);
  if (ifd + 2 > t.length) return 1;
  const count = dv.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > t.length) return 1;
    if (dv.getUint16(entry, little) !== 0x0112) continue;
    if (dv.getUint16(entry + 2, little) !== 3) return 1; // must be a SHORT
    const value = dv.getUint16(entry + 8, little);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

// How to draw a `width` x `height` stored image so it appears as EXIF
// `orientation` says it should. Returns the page size the image then
// occupies and the PDF matrix [a b c d e f] that maps the image's unit
// square onto it. In that unit square the first row of stored pixels is at
// the top (v = 1) and the first column at the left (u = 0).
//
// Orientations 5-8 turn the image a quarter, so the page is height x width.
// Each matrix follows from where the tag puts the stored image's first row
// and first column (e.g. 6: first row down the right edge, first column
// along the top).
export function orientationTransform(orientation, width, height) {
  const quarter = orientation >= 5 && orientation <= 8;
  const W = quarter ? height : width; // displayed width
  const H = quarter ? width : height; // displayed height
  const matrices = {
    2: [-W, 0, 0, H, W, 0],
    3: [-W, 0, 0, -H, W, H],
    4: [W, 0, 0, -H, 0, H],
    5: [0, -H, -W, 0, W, H],
    6: [0, -H, W, 0, 0, H],
    7: [0, H, W, 0, 0, 0],
    8: [0, H, -W, 0, W, 0],
  };
  const matrix = matrices[orientation];
  if (!matrix) return { width, height, matrix: [width, 0, 0, height, 0, 0] };
  return { width: W, height: H, matrix };
}
