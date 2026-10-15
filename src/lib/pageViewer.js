import { shallowReactive } from "vue";

// A single module-level reactive store, mounted once at the app root (see
// App.vue). Any thumbnail, anywhere in the app, can call openPdfViewer /
// openImageViewer to pop the same full-size viewer with "<<"/">>"
// navigation — no prop-drilling or provide/inject needed per page.
//
// shallowReactive (not reactive) is required here: `viewer` holds a pdf.js
// PDFDocumentProxy, which uses native private class fields internally. A
// deep reactive() proxy wraps that object too, and calling its methods
// through the proxy breaks — private field access throws
// "Cannot read private member ... from an object whose class did not
// declare it", since `this` inside the method becomes the Proxy instead of
// the real instance. shallowReactive keeps `state.viewer` itself reactive
// (so reassigning it still triggers updates) without touching what's
// inside it.
const state = shallowReactive({ viewer: null });

export function usePageViewer() {
  function openPdfViewer(pdfDoc, pageNumber, pageCount) {
    if (!pdfDoc) return;
    state.viewer = {
      mode: "pdf",
      pdfDoc,
      pageNumber,
      pageCount: pageCount ?? pdfDoc.numPages,
    };
  }

  function openImageViewer(images, index) {
    if (!images || images.length === 0) return;
    state.viewer = { mode: "image", images, index };
  }

  function closeViewer() {
    state.viewer = null;
  }

  function goToPdfPage(pageNumber) {
    if (state.viewer && state.viewer.mode === "pdf") {
      state.viewer = { ...state.viewer, pageNumber };
    }
  }

  function goToImageIndex(index) {
    if (state.viewer && state.viewer.mode === "image") {
      state.viewer = { ...state.viewer, index };
    }
  }

  return {
    viewerState: state,
    openPdfViewer,
    openImageViewer,
    closeViewer,
    goToPdfPage,
    goToImageIndex,
  };
}
