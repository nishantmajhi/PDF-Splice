<script setup>
defineProps({ size: { type: Number, default: 15 } });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 15V3" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
</template>
