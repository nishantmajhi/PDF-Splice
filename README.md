# PDF Splice

Insert pages into a PDF by clicking the gap where they should go.

The usual way to add a page to the middle of a PDF is to split the file,
insert the page, and join the pieces again, keeping track of page numbers
throughout. PDF Splice shows every page as a thumbnail with a **+** in each
gap between them. Click a gap, drop in a PDF or an image, and it lands there.
Each thumbnail is labelled with the page number it will have in the finished
file.

It is a Vue 3 single-page app, and everything happens in the browser. Files
are read, rendered and rewritten locally and never uploaded anywhere.

## The tools

| Page | Route | What it does |
| --- | --- | --- |
| **Splice** | `/` | Insert PDFs or images into a PDF at any gap. Several files can queue at one gap and be dragged into order. Any page, of the original or of an inserted file, can be excluded. |
| **Split** | `/split` | Mark cut points between pages. Exports one PDF per range, as a ZIP when there is more than one. |
| **Merge** | `/merge` | Combine two or more PDFs in the order shown. Drag to reorder; open a file to exclude its pages. |
| **PDF to Image** | `/pdf-to-image` | Render each page to a PNG at twice its size. One page downloads as a PNG, more as a ZIP. |
| **Extract Images** | `/extract-images` | Pull out the raster images embedded in a PDF (not a rendering of the page), each as a PNG. |

Every tool has a bin icon on each page or image to leave it out of the export.

### What goes in

- **PDFs.** Each is opened with pdf-lib as soon as it is added, so a file that
  cannot be modified is turned away before any work goes into it, not at
  Export.
- **Images** (Splice only). A PNG or JPEG becomes a one-page PDF the size of
  the image, one point per pixel, with its bytes embedded unchanged. The file's
  contents decide which it is, not its name, so a PNG saved as `.jpg` works. A
  JPEG is drawn the way its EXIF orientation says, so a portrait phone photo
  comes out portrait. GIF, WebP, BMP and anything else the browser can decode
  are drawn to a canvas and embedded as PNG.
- **Anything else** (Word, PowerPoint, Excel, text) cannot be converted in a
  browser. The app explains how to print it to PDF from the program that
  opens it, then upload the result.

The same explanation appears for a PDF that cannot be used as it is:

- one that needs a password to open;
- one that is damaged;
- one encrypted against editing. pdf.js can display such a file, but pdf-lib
  cannot modify it, so Splice, Split and Merge refuse it. PDF to Image and
  Extract Images only read, and accept it.

Printing from a PDF viewer writes a fresh, unencrypted copy, which is the fix
in all three cases.

### What comes out

Every export is a **new document** built from the chosen pages. Each page
keeps its content and annotations, but nothing that belongs to the document
as a whole is carried over:

- no title, author or other metadata (none leaks from the original either);
- no bookmarks;
- no working form fields. A filled-in form keeps its appearance but can no
  longer be edited.

## Running it

Needs Node 18 or later.

```sh
npm ci
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve dist/
```

The build is a static site with history-mode routing. Whatever serves it must
answer unknown paths with `index.html`, or reloading `/merge` gives a 404.

`index.html` loads the Inter and Space Grotesk fonts from Google Fonts. That is
the only request to another origin. Without it the text falls back to system
fonts and everything still works.

## How it works

- **pdf.js** (`pdfjs-dist`) renders thumbnails and previews, and walks page
  content to find embedded images. Its worker is bundled by Vite and served
  from the app's own origin, from the same package as the library, so the two
  cannot drift apart. Every document shares one worker.
- **pdf-lib** does all the modifying: splicing, splitting, merging, and
  turning images into pages.
- **JSZip** packs multi-file exports.

The decisions live in `src/lib/`, apart from the components, so they can be
tested without a browser:

| File | Decides |
| --- | --- |
| `pdfOps.js` | splice, split, merge; image to PDF; whether pdf-lib can modify a file |
| `imageBytes.js` | what an image file is, and its EXIF orientation and drawing matrix |
| `spliceNumbering.js` | the page number each thumbnail on Splice shows |
| `pdfRender.js` | loading pdf.js and its worker, rendering pages, finding embedded images |
| `fileHelpers.js` | file-type checks, print-to-PDF steps per extension, numbered file names |
| `download.js` | single-file and ZIP downloads |
| `pageViewer.js` | the shared full-size viewer every thumbnail opens |

## Limits

- **Every thumbnail renders at once.** A document of several hundred pages
  takes a while to appear and holds a canvas per page.
- **An image page is one point per pixel.** A 12-megapixel photo becomes a
  page about 56 inches wide. Viewers and printers scale it to fit, but it will
  not match the size of the document's other pages.
- Only tested in Chrome. Anything recent that supports module workers should
  work.

## Tests

```sh
npm test                # Vitest + jsdom, about 300 tests, under a minute
npm run test:original   # each regression test must fail against main
npm run test:browser    # the built app in a real Chrome; skips without one
npm run lint
```

`TESTING.md` describes the setup: real pdf.js and pdf-lib throughout, real
canvases, and the handful of jsdom gaps that had to be filled.

## Project layout

```
src/
  pages/          one component per tool
  components/     thumbnails, gaps, cut points, modals, icons
  lib/            the logic, framework-free (see above)
  router.js, App.vue, main.js, globals.css
tests/
  unit/           src/lib
  component/      one file per component
  integration/    one file per page: real files in, real downloads out
  helpers/        PDF, encrypted-PDF and EXIF-JPEG builders; router; rendering
  browser/        the real-Chrome suite
  against-original.mjs
```

## Licence

Free for personal, non-commercial use. You may use, study and modify this
software for yourself, but you may not use it commercially, and you may not
share or publish it, in its original form or modified. See [LICENSE](LICENSE)
for the full terms.
