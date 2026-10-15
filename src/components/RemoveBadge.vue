<script setup>
import { TrashIcon } from "@/components/icons";

// A small circular trash-icon button + "Excluded" tag, meant to sit as a
// sibling of a thumbnail inside a `.remove-slot` wrapper (see globals.css:
// `.remove-slot` / `.remove-badge-btn` / `.remove-tag`). Reused everywhere
// in the app so every "exclude this from the output" control looks and
// behaves identically, regardless of whether it's excluding a master page,
// an inserted page, a split page, a page to convert, or an extracted
// image.
defineProps({
  excluded: { type: Boolean, default: false },
  includeLabel: { type: String, default: "Include this" },
  excludeLabel: { type: String, default: "Exclude this" },
  tagText: { type: String, default: "Excluded" },
});
defineEmits(["toggle"]);
</script>

<template>
  <button
    type="button"
    class="remove-badge-btn"
    :class="{ active: excluded }"
    :aria-label="excluded ? includeLabel : excludeLabel"
    @click.stop="$emit('toggle')"
  >
    <TrashIcon :size="12" />
  </button>
  <span v-if="excluded" class="remove-tag">{{ tagText }}</span>
</template>
