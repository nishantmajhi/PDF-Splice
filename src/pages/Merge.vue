<script setup>
import { ref, shallowRef, computed } from "vue";
import { PDFDocument } from "pdf-lib";
import NavBar from "@/components/NavBar.vue";
import UploadShell from "@/components/UploadShell.vue";
import MergeFileCard from "@/components/MergeFileCard.vue";
import InsertPreviewModal from "@/components/InsertPreviewModal.vue";
import PrintToPdfModal from "@/components/PrintToPdfModal.vue";
import { DownloadIcon, PlusIcon } from "@/components/icons";
import { loadPdfDocument } from "@/lib/pdfRender";
import { mergePdfs } from "@/lib/pdfOps";
import { downloadBlob } from "@/lib/download";

// shallowRef: each entry nests a pdf.js document (native private class
// fields) — a plain ref() would deep-wrap those in a reactive Proxy and
// break their internal methods. Every mutation below already reassigns
// `.value` wholesale, so shallowRef costs nothing here. See
// pageViewer.js for the full explanation.
const files = shallowRef([]); // { id, name, bytes, pageCount, pdfDoc, excludedPages }
const exporting = ref(false);
const draggedIndex = ref(null);
const previewFile = shallowRef(null);
const addInputRef = ref(null);
const blockedFilename = ref(null); // a file that could not be opened, for the modal

async function loadEntry(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const [doc, pdfDoc] = await Promise.all([
    PDFDocument.load(bytes),
    loadPdfDocument(bytes.slice()),
  ]);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    bytes,
    pageCount: doc.getPageCount(),
    pdfDoc,
    excludedPages: new Set(),
  };
}

// Files dropped together arrive as one call each, all at once. They load
// in parallel, but join the queue in the order they were chosen: each
// waits for the one chosen before it, so a large first file cannot be
// overtaken by a small second one.
let queued = Promise.resolve();

function addFile(file) {
  const loading = loadEntry(file);
  queued = queued.then(async () => {
    try {
      const entry = await loading;
      files.value = [...files.value, entry];
    } catch (err) {
      // Encrypted, damaged, or not a PDF. The rest of a batch still
      // goes in; the first file refused is the one named.
      console.error("Could not add PDF:", err);
      if (!blockedFilename.value) blockedFilename.value = file.name;
    }
  });
  return queued;
}

function removeFile(index) {
  files.value = files.value.filter((_, i) => i !== index);
}

// Toggles whether a specific 1-indexed page of a specific queued file will
// be included in the merged output. Rebuilds the file's entry immutably
// (rather than mutating its excludedPages Set in place) so both `files`
// and, if that same file is currently open in the preview modal,
// `previewFile` pick up the change.
function togglePageExclusion(fileId, pageNumber) {
  const next = files.value.map((f) => {
    if (f.id !== fileId) return f;
    const excludedPages = new Set(f.excludedPages);
    if (excludedPages.has(pageNumber)) excludedPages.delete(pageNumber);
    else excludedPages.add(pageNumber);
    return { ...f, excludedPages };
  });
  files.value = next;
  if (previewFile.value && previewFile.value.id === fileId) {
    previewFile.value = next.find((f) => f.id === fileId);
  }
}

// Native HTML5 drag-and-drop reorder: as the dragged card passes over
// another card, swap it into that position immediately for live feedback.
function handleDragStart(index) {
  return (e) => {
    draggedIndex.value = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };
}

function handleDragOver(index) {
  return (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedIndex.value === null || draggedIndex.value === index) return;
    const next = [...files.value];
    const [moved] = next.splice(draggedIndex.value, 1);
    next.splice(index, 0, moved);
    files.value = next;
    draggedIndex.value = index;
  };
}

function handleDrop(e) {
  e.preventDefault();
}

function handleDragEnd() {
  draggedIndex.value = null;
}

async function handleExport() {
  if (files.value.length < 2 || effectiveTotalPages.value === 0) return;
  exporting.value = true;
  try {
    const bytes = await mergePdfs(
      files.value.map((f) => ({ bytes: f.bytes, excludedPages: f.excludedPages }))
    );
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), "merged.pdf");
  } catch (err) {
    console.error("Merge export failed:", err);
  } finally {
    exporting.value = false;
  }
}

const totalPages = computed(() => files.value.reduce((sum, f) => sum + f.pageCount, 0));
const excludedCount = computed(() =>
  files.value.reduce((sum, f) => sum + f.excludedPages.size, 0)
);
const effectiveTotalPages = computed(() => totalPages.value - excludedCount.value);

function onAddInputChange(e) {
  const file = e.target.files && e.target.files[0];
  if (file) addFile(file);
  e.target.value = "";
}
</script>

<template>
  <div class="page">
    <NavBar />

    <UploadShell
      v-if="files.length === 0"
      title="Drop PDFs to merge"
      subtitle="Add two or more files, then drag to arrange the order. Click a file to open its pages and exclude any with the trash icon."
      multiple
      @file-chosen="addFile"
    />

    <template v-else>
      <div class="grid">
        <MergeFileCard
          v-for="(file, i) in files"
          :key="`${file.name}-${i}`"
          :file="file"
          :index="i"
          :is-dragging="draggedIndex === i"
          @drag-start="handleDragStart(i)($event)"
          @drag-over="handleDragOver(i)($event)"
          @drop="handleDrop"
          @drag-end="handleDragEnd"
          @remove="removeFile"
          @preview="previewFile = $event"
        />
        <button type="button" class="merge-add-card" @click="addInputRef?.click()">
          <PlusIcon :size="20" />
          <span>Add PDF</span>
        </button>
        <input
          ref="addInputRef"
          type="file"
          accept="application/pdf"
          hidden
          @change="onAddInputChange"
        />
      </div>

      <div class="dock">
        <div class="dock-left">
          <div>
            <h1 class="dock-title">Merge {{ files.length }} files</h1>
            <p class="dock-meta">
              {{
                excludedCount === 0
                  ? `${totalPages} pages total`
                  : effectiveTotalPages === 0
                    ? "Every page is excluded — nothing to merge"
                    : `${effectiveTotalPages} of ${totalPages} pages total · ${excludedCount} excluded`
              }}
            </p>
          </div>
        </div>
        <button
          class="export-btn"
          :disabled="exporting || files.length < 2 || effectiveTotalPages === 0"
          @click="handleExport"
        >
          <DownloadIcon />
          {{ exporting ? "Merging…" : "Export PDF" }}
        </button>
      </div>
    </template>

    <InsertPreviewModal
      v-if="previewFile"
      :file="previewFile"
      :excluded-pages="previewFile.excludedPages"
      @close="previewFile = null"
      @toggle-exclude="togglePageExclusion(previewFile.id, $event)"
    />

    <PrintToPdfModal
      v-if="blockedFilename"
      :filename="blockedFilename"
      @close="blockedFilename = null"
    />
  </div>
</template>
