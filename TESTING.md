# Testing

```sh
npm test                # the suite, once
npm run test:watch      # the suite, re-run on change
npm run test:original   # regression tests against the original code
npm run test:browser    # the built app in a real Chrome
```

## The suite

Vitest with `@vue/test-utils` and jsdom. Nothing that matters is mocked:
tests build real PDFs and images in memory, load them through the real
pdf.js and pdf-lib, render them onto real canvases (the `canvas` package
backs jsdom's 2D context), and open the files each page downloads to check
what is in them.

```
tests/
  setup.js              jsdom gaps, filled (below)
  unit/                 src/lib, one file per module, plus the fixtures' own checks
  component/            one file per reusable component
  integration/          one file per page, mounted with a router: files in, downloads out
  helpers/
    samplePdf.js        PDFs whose page widths identify each page after a splice or merge
    encryptedPdf.js     a real encrypted PDF (RC4, standard security handler)
    exifJpeg.js         a four-colour JPEG with any EXIF orientation
    renderPdf.js        renders a page that contains an image (see below)
    testRouter.js       mount helpers; every page needs a router for its NavBar
    workerUrlShim.js    where pdf.js's worker is under Vitest
  against-original.mjs
  browser/run.mjs
```

Two fixtures are built rather than committed, and each has tests of its own
so that the tests using it cannot pass for the wrong reason:

- `encryptPdfBytes` encrypts a pdf-lib document the way a "view but do not
  edit" PDF is encrypted. `tests/unit/encryptedPdf.test.js` checks that pdf.js
  decrypts it back to the original text and that pdf-lib refuses it *as
  encrypted*.
- `orientedJpeg(n)` is a real JPEG, red/green over blue/yellow, with an EXIF
  Orientation of `n`. The orientation tests render the resulting page and read
  its pixels. They compare against a table written out from the tag's
  definition, not against the same arithmetic as the code.

## Regression tests

A test named `regression: ...` reproduces a defect that has been fixed.
`npm run test:original` writes `main`'s `src/` out of git into
`.against-original/`, points the suite's `@` alias at it (`PDF_SPLICE_SRC` in
`vitest.config.js`), and requires every regression test to pass on this code
and fail on that one. `ORIGINAL_REF=<commit>` compares with another commit.

## The browser suite

`tests/browser/run.mjs` builds the app with Vite, serves it from a loopback
port with every other origin's requests failed, and drives the installed
Chrome over the DevTools protocol, using Node's own `WebSocket` and no extra
dependency. It covers what jsdom cannot:

- the Web Worker, which is shared between documents;
- Chrome's EXIF-aware image decoder, which an inserted photo is compared with;
- real downloads.

`--original` builds `main` instead and requires it to fail exactly the
checks for the defects fixed since. With no Chrome installed it prints SKIP
and exits 0. Set `CHROME` to use a particular one.

## jsdom gaps

Every real browser has these; jsdom does not. Each is filled in
`tests/setup.js` or a helper, and none changes what the app does:

- `HTMLCanvasElement.prototype.toBlob`, bridged to the canvas package's
  `toDataURL`;
- `Blob.prototype.arrayBuffer`;
- `URL.createObjectURL` / `revokeObjectURL`, stubbed;
- `ImageData`, taken from the canvas package, which pdf.js needs to paint a
  page with a raster image on it;
- clicking a download link, which jsdom would try to navigate, printing a
  stack trace every time;
- `File.arrayBuffer`: tests pass a minimal file object (`toFakeFile`) instead
  of a jsdom `File`;
- `Path2D`, which pdf.js uses to draw text: tests that read pixels use
  text-free pages;
- `Worker`: pdf.js falls back to running its worker code on the main thread,
  from `workerUrlShim.js`'s `file://` URL, because Vitest does not serve
  Vite's `?url` assets.

One gap is in pdf.js rather than jsdom. Under Node it makes its scratch
canvases with `@napi-rs/canvas`, which jsdom's context cannot draw from, so any
page with an image on it fails to render with "Image or Canvas expected".
`helpers/renderPdf.js` opens such documents with a canvas factory that hands
pdf.js jsdom canvases, as a browser's DOM canvases would be.

## Timing

A thumbnail test waits on a real pdf.js render onto a real canvas, which can
take a few seconds the first time a file runs. Those waits use a 5 s
`vi.waitFor` timeout, not the 1 s default. Copy that pattern for any new
"wait for a real render" assertion.
