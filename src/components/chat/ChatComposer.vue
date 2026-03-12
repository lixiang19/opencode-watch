<script setup lang="ts">
import { computed } from 'vue'
import { SendHorizonal, LoaderCircle } from 'lucide-vue-next'

import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()

const disabled = computed(() => !app.streamReady.value || app.isSending.value)
</script>

<template>
  <footer class="composer">
    <div class="composer-input-row">
      <textarea
        :value="app.composerText.value"
        :disabled="disabled"
        placeholder="发送消息… (/ 开头执行命令)"
        class="composer-input soft-scrollbar"
        rows="1"
        @input="app.composerText.value = ($event.target as HTMLTextAreaElement).value"
        @keydown.ctrl.enter.prevent="app.sendCurrentMessage"
        @keydown.meta.enter.prevent="app.sendCurrentMessage"
      />
      <button
        type="button"
        class="btn-send"
        :disabled="disabled"
        @click="app.sendCurrentMessage"
      >
        <LoaderCircle v-if="app.isSending.value" class="h-5 w-5 animate-spin" />
        <SendHorizonal v-else class="h-5 w-5" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.composer {
  padding: 0.875rem 1rem calc(0.875rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  background: var(--card);
}

.composer-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.625rem;
  align-items: end;
}

.composer-input {
  min-height: 3.25rem;
  max-height: 11.25rem;
  resize: none;
  padding: 0.875rem 1rem;
  border: 1px solid var(--input);
  border-radius: 1.25rem;
  background: var(--background);
  color: var(--foreground);
  line-height: 1.6;
  outline: none;
}

.composer-input::placeholder {
  color: var(--muted-foreground);
}

.composer-input:focus {
  border-color: var(--ring);
}

.btn-send {
  display: grid;
  width: 3.25rem;
  height: 3.25rem;
  place-items: center;
  border: 0;
  border-radius: 1.125rem;
  background: var(--primary);
  color: var(--primary-foreground);
  box-shadow: var(--shadow-md);
}

.btn-send:disabled,
.composer-input:disabled {
  opacity: 0.5;
}
</style>
