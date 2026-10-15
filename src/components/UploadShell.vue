<script setup>
import { ref } from "vue";
import { UploadIcon } from "@/components/icons";

const props = defineProps({
  title: { type: String, default: "Drop a PDF to get started" },
  subtitle: { type: String, default: "Then click any gap between pages to insert a new one." },
  multiple: { type: Boolean, default: false },
  accept: { type: String, default: "application/pdf" },
});

const emit = defineEmits(["file-chosen"]); // emitted once per file

const dragOver = ref(false);
const inputRef = ref(null);

function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (props.multiple) {
    files.forEach((file) => emit("file-chosen", file));
  } else if (files[0]) {
    emit("file-chosen", files[0]);
  }
}
</script>

<template>
  <div class="upload-shell">
    <div
      class="upload-card"
      :class="{ dragover: dragOver }"
      @click="inputRef?.click()"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="dragOver = false; handleFiles($event.dataTransfer.files)"
    >
      <UploadIcon :size="28" />
      <h2>{{ title }}</h2>
      <p>{{ subtitle }}</p>
      <button
        type="button"
        class="browse-link"
        @click.stop="inputRef?.click()"
      >
        browse for {{ multiple ? "files" : "a file" }}
      </button>
      <input
        ref="inputRef"
        type="file"
        :accept="accept"
        :multiple="multiple"
        hidden
        @change="handleFiles($event.target.files); $event.target.value = ''"
      />
    </div>
  </div>
</template>
