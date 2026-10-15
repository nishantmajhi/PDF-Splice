<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { renderPageToCanvas } from "@/lib/pdfRender";

// Full-size viewer opened by clicking any thumbnail in the app. Works in two
// modes: "pdf" (renders a pdf.js page at high resolution, and "<<"/">>" walk
// through that document's pages) or "image" (steps through a plain list of
// image URLs, used by the Extract Images grid).
const props = defineProps({
  viewer: { type: Object, required: true },
});
const emit = defineEmits(["navigate-pdf", "navigate-image", "close"]);

const isPdf = computed(() => props.viewer.mode === "pdf");
const canvasRef = ref(null);
const loaded = ref(false);

const current = computed(() => (isPdf.value ? props.viewer.pageNumber : props.viewer.index + 1));
const total = computed(() => (isPdf.value ? props.viewer.pageCount : props.viewer.images.length));
const atFirst = computed(() => current.value <= 1);
const atLast = computed(() => current.value >= total.value);

let cancelCurrent = null;

function render() {
  cancelCurrent?.();
  cancelCurrent = null;
  if (!isPdf.value || !canvasRef.value) return;
  loaded.value = false;

  const task = renderPageToCanvas(props.viewer.pdfDoc, props.viewer.pageNumber, canvasRef.value, 900);
  cancelCurrent = () => task.cancel();

  task.promise
    .then(() => {
      loaded.value = true;
    })
    .catch((err) => {
      if (err?.name !== "RenderingCancelledException") {
        console.error("Page viewer render failed:", err);
      }
    });
}

// The very first render has to happen from onMounted, not from watch's
// `immediate` option: even with `flush: "post"`, a watcher's immediate
// callback fires before the <canvas> template ref is populated on first
// mount, so `canvasRef.value` is still null and the guard above bails
// out silently, leaving the viewer spinning forever. The (non-immediate)
// watcher below only needs to handle *later* changes (navigating to a
// different page), by which point the canvas element already exists.
onMounted(render);
watch(() => [isPdf.value, props.viewer.pdfDoc, props.viewer.pageNumber], render, { flush: "post" });
onUnmounted(() => cancelCurrent?.());

function goPrev() {
  if (atFirst.value) return;
  if (isPdf.value) emit("navigate-pdf", props.viewer.pageNumber - 1);
  else emit("navigate-image", props.viewer.index - 1);
}

function goNext() {
  if (atLast.value) return;
  if (isPdf.value) emit("navigate-pdf", props.viewer.pageNumber + 1);
  else emit("navigate-image", props.viewer.index + 1);
}

function handleKey(e) {
  if (e.key === "Escape") emit("close");
  else if (e.key === "ArrowLeft") goPrev();
  else if (e.key === "ArrowRight") goNext();
}

onMounted(() => window.addEventListener("keydown", handleKey));
onUnmounted(() => window.removeEventListener("keydown", handleKey));
</script>

<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="page-viewer-card" @click.stop>
      <button class="modal-close" aria-label="Close" @click="emit('close')">×</button>

      <div class="page-viewer-canvas-wrap">
        <template v-if="isPdf">
          <div v-if="!loaded" class="spinner" aria-hidden="true" />
          <canvas ref="canvasRef" :style="{ display: loaded ? 'block' : 'none' }" />
        </template>
        <img
          v-else
          :src="viewer.images[viewer.index].url"
          :alt="viewer.images[viewer.index].label || `Image ${current}`"
        />
      </div>

      <div class="page-viewer-nav">
        <button
          type="button"
          class="page-viewer-btn"
          :disabled="atFirst"
          aria-label="Previous"
          @click="goPrev"
        >
          &lt;&lt;
        </button>
        <span class="page-viewer-count">{{ current }} of {{ total }}</span>
        <button
          type="button"
          class="page-viewer-btn"
          :disabled="atLast"
          aria-label="Next"
          @click="goNext"
        >
          &gt;&gt;
        </button>
      </div>
    </div>
  </div>
</template>
