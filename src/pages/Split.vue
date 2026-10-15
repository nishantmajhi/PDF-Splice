<script setup>
import { ref, shallowRef, computed } from "vue";
import NavBar from "@/components/NavBar.vue";
import PageThumbnail from "@/components/PageThumbnail.vue";
import RemoveBadge from "@/components/RemoveBadge.vue";
import CutPoint from "@/components/CutPoint.vue";
import UploadShell from "@/components/UploadShell.vue";
import PrintToPdfModal from "@/components/PrintToPdfModal.vue";
import { DocIcon, DownloadIcon } from "@/components/icons";
import { loadPdfDocument } from "@/lib/pdfRender";
import { assertEditable, splitPdf } from "@/lib/pdfOps";
import { downloadAsZip, downloadBlob } from "@/lib/download";

// shallowRef: pdfDoc is a pdf.js document with native private class
// fields — a plain ref() deep-wraps it in a reactive Proxy and breaks its
// internal methods. See pageViewer.js for the full explanation.
const masterFile = shallowRef(null);
const pdfDoc = shallowRef(null);
const pageCount = ref(0);
const cuts = ref(new Set()); // gapIndex (1..pageCount-1) that are active cuts
const excludedPages = ref(new Set()); // 1-indexed pages excluded from every output
const exporting = ref(false);
const blockedFilename = ref(null); // a file that could not be opened, for the modal

async function loadMasterFile(file) {
  let doc, bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    await assertEditable(bytes);
    doc = await loadPdfDocument(bytes.slice());
  } catch (err) {
    console.error("Could not open PDF:", err);
    blockedFilename.value = file.name;
    return;
  }
  masterFile.value = { name: file.name, bytes };
  pdfDoc.value = doc;
  pageCount.value = doc.numPages;
  cuts.value = new Set();
  excludedPages.value = new Set();
}

function toggleCut(gapIndex) {
  const next = new Set(cuts.value);
  if (next.has(gapIndex)) next.delete(gapIndex);
  else next.add(gapIndex);
  cuts.value = next;
}

function togglePageExclusion(pageNumber) {
  const next = new Set(excludedPages.value);
  if (next.has(pageNumber)) next.delete(pageNumber);
  else next.add(pageNumber);
  excludedPages.value = next;
}

const pageIndexes = computed(() => Array.from({ length: pageCount.value }, (_, i) => i));

const ranges = computed(() => {
  if (pageCount.value === 0) return [];
  const sortedCuts = Array.from(cuts.value).sort((a, b) => a - b);
  const boundaries = [0, ...sortedCuts, pageCount.value];
  const out = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    out.push({ start: boundaries[i] + 1, end: boundaries[i + 1] });
  }
  return out;
});

// How many ranges will actually produce an output file once excluded pages
// are dropped from each — a range that's entirely excluded pages yields no
// file at all (see splitPdf).
const effectiveRangeCount = computed(
  () =>
    ranges.value.filter((r) => {
      for (let p = r.start; p <= r.end; p++) {
        if (!excludedPages.value.has(p)) return true;
      }
      return false;
    }).length
);
const remainingPageCount = computed(() => pageCount.value - excludedPages.value.size);

async function handleExport() {
  if (!masterFile.value || remainingPageCount.value === 0) return;
  exporting.value = true;
  try {
    const outputs = await splitPdf(masterFile.value.bytes, ranges.value, excludedPages.value);
    if (outputs.length === 1) {
      downloadBlob(
        new Blob([outputs[0].bytes], { type: "application/pdf" }),
        masterFile.value.name.replace(/\.pdf$/i, "") + "-split.pdf"
      );
    } else {
      await downloadAsZip(
        outputs.map((o) => ({ name: o.name, bytes: o.bytes })),
        masterFile.value.name.replace(/\.pdf$/i, "") + "-split.zip"
      );
    }
  } catch (err) {
    console.error("Split export failed:", err);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <NavBar />

    <UploadShell
      v-if="!masterFile"
      title="Drop a PDF to split"
      subtitle="Click a gap between pages to mark a cut point, or a page's trash icon to exclude it."
      @file-chosen="loadMasterFile"
    />

    <template v-else>
      <div class="grid">
        <template v-for="pageIdx in pageIndexes" :key="pageIdx">
          <div class="remove-slot" :class="{ marked: excludedPages.has(pageIdx + 1) }">
            <PageThumbnail :pdf-doc="pdfDoc" :page-number="pageIdx + 1" :display-number="pageIdx + 1" />
            <RemoveBadge
              :excluded="excludedPages.has(pageIdx + 1)"
              :include-label="`Include page ${pageIdx + 1}`"
              :exclude-label="`Exclude page ${pageIdx + 1}`"
              @toggle="togglePageExclusion(pageIdx + 1)"
            />
          </div>
          <CutPoint
            v-if="pageIdx + 1 < pageCount"
            :active="cuts.has(pageIdx + 1)"
            @toggle="toggleCut(pageIdx + 1)"
          />
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
                remainingPageCount === 0
                  ? "Every page is excluded — nothing to split"
                  : cuts.size === 0
                    ? excludedPages.size === 0
                      ? `${pageCount} pages · no cuts yet`
                      : `${remainingPageCount} of ${pageCount} pages · ${excludedPages.size} excluded · no cuts yet`
                    : excludedPages.size === 0
                      ? `${effectiveRangeCount} files after split`
                      : `${effectiveRangeCount} files after split · ${excludedPages.size} pages excluded`
              }}
            </p>
          </div>
        </div>
        <button class="export-btn" :disabled="exporting || remainingPageCount === 0" @click="handleExport">
          <DownloadIcon />
          {{ exporting ? "Exporting…" : effectiveRangeCount > 1 ? "Export ZIP" : "Export PDF" }}
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
