<script setup>
import { ref, shallowRef, computed, onUnmounted } from "vue";
import NavBar from "@/components/NavBar.vue";
import RemoveBadge from "@/components/RemoveBadge.vue";
import UploadShell from "@/components/UploadShell.vue";
import PrintToPdfModal from "@/components/PrintToPdfModal.vue";
import { AlertIcon, DocIcon, DownloadIcon } from "@/components/icons";
import { loadPdfDocument, extractImagesFromPage } from "@/lib/pdfRender";
import { downloadAsZip, downloadBlob } from "@/lib/download";
import { padToCount } from "@/lib/fileHelpers";
import { usePageViewer } from "@/lib/pageViewer";

const { viewerState, openImageViewer, closeViewer } = usePageViewer();
// shallowRef: pdfDoc is a pdf.js document with native private class
// fields — a plain ref() deep-wraps it in a reactive Proxy and breaks its
// internal methods. This page isn't currently affected in practice (the
// scan loop below uses the local `doc` variable directly, before it's
// ever assigned into this ref), but it's fixed here too so nothing
// depends on that being true in the future. See pageViewer.js for the
// full explanation.
const masterFile = shallowRef(null);
const pdfDoc = shallowRef(null);
const pageCount = ref(0);
const scanning = ref(false);
const scanProgress = ref(0); // pages scanned so far
const scanFoundCount = ref(0); // images found so far, live during scan
const previews = shallowRef([]); // { blob, url, width, height }
const scanError = ref(null);
const exporting = ref(false);
const blockedFilename = ref(null); // a file that could not be opened, for the modal
const excludedImages = ref(new Set()); // image names excluded from the export

async function loadMasterFile(file) {
  scanError.value = null;
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
  previews.value = [];
  excludedImages.value = new Set();

  scanning.value = true;
  scanProgress.value = 0;
  scanFoundCount.value = 0;
  try {
    const found = [];
    const seenGlobalIds = new Set();
    for (let i = 1; i <= doc.numPages; i++) {
      if (unmounted) return;
      const imgs = await extractImagesFromPage(doc, i, seenGlobalIds);
      imgs.forEach((img) => found.push(img));
      scanProgress.value = i;
      scanFoundCount.value = found.length;
    }
    if (unmounted) return;
    previews.value = found.map((img, i) => ({
      ...img,
      url: URL.createObjectURL(img.blob),
      name: `image-${padToCount(i + 1, found.length, 3)}.png`,
    }));
  } catch (err) {
    console.error("Image extraction scan failed:", err);
    scanError.value =
      "Something went wrong while scanning this PDF for images. Try again, or try a different file.";
  } finally {
    scanning.value = false;
  }
}

// Each preview is shown through an object URL, which keeps its PNG alive
// until it is revoked or the tab closes - for a document full of photos,
// hundreds of megabytes. They belong to this page, so they go with it, and
// a scan still running when the user leaves stops rather than making more.
// The shared image viewer is closed first if it is showing them, since it
// would otherwise be left pointing at revoked URLs.
let unmounted = false;
onUnmounted(() => {
  unmounted = true;
  const urls = new Set(previews.value.map((p) => p.url));
  const viewer = viewerState.viewer;
  if (viewer && viewer.mode === "image" && viewer.images.some((img) => urls.has(img.url))) {
    closeViewer();
  }
  urls.forEach((url) => URL.revokeObjectURL(url));
});

function toggleImageExclusion(name) {
  const next = new Set(excludedImages.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  excludedImages.value = next;
}

const remainingPreviews = computed(() => previews.value.filter((p) => !excludedImages.value.has(p.name)));

async function handleExport() {
  if (remainingPreviews.value.length === 0) return;
  exporting.value = true;
  try {
    const baseName = masterFile.value.name.replace(/\.pdf$/i, "");
    if (remainingPreviews.value.length === 1) {
      const only = remainingPreviews.value[0];
      downloadBlob(only.blob, `${baseName}-${only.name}`);
    } else {
      await downloadAsZip(
        remainingPreviews.value.map((p) => ({ name: p.name, blob: p.blob })),
        `${baseName}-images.zip`
      );
    }
  } catch (err) {
    console.error("Extract images export failed:", err);
  } finally {
    exporting.value = false;
  }
}

function openViewerAt(i) {
  openImageViewer(
    previews.value.map((p) => ({ url: p.url, label: p.name })),
    i
  );
}
</script>

<template>
  <div class="page">
    <NavBar />

    <UploadShell
      v-if="!masterFile"
      title="Drop a PDF to extract"
      subtitle="We'll pull out every image at its original quality."
      @file-chosen="loadMasterFile"
    />

    <template v-else>
      <div v-if="scanning" class="upload-shell">
        <div class="scan-card">
          <div class="spinner" aria-hidden="true" />
          <h2>Scanning for images</h2>
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{ width: `${pageCount ? (scanProgress / pageCount) * 100 : 0}%` }"
            />
          </div>
          <p class="progress-label">Page {{ Math.min(scanProgress, pageCount) }} of {{ pageCount }}</p>
        </div>
      </div>

      <div v-else-if="scanError" class="upload-shell">
        <div class="upload-card">
          <AlertIcon :size="28" />
          <h2>Couldn&rsquo;t finish scanning</h2>
          <p>{{ scanError }}</p>
        </div>
      </div>

      <UploadShell
        v-else-if="previews.length === 0"
        title="Drop a PDF to extract"
        subtitle="We'll pull out every image at its original quality."
        @file-chosen="loadMasterFile"
      />

      <div v-else class="grid">
        <div
          v-for="(img, i) in previews"
          :key="img.name"
          class="remove-slot"
          :class="{ marked: excludedImages.has(img.name) }"
        >
          <div
            class="page-card"
            :style="{ height: 'auto', padding: '8px' }"
            role="button"
            tabindex="0"
            :aria-label="`View ${img.name}`"
            @click="openViewerAt(i)"
            @keydown="
              (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openViewerAt(i);
                }
              }
            "
          >
            <img
              :src="img.url"
              :alt="img.name"
              :style="{ width: '100%', height: '128px', objectFit: 'cover', borderRadius: '4px' }"
            />
            <p
              :style="{
                fontSize: '10px',
                color: 'var(--muted2)',
                textAlign: 'center',
                marginTop: '6px',
                fontFamily: 'Courier New, monospace',
              }"
            >
              {{ img.width }}×{{ img.height }}
            </p>
          </div>
          <RemoveBadge
            :excluded="excludedImages.has(img.name)"
            include-label="Include this image"
            exclude-label="Exclude this image"
            @toggle="toggleImageExclusion(img.name)"
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
                scanning
                  ? scanFoundCount === 0
                    ? "Scanning…"
                    : `${scanFoundCount} image${scanFoundCount === 1 ? "" : "s"} found so far…`
                  : scanError
                    ? "Scan failed"
                    : excludedImages.size === 0
                      ? `${previews.length} image${previews.length === 1 ? "" : "s"} found`
                      : remainingPreviews.length === 0
                        ? "Every image is excluded — nothing to export"
                        : `${remainingPreviews.length} of ${previews.length} images · ${excludedImages.size} excluded`
              }}
            </p>
          </div>
        </div>
        <button
          class="export-btn"
          :disabled="exporting || scanning || remainingPreviews.length === 0"
          @click="handleExport"
        >
          <DownloadIcon />
          {{ exporting ? "Exporting…" : remainingPreviews.length > 1 ? "Export ZIP" : "Export Image" }}
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
