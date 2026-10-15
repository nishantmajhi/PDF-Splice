<script setup>
import { ref, shallowRef, computed } from "vue";
import NavBar from "@/components/NavBar.vue";
import PageThumbnail from "@/components/PageThumbnail.vue";
import RemoveBadge from "@/components/RemoveBadge.vue";
import UploadShell from "@/components/UploadShell.vue";
import PrintToPdfModal from "@/components/PrintToPdfModal.vue";
import { DocIcon, DownloadIcon } from "@/components/icons";
import { loadPdfDocument, renderPageToPngBlob } from "@/lib/pdfRender";
import { downloadAsZip, downloadBlob } from "@/lib/download";
import { padToCount } from "@/lib/fileHelpers";

// shallowRef: pdfDoc is a pdf.js document with native private class
// fields — a plain ref() deep-wraps it in a reactive Proxy and breaks its
// internal methods (this is what made this page's export hang/fail). See
// pageViewer.js for the full explanation.
const masterFile = shallowRef(null);
const pdfDoc = shallowRef(null);
const pageCount = ref(0);
const excludedPages = ref(new Set()); // 1-indexed pages excluded from the export
const exporting = ref(false);
const blockedFilename = ref(null); // a file that could not be opened, for the modal

async function loadMasterFile(file) {
  let doc;
  try {
    doc = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    console.error("Could not open PDF:", err);
    blockedFilename.value = file.name;
    return;
  }
  masterFile.value = { name: file.name };
  pdfDoc.value = doc;
  pageCount.value = doc.numPages;
  excludedPages.value = new Set();
}

function togglePageExclusion(pageNumber) {
  const next = new Set(excludedPages.value);
  if (next.has(pageNumber)) next.delete(pageNumber);
  else next.add(pageNumber);
  excludedPages.value = next;
}

const remainingPageCount = computed(() => pageCount.value - excludedPages.value.size);

async function handleExport() {
  if (!pdfDoc.value || remainingPageCount.value === 0) return;
  exporting.value = true;
  try {
    const baseName = masterFile.value.name.replace(/\.pdf$/i, "");
    const blobs = [];
    for (let i = 1; i <= pageCount.value; i++) {
      if (excludedPages.value.has(i)) continue;
      const blob = await renderPageToPngBlob(pdfDoc.value, i);
      blobs.push({ name: `${baseName}-page-${padToCount(i, pageCount.value)}.png`, blob });
    }
    if (blobs.length === 1) {
      downloadBlob(blobs[0].blob, blobs[0].name);
    } else {
      await downloadAsZip(blobs, `${baseName}-images.zip`);
    }
  } catch (err) {
    console.error("PDF to image export failed:", err);
  } finally {
    exporting.value = false;
  }
}

const pageIndexes = computed(() => Array.from({ length: pageCount.value }, (_, i) => i));
</script>

<template>
  <div class="page">
    <NavBar />

    <UploadShell
      v-if="!masterFile"
      title="Drop a PDF to convert"
      subtitle="Every page becomes its own PNG image. Click a page's trash icon to skip it."
      @file-chosen="loadMasterFile"
    />

    <template v-else>
      <div class="grid">
        <div
          v-for="i in pageIndexes"
          :key="i"
          class="remove-slot"
          :class="{ marked: excludedPages.has(i + 1) }"
        >
          <PageThumbnail :pdf-doc="pdfDoc" :page-number="i + 1" :display-number="i + 1" />
          <RemoveBadge
            :excluded="excludedPages.has(i + 1)"
            :include-label="`Include page ${i + 1}`"
            :exclude-label="`Exclude page ${i + 1}`"
            @toggle="togglePageExclusion(i + 1)"
          />
        </div>
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
                excludedPages.size === 0
                  ? `${pageCount} pages → ${pageCount} PNGs`
                  : remainingPageCount === 0
                    ? "Every page is excluded — nothing to convert"
                    : `${remainingPageCount} of ${pageCount} pages → ${remainingPageCount} PNGs · ${excludedPages.size} excluded`
              }}
            </p>
          </div>
        </div>
        <button class="export-btn" :disabled="exporting || remainingPageCount === 0" @click="handleExport">
          <DownloadIcon />
          {{ exporting ? "Converting…" : remainingPageCount > 1 ? "Export ZIP" : "Export PNG" }}
        </button>
      </div>
    </template>

    <PrintToPdfModal
      v-if="blockedFilename"
      :filename="blockedFilename"
      @close="blockedFilename = null"
    />
  </div>
</template>
