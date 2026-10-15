<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import { TrashIcon, AlertIcon } from "@/components/icons";
import { renderPageToCanvas } from "@/lib/pdfRender";

// A draggable grid card representing one PDF in the merge queue. Shows a
// real thumbnail of its first page, matching the look of the Split /
// PDF-to-Image page grids, and can be reordered by dragging.
const props = defineProps({
  file: { type: Object, required: true },
  index: { type: Number, required: true },
  isDragging: { type: Boolean, default: false },
});
const emit = defineEmits(["drag-start", "drag-over", "drag-end", "drop", "remove", "preview"]);

const canvasRef = ref(null);
const loaded = ref(false);
const failed = ref(false);

let cancelCurrent = null;

function render() {
  cancelCurrent?.();
  cancelCurrent = null;

  if (!props.file.pdfDoc || !canvasRef.value) return;

  loaded.value = false;
  failed.value = false;

  const task = renderPageToCanvas(props.file.pdfDoc, 1, canvasRef.value);
  cancelCurrent = () => task.cancel();

  // Must cancel the in-flight render, not just ignore it — otherwise a
  // second render can start on the same canvas before this one finishes,
  // and pdf.js rejects both, leaving the thumbnail blank forever.
  task.promise
    .then(() => {
      loaded.value = true;
    })
    .catch((err) => {
      if (err?.name !== "RenderingCancelledException") {
        console.error("Page render failed:", err);
        failed.value = true;
      }
    });
}

// The very first render has to happen from onMounted, not from watch's
// `immediate` option: even with `flush: "post"`, a watcher's immediate
// callback fires before the <canvas> template ref is populated on first
// mount, so `canvasRef.value` is still null and the guard above bails
// out silently — with nothing to retrigger it, that permanently left
// the thumbnail stuck on its skeleton. The (non-immediate) watcher below
// only needs to handle *later* prop changes, by which point the canvas
// element already exists.
onMounted(render);
watch(() => props.file.pdfDoc, render, { flush: "post" });
onUnmounted(() => cancelCurrent?.());

function onCardClick() {
  emit("preview", props.file);
}
</script>

<template>
  <div
    class="merge-card"
    :class="{ dragging: isDragging }"
    draggable="true"
    role="button"
    tabindex="0"
    :title="`Preview ${file.name}`"
    @click="onCardClick"
    @keydown="
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCardClick();
        }
      }
    "
    @dragstart="emit('drag-start', $event)"
    @dragover="emit('drag-over', $event)"
    @drop="emit('drop', $event)"
    @dragend="emit('drag-end', $event)"
  >
    <div class="page-card">
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
        :style="{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px' }"
      >
        <AlertIcon :size="20" />
        <span :style="{ fontSize: '10px', color: 'var(--muted2)', textAlign: 'center' }">
          Preview failed
        </span>
      </div>
      <canvas ref="canvasRef" :style="{ display: loaded ? 'block' : 'none' }" />
      <span class="page-num">{{ String(index + 1).padStart(2, "0") }}</span>
      <button
        type="button"
        class="icon-btn"
        aria-label="Remove file"
        @click.stop="emit('remove', index)"
      >
        <TrashIcon />
      </button>
    </div>
    <p class="merge-card-name" :title="file.name">{{ file.name }}</p>
    <p class="merge-card-meta">{{ file.pageCount }} page{{ file.pageCount === 1 ? "" : "s" }}</p>
  </div>
</template>
