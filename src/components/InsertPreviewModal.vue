<script setup>
import PageThumbnail from "@/components/PageThumbnail.vue";
import RemoveBadge from "@/components/RemoveBadge.vue";
import { DocIcon } from "@/components/icons";

// Shown when the user clicks a queued PDF insert (Splice page) or a queued
// PDF card (Merge page). Renders every page of that PDF using the same
// PageThumbnail + ".grid" layout used elsewhere in the app, so a file
// previews consistently no matter where it's clicked from. Expects a
// pdf.js document that's already been loaded by the caller (both pages
// load one per file up front), so no extra loading state is needed here.
//
// Each page gets the same bin-button treatment used everywhere else in the
// app, so a user can exclude specific pages of this file from whatever
// output it feeds into (the merged PDF, or the master doc it's spliced
// into) without leaving the preview. excludedPages is a Set of 1-indexed
// page numbers the caller currently has marked; toggling one re-emits
// 'toggle-exclude' with that page number for the caller to update.
defineProps({
  file: { type: Object, required: true },
  excludedPages: { type: Object, default: () => new Set() },
});
const emit = defineEmits(["close", "toggle-exclude"]);

const pageIndexes = (n) => Array.from({ length: n }, (_, i) => i);
</script>

<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="modal-card modal-card-wide" @click.stop>
      <button class="modal-close" aria-label="Close" @click="emit('close')">×</button>
      <div class="modal-preview-header">
        <div class="dock-icon-box">
          <DocIcon />
        </div>
        <div>
          <h3 style="margin: 0">{{ file.name }}</h3>
          <p style="margin: 0">{{ file.pageCount }} page{{ file.pageCount === 1 ? "" : "s" }}</p>
        </div>
      </div>

      <div class="modal-preview-grid">
        <div
          v-for="pageIdx in pageIndexes(file.pageCount)"
          :key="pageIdx"
          class="remove-slot"
          :class="{ marked: excludedPages.has(pageIdx + 1) }"
        >
          <PageThumbnail :pdf-doc="file.pdfDoc" :page-number="pageIdx + 1" :display-number="pageIdx + 1" />
          <RemoveBadge
            :excluded="excludedPages.has(pageIdx + 1)"
            :include-label="`Include page ${pageIdx + 1}`"
            :exclude-label="`Exclude page ${pageIdx + 1}`"
            @toggle="emit('toggle-exclude', pageIdx + 1)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
