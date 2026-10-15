import { pathToFileURL } from "url";
import path from "path";

// This file exists ONLY to make tests work. In the real app (served by
// Vite's dev server or built for production), the `?url` import in
// pdfRender.js resolves correctly on its own — verified separately by
// curling the running dev server and confirming a 200 response for the
// worker asset. Vitest, however, doesn't run through Vite's asset-serving
// middleware, so that same import resolves to a site-root path like
// "/node_modules/pdfjs-dist/..." which Node can't actually load. This
// shim (wired up via a vitest.config.js alias) gives tests a real,
// resolvable file:// URL instead, so the rest of pdfRender.js's logic can
// be exercised against the genuine pdf.js worker.
export default pathToFileURL(
  path.resolve(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs")
).href;
