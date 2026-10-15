<script setup>
import { computed } from "vue";
import { AlertIcon } from "@/components/icons";
import { printInstructionsFor } from "@/lib/fileHelpers";

const props = defineProps({
  filename: { type: String, required: true },
});
const emit = defineEmits(["close"]);

const info = computed(() => printInstructionsFor(props.filename));
</script>

<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="modal-card" @click.stop>
      <button class="modal-close" aria-label="Close" @click="emit('close')">×</button>
      <AlertIcon />
      <h3>We can&rsquo;t convert this file directly</h3>
      <p>
        <b>{{ filename }}</b> needs to be saved as a PDF first. Open it in
        {{ info.app }} and use its print-to-PDF option, then come back and upload
        the result.
      </p>
      <div class="modal-steps">
        <div v-for="(step, i) in info.steps" :key="i">
          <b>{{ i + 1 }}.</b> {{ step }}
        </div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn-secondary" @click="emit('close')">Got it</button>
      </div>
    </div>
  </div>
</template>
