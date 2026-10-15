<script setup>
import { ScissorIcon } from "@/components/icons";

// A toggleable cut-point between pages. Reuses the same collapsed-gap visual
// language as SpliceGap (dashed line + circular button) so Split feels like
// the same family of tool, but clicking toggles a "cut here" state instead
// of opening a file dropzone.
defineProps({
  active: { type: Boolean, default: false },
});
const emit = defineEmits(["toggle"]);
</script>

<template>
  <button
    type="button"
    class="gap-collapsed"
    :aria-label="active ? 'Remove cut here' : 'Cut here'"
    @click="emit('toggle')"
  >
    <div class="gap-line" :style="active ? { borderColor: 'var(--red-600)', borderStyle: 'solid' } : undefined" />
    <div class="gap-plus gap-scissor" :class="{ 'gap-plus-active': active }">
      <ScissorIcon />
    </div>
  </button>
</template>
