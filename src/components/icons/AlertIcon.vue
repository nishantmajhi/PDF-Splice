<script setup>
defineProps({ size: { type: Number, default: 22 }, color: { type: String, default: "#DC2626" } });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" :stroke="color" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
  </svg>
</template>
