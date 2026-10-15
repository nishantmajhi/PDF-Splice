<script setup>
defineProps({ size: { type: Number, default: 22 }, color: { type: String, default: "#DC2626" } });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" :stroke="color" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
</template>
