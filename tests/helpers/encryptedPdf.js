import { createHash } from "node:crypto";
import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
} from "pdf-lib";

// Builds a real encrypted PDF: the Standard security handler, revision 2,
// 40-bit RC4 (ISO 32000-1 §7.6.3, algorithms 2, 3 and 4). pdf-lib can read
// the structure of such a file but refuses to load it, and pdf.js decrypts
// and renders it. That split is the whole point of the fixture: the app
// previews these files with pdf.js and then has to modify them with
// pdf-lib.
//
// With an empty `userPassword` the file opens without a prompt, the way a
// "permissions only" PDF from a bank or a government form does. With a
// non-empty one, pdf.js refuses to open it at all.
//
// Revision 2 rather than AES because it needs nothing but MD5 and a
// fifteen-line RC4, and every reader supports it; the app's behaviour
// depends only on the presence of /Encrypt, not on the cipher.

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function md5(...parts) {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

function padPassword(pw) {
  const bytes = new TextEncoder().encode(pw).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PAD.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function encryptStringsIn(obj, key) {
  if (obj instanceof PDFDict) {
    for (const [name, value] of obj.entries()) {
      const next = encryptStringsIn(value, key);
      if (next !== value) obj.set(name, next);
    }
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const value = obj.get(i);
      const next = encryptStringsIn(value, key);
      if (next !== value) obj.set(i, next);
    }
  } else if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return PDFHexString.of(hex(rc4(key, obj.asBytes())));
  }
  return obj;
}

export async function encryptPdfBytes(plainBytes, { userPassword = "", ownerPassword = "owner" } = {}) {
  // Reserialise without object streams first, so every object is a plain
  // indirect object that can be encrypted with its own key.
  const flat = await (await PDFDocument.load(plainBytes)).save({ useObjectStreams: false });
  const doc = await PDFDocument.load(flat, { updateMetadata: false });
  const { context } = doc;

  const permissions = -4; // every permission bit set
  const fileId = md5(new TextEncoder().encode("pdf-splice test fixture"));

  const ownerKey = md5(padPassword(ownerPassword)).subarray(0, 5);
  const O = rc4(ownerKey, padPassword(userPassword));

  const P = new Uint8Array(new Int32Array([permissions]).buffer);
  const fileKey = md5(padPassword(userPassword), O, P, fileId).subarray(0, 5);
  const U = rc4(fileKey, PAD);

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const objKey = md5(
      fileKey,
      Uint8Array.of(ref.objectNumber & 0xff, (ref.objectNumber >> 8) & 0xff, (ref.objectNumber >> 16) & 0xff),
      Uint8Array.of(ref.generationNumber & 0xff, (ref.generationNumber >> 8) & 0xff)
    ).subarray(0, 10);

    if (obj instanceof PDFRawStream) {
      encryptStringsIn(obj.dict, objKey);
      context.assign(ref, PDFRawStream.of(obj.dict, rc4(objKey, obj.contents)));
    } else {
      encryptStringsIn(obj, objKey);
    }
  }

  const encryptDict = context.obj({
    Filter: PDFName.of("Standard"),
    V: PDFNumber.of(1),
    R: PDFNumber.of(2),
    Length: PDFNumber.of(40),
    O: PDFHexString.of(hex(O)),
    U: PDFHexString.of(hex(U)),
    P: PDFNumber.of(permissions),
  });
  context.trailerInfo.Encrypt = context.register(encryptDict);
  const id = PDFHexString.of(hex(fileId));
  context.trailerInfo.ID = context.obj([id, id]);

  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
