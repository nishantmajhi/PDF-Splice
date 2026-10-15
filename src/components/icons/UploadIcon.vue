<script setup>
defineProps({ size: { type: Number, default: 20 } });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
</template>
