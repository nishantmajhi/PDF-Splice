<script setup>
import { ref, shallowRef, computed } from "vue";
import NavBar from "@/components/NavBar.vue";
import PageThumbnail from "@/components/PageThumbnail.vue";
import RemoveBadge from "@/components/RemoveBadge.vue";
import SpliceGap from "@/components/SpliceGap.vue";
import UploadShell from "@/components/UploadShell.vue";
import PrintToPdfModal from "@/components/PrintToPdfModal.vue";
import InsertPreviewModal from "@/components/InsertPreviewModal.vue";
import { DocIcon, DownloadIcon } from "@/components/icons";
import { loadPdfDocument } from "@/lib/pdfRender";
import { assertEditable, convertToPdfBytes, spliceIntoMasterPdf } from "@/lib/pdfOps";
import { isImage, isPdf, needsPrintToPdf } from "@/lib/fileHelpers";
import { splicePageNumbers } from "@/lib/spliceNumbering";
import { downloadBlob } from "@/lib/download";

// shallowRef (not ref) below: these all hold, or nest, pdf.js
// PDFDocumentProxy instances, which use native private class fields
// internally. A plain ref() deep-wraps object values in a reactive Proxy,
// and calling a pdf.js method through that proxy breaks — private field
// access throws "Cannot read private member ... from an object whose
// class did not declare it", because `this` becomes the Proxy instead of
// the real instance. Every mutation here already reassigns `.value`
// wholesale (spread/rebuild), so shallowRef's lack of deep reactivity
// costs nothing.
const masterFile = shallowRef(null); // { name, bytes }
const pdfDoc = shallowRef(null); // pdf.js document, for thumbnails
const pageCount = ref(0);
// 1-indexed master page numbers marked for exclusion from the spliced output.
const excludedMasterPages = ref(new Set());

// gapIndex -> array of { id, name, bytes } (bytes = pdf ready to splice),
// in the order they'll be spliced in at that gap
const inserts = shallowRef({});
const activeGap = ref(null);
const blockedFilename = ref(null); // triggers modal
const exporting = ref(false);
const converting = ref(null); // gapIndex currently converting
// Clicking a queued insert's thumbnail (in a SpliceGap) shows all of
// *that* file's pages in the same popup Merge uses — set to
// { name, pdfDoc, pageCount } to open it.
const previewInsert = shallowRef(null);

async function loadMasterFile(file) {
  let doc, bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    await assertEditable(bytes);
    doc = await loadPdfDocument(bytes.slice());
  } catch (err) {
    // Encrypted, damaged, or not a PDF: the same print-to-PDF detour an
    // unsupported insert gets, since re-saving through a viewer is what
    // fixes all three.
    console.error("Could not open PDF:", err);
    blockedFilename.value = file.name;
    return;
  }
  masterFile.value = { name: file.name, bytes };
  pdfDoc.value = doc;
  pageCount.value = doc.numPages;
  inserts.value = {};
  activeGap.value = null;
  excludedMasterPages.value = new Set();
}

function toggleMasterPageExclusion(pageNumber) {
  const next = new Set(excludedMasterPages.value);
  if (next.has(pageNumber)) next.delete(pageNumber);
  else next.add(pageNumber);
  excludedMasterPages.value = next;
}

// Toggles whether a specific 1-indexed page *within* a queued insert file
// will be included when that file is spliced in. Rebuilds the item
// immutably so both `inserts` and, if that same item is open in the
// preview modal, `previewInsert` pick up the change.
function toggleInsertPageExclusion(gapIndex, itemId, pageNumber) {
  const list = inserts.value[gapIndex] || [];
  const nextList = list.map((item) => {
    if (item.id !== itemId) return item;
    const excludedPages = new Set(item.excludedPages);
    if (excludedPages.has(pageNumber)) excludedPages.delete(pageNumber);
    else excludedPages.add(pageNumber);
    return { ...item, excludedPages };
  });
  inserts.value = { ...inserts.value, [gapIndex]: nextList };
  if (previewInsert.value && previewInsert.value.id === itemId && previewInsert.value.gapIndex === gapIndex) {
    const updated = nextList.find((item) => item.id === itemId);
    previewInsert.value = { ...previewInsert.value, excludedPages: updated.excludedPages };
  }
}

async function handleGapFile(gapIndex, files, insertIndex) {
  const fileList = Array.isArray(files) ? files : [files];
  if (fileList.length === 0) return;

  const blocked = fileList.find((file) => needsPrintToPdf(file.name));
  if (blocked) {
    blockedFilename.value = blocked.name;
    return;
  }

  converting.value = gapIndex;
  try {
    // Convert every selected file first, so a failure partway through
    // doesn't leave a half-inserted batch, then splice them all in
    // together at the requested position, preserving selection order.
    const items = [];
    for (const file of fileList) {
      let bytes;
      if (isPdf(file.name)) {
        bytes = new Uint8Array(await file.arrayBuffer());
        await assertEditable(bytes);
      } else if (isImage(file.name)) {
        bytes = await convertToPdfBytes(file);
      } else {
        continue;
      }
      const insertDoc = await loadPdfDocument(bytes.slice());
      items.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        bytes,
        pdfDoc: insertDoc,
        pageCount: insertDoc.numPages,
        excludedPages: new Set(),
      });
    }
    const existing = inserts.value[gapIndex] || [];
    const at = insertIndex ?? existing.length;
    const nextList = [...existing.slice(0, at), ...items, ...existing.slice(at)];
    inserts.value = { ...inserts.value, [gapIndex]: nextList };
    activeGap.value = null;
  } catch (err) {
    console.error("Failed to prepare inserted page:", err);
    blockedFilename.value = fileList[0]?.name;
  } finally {
    converting.value = null;
  }
}

function removeInsert(gapIndex, itemId) {
  const remaining = (inserts.value[gapIndex] || []).filter((item) => item.id !== itemId);
  const next = { ...inserts.value };
  if (remaining.length === 0) {
    delete next[gapIndex];
  } else {
    next[gapIndex] = remaining;
  }
  inserts.value = next;
}

// Drag-to-reorder: moves the dragged item to sit where the drop-target
// item currently is, within the same gap. Numbering is derived from
// this order (see `pageNumbers` below), so dropping a file into a new
// spot automatically renumbers everything around it.
function reorderInsert(gapIndex, draggedId, targetId) {
  if (draggedId === targetId) return;
  const list = inserts.value[gapIndex] || [];
  const fromIdx = list.findIndex((item) => item.id === draggedId);
  const toIdx = list.findIndex((item) => item.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  inserts.value = { ...inserts.value, [gapIndex]: next };
}

const insertCount = computed(() =>
  Object.values(inserts.value).reduce((sum, arr) => sum + arr.length, 0)
);
// Pages, not files: a queued file contributes every page it has, and its
// excluded pages are subtracted from this same total below.
const insertedPageCount = computed(() =>
  Object.values(inserts.value).reduce(
    (sum, arr) => sum + arr.reduce((s, item) => s + item.pageCount, 0),
    0
  )
);
const totalPages = computed(() => pageCount.value + insertedPageCount.value);

// Effective (post-exclusion) page counts, used to decide whether there's
// anything left to export and what the dock summary should say.
const excludedInsertPageCount = computed(() =>
  Object.values(inserts.value).reduce(
    (sum, arr) => sum + arr.reduce((s, item) => s + item.excludedPages.size, 0),
    0
  )
);
const totalExcludedCount = computed(() => excludedMasterPages.value.size + excludedInsertPageCount.value);
const effectiveTotalPages = computed(() => totalPages.value - totalExcludedCount.value);

// The number every insert and master page will have once exported, not
// its position within its own file. See spliceNumbering.js.
const pageNumbers = computed(() =>
  splicePageNumbers(pageCount.value, inserts.value, excludedMasterPages.value)
);
const insertPageNumbers = computed(() => pageNumbers.value.inserts);
const masterDisplayNumbers = computed(() => pageNumbers.value.master);

async function handleExport() {
  if (!masterFile.value || effectiveTotalPages.value === 0) return;
  exporting.value = true;
  try {
    const insertBytes = Object.fromEntries(
      Object.entries(inserts.value).map(([k, items]) => [
        k,
        items.map((item) => ({ bytes: item.bytes, excludedPages: item.excludedPages })),
      ])
    );
    const outBytes = await spliceIntoMasterPdf(
      masterFile.value.bytes,
      insertBytes,
      excludedMasterPages.value
    );
    downloadBlob(
      new Blob([outBytes], { type: "application/pdf" }),
      masterFile.value.name.replace(/\.pdf$/i, "") + "-spliced.pdf"
    );
  } catch (err) {
    console.error("Export failed:", err);
  } finally {
    exporting.value = false;
  }
}

const gaps = computed(() => {
  const arr = [];
  for (let i = 0; i <= pageCount.value; i++) arr.push(i);
  return arr;
});
</script>

<template>
  <div class="page">
    <NavBar />

    <UploadShell
      v-if="!masterFile"
      subtitle="Click any gap to insert a file, or a page's trash icon to exclude it."
      @file-chosen="loadMasterFile"
    />

    <template v-else>
      <div class="grid">
        <template v-for="gapIndex in gaps" :key="`gap-wrap-${gapIndex}`">
          <SpliceGap
            :gap-index="gapIndex"
            :inserts="inserts[gapIndex] || []"
            :is-active="activeGap === gapIndex"
            :is-converting="converting === gapIndex"
            :page-numbers="insertPageNumbers"
            @activate="activeGap = $event"
            @cancel="activeGap = null"
            @file-chosen="handleGapFile"
            @remove="removeInsert"
            @reorder="reorderInsert"
            @preview-insert="previewInsert = $event"
          />
          <div
            v-if="gapIndex < pageCount"
            class="remove-slot"
            :class="{ marked: excludedMasterPages.has(gapIndex + 1) }"
          >
            <PageThumbnail
              :pdf-doc="pdfDoc"
              :page-number="gapIndex + 1"
              :display-number="masterDisplayNumbers.get(gapIndex) ?? gapIndex + 1"
            />
            <RemoveBadge
              :excluded="excludedMasterPages.has(gapIndex + 1)"
              :include-label="`Include page ${gapIndex + 1}`"
              :exclude-label="`Exclude page ${gapIndex + 1}`"
              @toggle="toggleMasterPageExclusion(gapIndex + 1)"
            />
          </div>
        </template>
      </div>

      <div class="dock">
        <div class="dock-left">
          <div class="dock-icon-box">
            <DocIcon />
          </div>
          <div>
            <h1 class="dock-title">{{ masterFile.name }}</h1>
            <p class="dock-meta">
              {{
                effectiveTotalPages === 0
                  ? "Every page is excluded — nothing to export"
                  : `${effectiveTotalPages} of ${totalPages} pages`
              }}
              <template v-if="insertCount > 0"> · {{ insertCount }} added</template>
              <template v-if="totalExcludedCount > 0"> · {{ totalExcludedCount }} excluded</template>
            </p>
          </div>
        </div>
        <button class="export-btn" :disabled="exporting || effectiveTotalPages === 0" @click="handleExport">
          <DownloadIcon />
          {{ exporting ? "Exporting…" : "Export PDF" }}
        </button>
      </div>
    </template>

    <InsertPreviewModal
      v-if="previewInsert"
      :file="previewInsert"
      :excluded-pages="previewInsert.excludedPages"
      @close="previewInsert = null"
      @toggle-exclude="toggleInsertPageExclusion(previewInsert.gapIndex, previewInsert.id, $event)"
    />

    <PrintToPdfModal
      v-if="blockedFilename"
      :filename="blockedFilename"
      @close="blockedFilename = null"
    />
  </div>
</template>
