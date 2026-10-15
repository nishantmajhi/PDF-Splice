import { createRouter, createWebHistory } from "vue-router";
import Splice from "@/pages/Splice.vue";
import Split from "@/pages/Split.vue";
import Merge from "@/pages/Merge.vue";
import PdfToImage from "@/pages/PdfToImage.vue";
import ExtractImages from "@/pages/ExtractImages.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Splice },
    { path: "/split", component: Split },
    { path: "/merge", component: Merge },
    { path: "/pdf-to-image", component: PdfToImage },
    { path: "/extract-images", component: ExtractImages },
  ],
});

export default router;
