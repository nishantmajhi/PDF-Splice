// The app as a user gets it: built by Vite, served from a loopback port,
// driven in a real Chrome.
//
//   npm run test:browser              (CHROME=/path/to/chrome to choose one)
//   npm run test:browser -- --original  build and check main instead
//
// jsdom runs the components, but it is not a browser. It has no Web
// Worker, so pdf.js runs on the main thread there; it has no EXIF-aware
// image decoder; and it cannot download anything. The checks here are the
// ones that depend on those: that the bundled worker loads and is shared,
// that an inserted phone photo comes out the way Chrome itself shows it,
// and that each tool's download holds what it should. Every request to
// another origin is failed, so this also shows nothing is fetched from a
// CDN.
//
// With --original, the same checks run against a build of main. They are
// expected to fail exactly where that code was wrong; the run reports the
// checks that failed.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { encryptPdfBytes } from "../helpers/encryptedPdf.js";
import { orientedJpeg, nearestQuadrant } from "../helpers/exifJpeg.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGINAL = process.argv.includes("--original");

// What a build of main gets wrong, by check name.
const EXPECTED_ON_MAIN = [
  "an inserted portrait photo is drawn the way Chrome itself shows it",
  "Splice's export has the photo as a portrait page after page 1",
  "Splice turns away a PDF it could preview but not modify",
  "Merge queues a dropped batch in the order it was chosen",
  "six documents share one pdf.js worker",
  "Merge's export has the files' pages in queue order",
];

const CHROMES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build this tree, or main's, into a temporary directory.
async function buildApp() {
  let root = ROOT;
  let cleanup = () => {};
  if (ORIGINAL) {
    // Inside the project, so that bare imports resolve to this node_modules.
    root = path.join(ROOT, ".against-original");
    fs.rmSync(root, { recursive: true, force: true });
    const git = (...a) => execFileSync("git", a, { cwd: ROOT, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
    // main, or origin/main in a clone made with --branch, which has no local main.
    const ref = ["main", "origin/main"].find((r) => {
      try {
        return git("rev-parse", "--verify", "--quiet", `${r}^{commit}`), true;
      } catch {
        return false;
      }
    });
    if (!ref) throw new Error("neither main nor origin/main exists here");
    const files = git("ls-tree", "-r", "--name-only", ref, "index.html", "src", "public")
      .toString()
      .split("\n")
      .filter(Boolean);
    for (const file of files) {
      fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), git("show", `${ref}:${file}`));
    }
    cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-splice-dist-"));
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [vue()],
    resolve: { alias: { "@": path.join(root, "src") } },
    build: { outDir, emptyOutDir: true },
  });
  cleanup();
  return outDir;
}

function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    let file = path.join(dir, rel);
    // A history-mode SPA: unknown paths get index.html.
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(dir, "index.html");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function launch(exe) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-splice-chrome-"));
  const proc = spawn(
    exe,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"],
    { stdio: "ignore" }
  );
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(50);
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  // Chrome holds its profile open until it has exited, so wait for that
  // before deleting it; otherwise a profile is left in the temp directory.
  const exited = new Promise((r) => proc.once("exit", r));
  const close = async () => {
    ws.close();
    proc.kill();
    await Promise.race([exited, sleep(5000)]);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  return { send, on: (l) => listeners.push(l), close };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n     ${String(e.message).split("\n").join("\n     ")}`);
  }
}

const exe = CHROMES.find((p) => fs.existsSync(p));
if (!exe) {
  console.log("SKIP: no Chrome found; set CHROME to its path");
  process.exit(0);
}

const dist = await buildApp();
const server = await serve(dist);
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = await launch(exe);
const { send } = chrome;

const foreign = [];
chrome.on((msg) => {
  if (msg.method !== "Fetch.requestPaused") return;
  const { requestId, request } = msg.params;
  if (request.url.startsWith(origin) || request.url.startsWith("blob:") || request.url.startsWith("data:")) {
    send("Fetch.continueRequest", { requestId });
  } else {
    foreign.push(request.url);
    send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
  }
});
const errors = [];
chrome.on((msg) => {
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    errors.push(d.exception?.description || d.text);
  }
});
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
await send("Runtime.enable");
await send("Page.enable");
// Before any app code: count the Web Workers the page starts, and capture
// downloads instead of saving them.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__workers = 0;
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      constructor(...args) { super(...args); window.__workers++; }
    };
    window.__saved = [];
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = createObjectURL(blob); window.__lastBlob = blob; return url; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("download")) { window.__saved.push({ name: this.download, blob: window.__lastBlob }); return; }
      return click.call(this);
    };
  `,
});

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(what, expression, ms = 20000) {
  const t = Date.now();
  while (!(await evaluate(expression))) {
    if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}
async function open(route) {
  await send("Page.navigate", { url: `${origin}${route}` });
  await until("the app", `document.readyState === "complete" && !!document.querySelector(".navbar")`);
}
// Hands files to the <input type=file> matching `selector`, as a drop would.
async function choose(selector, files) {
  const payload = files.map(({ name, bytes, type }) => ({ name, type, b64: Buffer.from(bytes).toString("base64") }));
  await evaluate(`(() => {
    const dt = new DataTransfer();
    for (const f of ${JSON.stringify(payload)}) {
      dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type || "" }));
    }
    const input = document.querySelector(${JSON.stringify(selector)});
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    return true;
  })()`);
}
async function download() {
  await until("the download", `window.__saved.length > 0`, 30000);
  const { name, b64 } = await evaluate(`(async () => {
    const { name, blob } = window.__saved.shift();
    const u = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { name, b64: btoa(s) };
  })()`);
  return { name, bytes: new Uint8Array(Buffer.from(b64, "base64")) };
}
// A JS expression counting the thumbnails under `scope` that pdf.js has finished drawing.
const drawn = (scope) =>
  `[...document.querySelectorAll(${JSON.stringify(scope + " canvas")})].filter((c) => c.style.display === "block" && c.width > 0).length`;

async function pdf(widths, height = 300) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, height]).drawRectangle({ x: 10, y: 10, width: 40, height: 40 });
  return doc.save();
}
const widthsOf = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));
// Colour at the centre of each quadrant of a canvas-like drawing, as [TL, TR, BL, BR].
const QUADRANT_JS = `(ctx, w, h) => [[w / 4, h / 4], [3 * w / 4, h / 4], [w / 4, 3 * h / 4], [3 * w / 4, 3 * h / 4]]
  .map(([x, y]) => Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)))`;

try {
  await open("/");

  // ---- Splice ----
  await choose(".upload-card input[type=file]", [{ name: "master.pdf", bytes: await pdf([200, 210, 220]) }]);
  await check("Splice renders a thumbnail of every page", async () => {
    await until("three thumbnails", `${drawn(".grid")} === 3`);
  });

  // Rendering needs pdf.js's worker, so by now it has loaded.
  await check("the app and its pdf.js worker came from this origin alone", async () => {
    assert.ok((await evaluate(`window.__workers`)) >= 1, "no Web Worker was started");
    assert.deepEqual(foreign.filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  });

  const photo = await orientedJpeg(6);
  await check("an inserted portrait photo is drawn the way Chrome itself shows it", async () => {
    await evaluate(`document.querySelectorAll(".gap-collapsed")[1].click(); true`);
    await until("the drop zone", `!!document.querySelector(".gap-drop input[type=file]")`);
    await choose(".gap-drop input[type=file]", [{ name: "IMG_0006.jpg", bytes: photo, type: "image/jpeg" }]);
    await until("the inserted page's thumbnail", `(() => { const c = document.querySelector(".gap-drop-filled canvas"); return !!c && c.style.display === "block"; })()`);
    const inPdf = await evaluate(`(() => {
      const c = document.querySelector(".gap-drop-filled canvas");
      return { w: c.width, h: c.height, q: (${QUADRANT_JS})(c.getContext("2d"), c.width, c.height) };
    })()`);
    const b64 = Buffer.from(photo).toString("base64");
    const inChrome = await evaluate(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, q: (${QUADRANT_JS})(ctx, bmp.width, bmp.height) };
    })()`);
    assert.ok(inChrome.h > inChrome.w, `Chrome decodes the photo as ${inChrome.w}x${inChrome.h}, not portrait`);
    assert.ok(inPdf.h > inPdf.w, `the inserted page is ${inPdf.w}x${inPdf.h}, not portrait`);
    assert.deepEqual(inPdf.q.map(nearestQuadrant), inChrome.q.map(nearestQuadrant));
  });

  await check("Splice's export has the photo as a portrait page after page 1", async () => {
    await evaluate(`document.querySelector(".export-btn").click(); true`);
    const { name, bytes } = await download();
    assert.equal(name, "master-spliced.pdf");
    const doc = await PDFDocument.load(bytes);
    const sizes = doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
    assert.deepEqual(sizes, [[200, 300], [20, 40], [210, 300], [220, 300]]);
  });

  await open("/");
  const locked = await encryptPdfBytes(await pdf([200, 210]));
  await check("Splice turns away a PDF it could preview but not modify", async () => {
    await choose(".upload-card input[type=file]", [{ name: "statement.pdf", bytes: locked }]);
    await until("the print-to-PDF modal", `!!document.querySelector(".modal-card")`, 5000);
    assert.match(await evaluate(`document.querySelector(".modal-card").textContent`), /statement\.pdf/);
  });

  // ---- Merge ----
  await open("/merge");
  const workersBefore = await evaluate(`window.__workers`);
  // The first file's contents arrive last, as a large file's would from a
  // slow disk, so the order the files finish loading in is not the order
  // they were chosen in. (Relying on size alone made that a coin toss.)
  await evaluate(`(() => {
    const read = Blob.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      const p = read.call(this);
      return this.name === "f0.pdf" ? p.then((b) => new Promise((r) => setTimeout(() => r(b), 300))) : p;
    };
    return true;
  })()`);
  const batch = [];
  for (let i = 0; i < 6; i++) batch.push({ name: `f${i}.pdf`, bytes: await pdf([100 + i, 100 + i]) });
  await choose(".upload-card input[type=file]", batch);
  await until("six cards", `document.querySelectorAll(".merge-card").length === 6`, 60000);
  await until("six thumbnails", `${drawn(".merge-card")} === 6`, 60000);

  await check("Merge queues a dropped batch in the order it was chosen", async () => {
    const names = await evaluate(`[...document.querySelectorAll(".merge-card-name")].map((e) => e.textContent)`);
    assert.deepEqual(names, ["f0.pdf", "f1.pdf", "f2.pdf", "f3.pdf", "f4.pdf", "f5.pdf"]);
  });

  await check("six documents share one pdf.js worker", async () => {
    const started = (await evaluate(`window.__workers`)) - workersBefore;
    assert.ok(started <= 1, `${started} workers started for six documents`);
  });

  await check("Merge's export has the files' pages in queue order", async () => {
    await evaluate(`document.querySelector(".export-btn").click(); true`);
    const { name, bytes } = await download();
    assert.equal(name, "merged.pdf");
    assert.deepEqual(await widthsOf(bytes), [100, 100, 101, 101, 102, 102, 103, 103, 104, 104, 105, 105]);
  });

  // ---- Split ----
  await open("/split");
  await choose(".upload-card input[type=file]", [{ name: "doc.pdf", bytes: await pdf([10, 20, 30, 40]) }]);
  await until("the cut points", `document.querySelectorAll(".gap-collapsed").length === 3`);
  await check("Split's export is a ZIP of the ranges between the cuts", async () => {
    await evaluate(`document.querySelectorAll(".gap-collapsed")[1].click(); true`);
    await evaluate(`document.querySelector(".export-btn").click(); true`);
    const { name, bytes } = await download();
    assert.equal(name, "doc-split.zip");
    const zip = await JSZip.loadAsync(bytes);
    assert.deepEqual(Object.keys(zip.files).sort(), ["split-1-2.pdf", "split-3-4.pdf"]);
    assert.deepEqual(await widthsOf(await zip.files["split-3-4.pdf"].async("uint8array")), [30, 40]);
  });

  // ---- PDF to Image ----
  await open("/pdf-to-image");
  await choose(".upload-card input[type=file]", [{ name: "pages.pdf", bytes: await pdf([100, 100]) }]);
  await until("the thumbnails", `${drawn(".grid")} === 2`);
  await check("PDF to Image downloads one real PNG per page", async () => {
    await evaluate(`document.querySelector(".export-btn").click(); true`);
    const { name, bytes } = await download();
    assert.equal(name, "pages-images.zip");
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).sort();
    assert.deepEqual(names, ["pages-page-01.png", "pages-page-02.png"]);
    const png = await zip.files[names[0]].async("uint8array");
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  });

  await check("the page threw no script errors", () => assert.deepEqual(errors, []));
} catch (e) {
  // A wait between checks gave up; report it rather than stopping silently.
  results.push({ name: "the run completed", ok: false });
  console.log(`FAIL the run completed\n     ${e.message}`);
} finally {
  await chrome.close();
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).map((r) => r.name);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${ORIGINAL ? " against main" : ""}`);
if (ORIGINAL) {
  // main must fail exactly the checks for the defects this branch fixes.
  const unexpected = failed.filter((n) => !EXPECTED_ON_MAIN.includes(n));
  const missing = EXPECTED_ON_MAIN.filter((n) => !failed.includes(n));
  for (const n of unexpected) console.log(`unexpected failure on main: ${n}`);
  for (const n of missing) console.log(`expected to fail on main, but passed: ${n}`);
  process.exitCode = unexpected.length || missing.length ? 1 : 0;
  if (!process.exitCode) console.log(`main fails exactly the ${EXPECTED_ON_MAIN.length} checks it should`);
} else {
  process.exitCode = failed.length ? 1 : 0;
}
