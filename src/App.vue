<script setup>
import { RouterView } from "vue-router";
import PageViewerModal from "@/components/PageViewerModal.vue";
import { usePageViewer } from "@/lib/pageViewer";

const { viewerState, goToPdfPage, goToImageIndex, closeViewer } = usePageViewer();
</script>

<template>
  <RouterView />
  <PageViewerModal
    v-if="viewerState.viewer"
    :viewer="viewerState.viewer"
    @navigate-pdf="goToPdfPage"
    @navigate-image="goToImageIndex"
    @close="closeViewer"
  />
</template>
