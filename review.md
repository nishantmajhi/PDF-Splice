# Review — PDF Splice

First pass 2026-09-04. Remediated 2026-09-30 on `cleanup/2026-09-30` (not
pushed): eleven defects fixed in the app and four in its test suite, 298 tests
up from 205, 37 regression tests checked against `main`, and a real-Chrome
suite of 11 checks.

## Corrections to the first review

The first review's findings are kept at the bottom. Read these before it: five
of its claims were wrong, or right about the wrong place.

**1. Its first P2 was already done, and the risk it described cannot happen.**
It asked to confirm the pdf.js worker is bundled rather than loaded from a CDN,
and to pin `pdfjs-dist` exactly, "since a minor bump can change the worker
contract". `pdfRender.js` already imported the worker with Vite's `?url`. A
production build emits `assets/pdf.worker.min-*.mjs` beside the library chunk,
both carrying version `4.10.38`, and nothing in `dist/` names a CDN. The
library and the worker come from the same installed package, so no upgrade can
make them disagree, and `package-lock.json` already fixes the version. Nothing
was pinned. The worker *did* have a real problem, a different one: see defect 8.

**2. "Metadata carries through the splice" is the wrong way round.** Every
export (splice, split and merge alike) is a new `PDFDocument.create()` with
pages copied into it. Measured: a source with a title and an author exports
with neither, and with pdf-lib as the Producer. There was nothing to strip, so
no "strip metadata" option was added. What *is* lost, and the review did not
mention, is everything else at document level: bookmarks, and working form
fields. A filled form keeps its appearance but has no fields. The README now
says so.

**3. "Confirm blob URLs are revoked" pointed at the wrong file.** `download.js`
revokes. Extract Images' preview URLs were the ones never revoked (defect 9).

**4. "One of the best-tested projects in the archive."** The 205 tests did pass
on a warm working copy. But:

- nothing in them inserted an image, so image conversion had no tests at all
  (defects 6 and 7);
- nothing combined exclusions with page numbers or counts (1 and 2);
- nothing dropped more than one file at a time on Merge (3);
- no page was given a file it could not open (4 and 5);
- one test asserted `formatBytes`'s missing guard as the expected result, for
  a function nothing used;
- **checked out fresh, `main`'s own suite fails two tests**, on timing.

TESTING.md claimed every path to an empty export was guarded; defect 1 was an
unguarded one.

**5. The scope named Splice only.** The app has five pages. Defects 3, 5, 9 and
10 are on the four the review did not list.

Its findings on encrypted PDFs (P2) and large documents (P3) were real. The
first was worse than it said and is fixed; the second is not (see "Left
alone").

## Fixed

Each has a `regression:` test that `npm run test:original` requires to fail
against `main`, except 8, which only a real browser can see; the browser suite
covers it.

1. **Splice counted inserted files, not pages.** The total and the excluded
   count used different units. A three-page insert after a one-page master
   read "2 of 2 pages". Excluding the master page and one inserted page gave
   "nothing to export" and a disabled Export button, with two pages left.
   Excluding everything gave "-2 of 2 pages" with Export *enabled*.
2. **Splice's page labels ignored exclusions.** Each thumbnail shows the page
   number it will have in the export, and every exclusion shifted every label
   after it by one. Moved into `lib/spliceNumbering.js`. An excluded page now
   shows the number of the next page that is kept.
3. **Merge queued a dropped batch in the order the files finished loading.**
   In real Chrome, six identical files came out f1, f0, f2…. Files still load
   in parallel but join the queue in the order chosen.
4. **Encrypted PDFs failed silently at Export.** pdf.js previews an
   owner-password ("view but don't edit") PDF; pdf-lib refuses to load it.
   Splice, Split and Merge let the user arrange such a file, then did nothing
   on Export. `assertEditable` now opens every PDF with pdf-lib when it is
   added.
5. **No page reported a file it could not open.** A password-protected,
   damaged or non-PDF file left an unhandled rejection and an unchanged upload
   shell on all five pages. Splice already had the print-to-PDF modal for
   inserts; now every page shows it. **This is the on-screen change**, see
   below.
6. **Images were embedded by file extension.** A PNG or WebP saved as `.jpg`,
   which browsers do routinely, threw "SOI not found" and got the
   "print it to PDF" advice. The first bytes decide now (`lib/imageBytes.js`).
7. **Photos came out sideways.** pdf-lib ignores EXIF orientation, so a
   portrait phone photo became a landscape page, preview included. Now each
   of the eight orientations is drawn through its own matrix, with the JPEG
   still embedded unchanged. Checked by rendering and reading pixels, and in
   Chrome against Chrome's own decode of the same file.
8. **Every PDF opened started its own Web Worker, never stopped.** Six files
   on Merge meant six worker threads, each with its own 1.4 MB script. One
   worker is now shared through `GlobalWorkerOptions.workerPort`.
9. **Extract Images never revoked its preview URLs.** Every scan's images, as
   lossless PNGs, stayed in memory for the life of the tab. They are released
   when the page is left. A scan still running then stops, and the image
   viewer closes if it was showing them.
10. **Exported image names broke order past 99.** A plain string sort put
    `page-100` between `page-10` and `page-11`. Names now pad to the largest
    number; smaller documents keep their old names.
11. **`npm run lint` could not run.** There was no ESLint config. Once it had
    one, ESLint 8 still skipped all 28 `.vue` files and reported clean. Both
    are fixed, and it reports nothing.

In the test suite:

- **Two tests failed on any fresh checkout**, `main` included. Their 5 s wait
  was timing pdf.js's and node-canvas's one-time start-up, not the render.
  `warmPdfjs` does that in a `beforeAll`.
- `formatBytes` and its tests are removed: it was dead code.
- A `console.log("DEBUG:")` in a Split test is now an assertion that nothing
  was logged.
- jsdom printed a "Not implemented: navigation" stack trace for every export,
  sixteen per run, burying real errors. It is gone.

## On-screen changes

Recorded in `CLEANUP-LOG.md` as the fifth exception to "business logic only":

- **Split, Merge, PDF to Image and Extract Images show the print-to-PDF modal
  when a file cannot be opened**, and Splice shows it for the master file as
  well as for inserts. It is the existing component with its existing copy,
  unchanged. Before, these files were silently ignored. Commits `3b7b86e`
  (Splice) and `11cf6dc` (the other four).
- Splice's page labels and page count change once something is excluded or a
  multi-page file is inserted, because they were wrong (defects 1 and 2).

## Left alone, and why

- **Every thumbnail still renders at once.** The review's P3. Lazy rendering
  would need an IntersectionObserver in `PageThumbnail`, the component whose
  mount timing has already been broken and fixed twice (see its comments).
  That is a performance feature, not a fix. Documented as a limit in the
  README.
- **Removed documents are never destroyed.** With one shared worker a removed
  file costs memory, not a thread. Destroying it safely means knowing that the
  shared viewer is not showing it, which it can be after the Back button.
- **`downloadBlob` revokes the URL straight after `click()`.** That is fine in
  Chrome, the only browser here. Older Safari is known to need a delay, but
  that could not be verified, so it was not changed.
- **Image pages are one point per pixel**, so a 12-megapixel photo is a page
  56 inches wide. The code chose that deliberately. Documented.
- **PDF to Image does not guard against pages too big for a canvas.** It
  renders at twice the page size, so a very large page (a poster or a plan)
  can exceed the browser's canvas limit, and then `toBlob` gives `null`. Rare,
  and not tested here.
- **Export failures after the load-time check still go to the console only.**
  Every known cause is now refused when the file is added.
- **`LICENSE`.** Choosing one is the author's decision. The README says none
  has been chosen.
- **Split names each file by its range** (`split-1-3.pdf`) even when pages in
  it are excluded. That is what the cuts define.

## Unresolved

- On one of three from-scratch clones, the first suite run failed two tests
  that were not captured by name. Every run since has passed: four more cold
  clone runs and three consecutive ones, 298 of 298 each time. It was probably
  the timing issue above, on an unusually cold disk, but that is unconfirmed.
- One browser-suite run ended without its summary, before it could report a
  stopped run. The cause was not found; a stop is now reported as a failure,
  and eight runs since have been clean.

## Checking it

```sh
npm ci
npm test                         # 298 tests, about a minute
npm run test:original            # 37/37 regression tests fail on main
npm run test:browser             # 11/11 in Chrome
npm run test:browser -- --original   # main fails exactly 6
npm run lint                     # nothing
```

Every commit was checked out into its own worktree and tested there. Before
the warm-up commit, the only failures at any commit were the two pre-existing
timing tests; from it on, every test passes. The branch was also cloned fresh
with a real `npm ci`, and every command above passed there.

## Notes for the next session

- `tests/helpers/encryptedPdf.js` builds a real encrypted PDF with nothing
  but pdf-lib and `node:crypto`. `exifJpeg.js` builds a JPEG with any EXIF
  orientation. Both are worth copying.
- To render a page that contains an image under jsdom, use
  `helpers/renderPdf.js`. pdf.js's Node canvas factory (`@napi-rs/canvas`)
  cannot be drawn by jsdom's node-canvas, which fails with "Image or Canvas
  expected".
- `tests/browser/run.mjs` wraps `Worker` before the app loads, to count the
  threads it starts. That is how defect 8 was measured.

---

## First-pass review (2026-09-04)

Its findings and checklist as written; its cleanup and session notes are
superseded by the sections above.

### What this project is

A browser PDF toolkit built around one idea: insert pages by clicking the visual gap where you want
them to land. Every page renders as a thumbnail with a splice point between each pair; click one and
it expands into a drop zone, and the dropped file is converted to a PDF page and inserted in
position. No splitting, recombining, or page-number bookkeeping, and nothing leaves the browser.

### Verdict

The strongest Vue project here, and one of the best-tested projects in the archive. The test setup
alone is worth describing: Vitest with `@vue/test-utils` and jsdom, organised into unit, component and
integration directories with a shared helpers folder — and the real `canvas` npm package wired in so
PDF rendering is genuinely exercised rather than mocked. Mocking canvas would have been the easy
choice and would have made the render tests worthless. There is also a dedicated `TESTING.md`
explaining how to run it.

The product idea is good too. The README frames it precisely: traditional workflows make you split,
insert, recombine and track page numbers, and this replaces all of that with clicking a gap. That is a
real observation about a real annoyance.

The library layer (`pdfOps`, `pdfRender`, `pageViewer`, `fileHelpers`, `download`) is cleanly
separated from components, which is what makes the unit tests possible.

### Findings

**1. `pdfjs-dist` and `pdf-lib` are heavyweight and their worker setup is version-sensitive.**
`pdfjs-dist` requires its worker file to match the main library exactly; a mismatch after an upgrade
produces a confusing runtime failure. Confirm the worker is bundled by Vite rather than loaded from a
CDN, and pin `pdfjs-dist` exactly rather than with a caret, since a minor bump can change the worker
contract.

**2. Large PDFs need a guard.** Rendering every page as a thumbnail means decoding every page. A
500-page scanned document at thumbnail resolution is still 500 canvas renders and 500 retained
bitmaps. Two mitigations: render thumbnails lazily as they scroll into view, and release each
canvas after producing its bitmap. Check whether `pageViewer.js` already does the former — if it
does, say so in a comment, because it is the kind of thing a later refactor removes by accident.

**3. Encrypted and corrupted PDFs need explicit handling.** A password-protected PDF makes `pdf-lib`
throw, and the user needs "this PDF is password protected" rather than a generic failure. Same for a
PDF that renders but cannot be modified. There is an `AlertIcon` component, so error presentation
exists — make sure these two specific cases reach it with their own messages.

**4. Metadata carries through the splice.** `pdf-lib` preserves the document catalogue when
manipulating pages, so author, creation date and producer from the original survive into the output,
and the inserted page may bring its own. For a tool people will use on documents they then send
somewhere, an option to strip metadata on export would be a genuinely useful feature — and your
sibling project, the Office Metadata Editor, shows you already think about this.

**5. Confirm blob URLs are revoked.** `download.js` presumably creates object URLs for the output.
Each un-revoked URL pins its blob — a whole PDF — in memory for the lifetime of the page. In an app
where a user splices repeatedly before downloading, that accumulates.

**6. No `LICENSE`.** The most conspicuous gap in an otherwise complete project.

### Action checklist (first pass)

- [ ] **P2** Pin `pdfjs-dist` exactly; verify the worker is bundled, not CDN-loaded. — *Bundled already; pinning unnecessary. See correction 1.*
- [x] **P2** Add explicit handling and messages for encrypted and corrupted PDFs. — *Defects 4 and 5.*
- [ ] **P3** Confirm thumbnails render lazily and canvases are released; guard very large documents. — *Not lazy; left alone, documented.*
- [x] **P3** Offer metadata stripping on export; verify object URLs are revoked. — *No metadata carries over (correction 2); the unrevoked URLs were in Extract Images, fixed.*
- [ ] **P3** Add a `LICENSE`. — *The author's decision.*

## Licence, 2026-10-02

The author chose one licence for all of their projects: free for personal,
non-commercial use, modifiable for the user's own use, and not to be
distributed, original or modified. No standard licence says that, so `LICENSE`
is a short custom text, the same in every project apart from the year and what
it excludes. The README's licence section says the same, and `package.json`
declares `SEE LICENSE IN LICENSE`, npm's form for a licence with no SPDX
identifier. Anything above that calls the licence an open question, or calls
the project MIT, is superseded.

## CI, 2026-10-02

`.github/workflows/ci.yml` runs `npm run lint` and `npm test`, and the browser
suite as a second job, on `ubuntu-latest`. Nothing has been pushed, so it has
not run on GitHub yet. Every job was run before committing, from a fresh clone
of this branch, the way a runner would run it: Linux jobs in a throwaway
Ubuntu 24.04 (the image `ubuntu-latest` uses) with the same tool versions.
lint clean, 298, and 11 in the browser.

The two slowest tests wait 5 s for an exported blob and have failed once under
load here (see above); if they flake on GitHub, raising that timeout is the
fix. The browser job fails if the runner prints `SKIP`, which it does when it
finds no Chrome; otherwise a missing browser would read as a pass.
