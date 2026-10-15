<script setup>
defineProps({ size: { type: Number, default: 13 } });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M8.12 8.12 20 20" />
    <path d="M14.47 14.48 20 9" />
    <path d="M8.12 15.88 12 12" />
  </svg>
</template>
