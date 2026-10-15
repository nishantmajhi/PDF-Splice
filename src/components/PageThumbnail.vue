<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import { renderPageToCanvas } from "@/lib/pdfRender";
import { AlertIcon } from "@/components/icons";
import { usePageViewer } from "@/lib/pageViewer";

const props = defineProps({
  pdfDoc: { type: Object, default: null },
  pageNumber: { type: Number, required: true },
  displayNumber: { type: [Number, String], required: true },
  onOpen: { type: Function, default: null },
});

const canvasRef = ref(null);
const loaded = ref(false);
const failed = ref(false);
const { openPdfViewer } = usePageViewer();

let cancelCurrent = null;

function render() {
  cancelCurrent?.();
  cancelCurrent = null;

  if (!props.pdfDoc || !canvasRef.value) return;

  loaded.value = false;
  failed.value = false;

  const task = renderPageToCanvas(props.pdfDoc, props.pageNumber, canvasRef.value);
  cancelCurrent = () => task.cancel();

  task.promise
    .then(() => {
      loaded.value = true;
    })
    .catch((err) => {
      // RenderingCancelledException is expected whenever we cancel below
      // (e.g. a fast re-render or unmount) — only surface *real* failures.
      if (err?.name !== "RenderingCancelledException") {
        console.error("Page render failed:", err);
        failed.value = true;
      }
    });
}

// Cancelling the in-flight pdf.js render task (not just ignoring its
// result) is required — otherwise a second render can start on the same
// canvas before this one finishes, and pdf.js rejects both.
//
// The very first render has to happen from onMounted, not from watch's
// `immediate` option: even with `flush: "post"`, a watcher's immediate
// callback fires before the <canvas> template ref is populated on first
// mount, so `canvasRef.value` is still null and the guard above bails out
// silently — with no pdfDoc/pageNumber change ever coming to retrigger
// it, that permanently left the thumbnail stuck on its skeleton. The
// (non-immediate) watcher below only needs to handle *later* prop
// changes, by which point the canvas element already exists.
onMounted(render);
watch(() => [props.pdfDoc, props.pageNumber], render, { flush: "post" });
onUnmounted(() => cancelCurrent?.());

// By default, clicking a thumbnail opens the single-page "<<"/">>"
// viewer. Callers (e.g. the Splice master-doc grid) can pass `onOpen` to
// redirect the click to something else instead, such as the all-pages
// thumbnail popup used on the Merge page.
function openViewer(e) {
  e.stopPropagation();
  if (props.onOpen) {
    props.onOpen();
  } else {
    openPdfViewer(props.pdfDoc, props.pageNumber, props.pdfDoc?.numPages);
  }
}
</script>

<template>
  <div
    class="page-card"
    role="button"
    tabindex="0"
    :aria-label="`View page ${displayNumber}`"
    @click="openViewer"
    @keydown="
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openViewer(e);
        }
      }
    "
  >
    <div v-if="!loaded && !failed" class="skeleton">
      <div class="line" :style="{ width: '80%', marginTop: '4px' }" />
      <div class="line" :style="{ width: '100%' }" />
      <div class="line" :style="{ width: '60%' }" />
      <div class="line light" :style="{ width: '100%', marginTop: '12px' }" />
      <div class="line light" :style="{ width: '66%' }" />
    </div>
    <div
      v-if="failed"
      class="skeleton"
      :style="{ alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', gap: '6px' }"
    >
      <AlertIcon :size="20" />
      <span :style="{ fontSize: '10px', color: 'var(--muted2)', textAlign: 'center' }">
        Preview failed
      </span>
    </div>
    <canvas ref="canvasRef" :style="{ display: loaded ? 'block' : 'none' }" />
    <span class="page-num">{{ String(displayNumber).padStart(2, "0") }}</span>
  </div>
</template>
