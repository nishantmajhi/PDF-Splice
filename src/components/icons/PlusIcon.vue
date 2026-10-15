<script setup>
defineProps({ size: { type: Number, default: 13 } });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  </svg>
</template>
