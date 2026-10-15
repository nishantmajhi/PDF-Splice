<script setup>
import { useRoute } from "vue-router";
import Logo from "./Logo.vue";

const LINKS = [
  { href: "/split", label: "Split" },
  { href: "/merge", label: "Merge" },
  { href: "/pdf-to-image", label: "PDF to Image" },
  { href: "/extract-images", label: "Extract Images" },
];

const route = useRoute();
</script>

<template>
  <div class="navbar">
    <RouterLink to="/" class="brand" style="text-decoration: none; color: inherit">
      <Logo />
      <span class="brand-name">PDF Splice</span>
    </RouterLink>
    <nav class="nav-links">
      <RouterLink
        v-for="link in LINKS"
        :key="link.href"
        :to="link.href"
        class="nav-link"
        :class="{ active: route.path === link.href }"
      >
        {{ link.label }}
      </RouterLink>
    </nav>
  </div>
</template>
