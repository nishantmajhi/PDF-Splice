// A real JPEG with four coloured quadrants and an EXIF orientation tag,
// the way a phone stores a photo: the pixels as the sensor read them, and
// a tag telling viewers how to turn them.
//
// Stored (as the bytes lie):   red    | green
//                              blue   | yellow

export const QUADRANTS = { R: [220, 30, 30], G: [30, 180, 30], B: [30, 30, 220], Y: [230, 220, 30] };

const css = ([r, g, b]) => `rgb(${r},${g},${b})`;

// An APP1 segment holding a minimal EXIF block: a TIFF header and IFD0
// with the one Orientation (0x0112) entry.
export function exifSegment(orientation, { littleEndian = false } = {}) {
  const tiff = new Uint8Array(26);
  const dv = new DataView(tiff.buffer);
  tiff.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  dv.setUint16(2, 42, littleEndian);
  dv.setUint32(4, 8, littleEndian); // IFD0 offset
  dv.setUint16(8, 1, littleEndian); // one entry
  dv.setUint16(10, 0x0112, littleEndian); // Orientation
  dv.setUint16(12, 3, littleEndian); // SHORT
  dv.setUint32(14, 1, littleEndian); // count
  dv.setUint16(18, orientation, littleEndian);
  dv.setUint32(22, 0, littleEndian); // no next IFD

  const payload = new Uint8Array([...new TextEncoder().encode("Exif"), 0, 0, ...tiff]);
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...payload]);
}

// Puts `segment` straight after SOI, or after the JFIF APP0 if `afterApp0`.
export function insertSegment(jpeg, segment, { afterApp0 = false } = {}) {
  let at = 2;
  if (afterApp0 && jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, at), 0);
  out.set(segment, at);
  out.set(jpeg.subarray(at), at + segment.length);
  return out;
}

export async function quadrantJpeg(width = 40, height = 20) {
  const { createCanvas } = await import("canvas");
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const w = width / 2;
  const h = height / 2;
  ctx.fillStyle = css(QUADRANTS.R);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = css(QUADRANTS.G);
  ctx.fillRect(w, 0, w, h);
  ctx.fillStyle = css(QUADRANTS.B);
  ctx.fillRect(0, h, w, h);
  ctx.fillStyle = css(QUADRANTS.Y);
  ctx.fillRect(w, h, w, h);
  return new Uint8Array(canvas.toBuffer("image/jpeg", { quality: 0.95 }));
}

export async function orientedJpeg(orientation, opts) {
  return insertSegment(await quadrantJpeg(), exifSegment(orientation, opts), opts);
}

// Which named colour a pixel is nearest to.
export function nearestQuadrant([r, g, b]) {
  let best = null;
  let bestD = Infinity;
  for (const [name, [qr, qg, qb]] of Object.entries(QUADRANTS)) {
    const d = (r - qr) ** 2 + (g - qg) ** 2 + (b - qb) ** 2;
    if (d < bestD) [best, bestD] = [name, d];
  }
  return best;
}
