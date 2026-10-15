<script setup>
import { ref, computed } from "vue";
import { PlusIcon, XIcon, UploadIcon, GripIcon } from "@/components/icons";
import PageThumbnail from "@/components/PageThumbnail.vue";

const props = defineProps({
  gapIndex: { type: Number, required: true },
  inserts: { type: Array, default: () => [] },
  isActive: { type: Boolean, default: false },
  isConverting: { type: Boolean, default: false },
  pageNumbers: { type: Object, default: null }, // Map: item.id -> { start, end }
});

const emit = defineEmits([
  "activate",
  "cancel",
  "file-chosen",
  "remove",
  "reorder",
  "preview-insert",
]);

const dragOver = ref(false);
const pendingIndex = ref(0); // boundary (0..inserts.length) where the next upload lands
const draggingId = ref(null);
const dropTargetId = ref(null);
// Set through a function ref in the template: a string ref inside the
// v-for below would become an array, and .click() on it would do nothing.
const fileInputRef = ref(null);

const hasInserts = computed(() => props.inserts.length > 0);

function beginAdd(boundary) {
  pendingIndex.value = boundary;
  emit("activate", props.gapIndex);
}

function chooseFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length) emit("file-chosen", props.gapIndex, files, pendingIndex.value);
}

function labelFor(item) {
  const range = props.pageNumbers?.get(item.id);
  if (!range) return null;
  return range.end > range.start ? `${range.start}\u2013${range.end}` : `${range.start}`;
}

function plusLabel(boundary) {
  if (!hasInserts.value) return "Insert a file here";
  if (boundary === 0) return "Add files before the queued ones";
  if (boundary === props.inserts.length) return "Add files after the queued ones";
  return "Add files between these two";
}

// Interleave a "+" at every boundary (before the first file, between each
// pair, and after the last) with a box per queued file. Whichever boundary
// is currently being added to shows the upload dropzone instead of a "+" —
// everything else queued here stays exactly as it was.
const nodes = computed(() => {
  const arr = [];
  for (let boundary = 0; boundary <= props.inserts.length; boundary++) {
    if (props.isActive && boundary === pendingIndex.value) {
      arr.push({ type: "dropzone", boundary });
    } else {
      arr.push({ type: "plus", boundary });
    }
    if (boundary < props.inserts.length) {
      arr.push({ type: "item", boundary, item: props.inserts[boundary] });
    }
  }
  return arr;
});
</script>

<template>
  <!-- Nothing queued yet, and not currently picking a file: collapsed "+" gap. -->
  <button
    v-if="!hasInserts && !isActive"
    type="button"
    class="gap-collapsed"
    :aria-label="plusLabel(0)"
    @click="beginAdd(0)"
  >
    <div class="gap-line" />
    <div class="gap-plus">
      <PlusIcon />
    </div>
  </button>

  <template v-else>
    <template v-for="node in nodes" :key="node.type === 'item' ? node.item.id : `${node.type}-${node.boundary}`">
      <!-- The "+" that sits at a given boundary -->
      <button
        v-if="node.type === 'plus'"
        type="button"
        class="gap-collapsed"
        :aria-label="plusLabel(node.boundary)"
        @click="beginAdd(node.boundary)"
      >
        <div class="gap-line" />
        <div class="gap-plus">
          <PlusIcon />
        </div>
      </button>

      <!-- The active upload dropzone, shown at whichever boundary was clicked -->
      <div
        v-else-if="node.type === 'dropzone'"
        class="gap-drop"
        :class="{ dragover: dragOver, 'gap-drop-stacked': hasInserts }"
        @click="fileInputRef?.click()"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="dragOver = false; chooseFiles($event.dataTransfer.files)"
      >
        <button
          type="button"
          class="icon-btn"
          aria-label="Cancel insert"
          @click.stop="emit('cancel', gapIndex)"
        >
          <XIcon />
        </button>
        <p v-if="isConverting" class="hint">Preparing…</p>
        <template v-else>
          <UploadIcon />
          <p class="hint">Drop files, or</p>
          <button type="button" class="browse-link" @click.stop="fileInputRef?.click()">
            browse
          </button>
          <p class="subhint">PDF, image, or doc</p>
          <p v-if="hasInserts" class="subhint">
            Adding {{ node.boundary === 0 ? "before" : node.boundary === inserts.length ? "after" : "between" }} the queued file{{ inserts.length === 1 ? "" : "s" }}
          </p>
        </template>
        <input
          :ref="(el) => (fileInputRef = el)"
          type="file"
          multiple
          hidden
          @change="chooseFiles($event.target.files); $event.target.value = ''"
        />
      </div>

      <!-- A single queued file's box -->
      <div
        v-else
        class="gap-drop gap-drop-filled"
        :class="{ dragging: draggingId === node.item.id, 'drop-target': dropTargetId === node.item.id }"
        :title="node.item.name"
        draggable="true"
        @dragstart="draggingId = node.item.id; $event.dataTransfer.effectAllowed = 'move'"
        @dragend="draggingId = null; dropTargetId = null"
        @dragover="
          (e) => {
            if (draggingId && draggingId !== node.item.id) {
              e.preventDefault();
              dropTargetId = node.item.id;
            }
          }
        "
        @dragleave="dropTargetId = dropTargetId === node.item.id ? null : dropTargetId"
        @drop="
          (e) => {
            e.preventDefault();
            if (draggingId && draggingId !== node.item.id) {
              emit('reorder', gapIndex, draggingId, node.item.id);
            }
            draggingId = null;
            dropTargetId = null;
          }
        "
      >
        <div class="grip-handle" aria-hidden="true">
          <GripIcon />
        </div>
        <button
          type="button"
          class="icon-btn"
          :aria-label="`Remove ${node.item.name}`"
          @click.stop="emit('remove', gapIndex, node.item.id)"
        >
          <XIcon />
        </button>
        <PageThumbnail
          :pdf-doc="node.item.pdfDoc"
          :page-number="1"
          :display-number="labelFor(node.item) ?? node.boundary + 1"
          :on-open="
            () =>
              emit('preview-insert', {
                gapIndex,
                id: node.item.id,
                name: node.item.name,
                pdfDoc: node.item.pdfDoc,
                pageCount: node.item.pageCount,
                excludedPages: node.item.excludedPages,
              })
          "
        />
        <span class="ready-badge">Ready</span>
      </div>
    </template>
  </template>
</template>
