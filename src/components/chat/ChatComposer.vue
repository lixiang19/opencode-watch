<script setup lang="ts">
import { computed } from 'vue'
import { SendHorizonal, LoaderCircle } from 'lucide-vue-next'

import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()

const disabled = computed(() => !app.streamReady.value || app.isSending.value)
const canChooseAgent = computed(() => app.availableAgents.value.length > 0)
const canChooseModel = computed(() => app.availableModels.value.length > 0)
</script>

<template>
  <footer class="composer">
    <div class="composer-toolbar">
      <label class="composer-select-field">
        <span class="composer-select-label">Agent</span>
        <select
          v-if="canChooseAgent"
          :value="app.selectedAgentId.value"
          class="composer-select"
          :disabled="disabled"
          @change="app.selectAgent(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="agent in app.availableAgents.value" :key="agent.id" :value="agent.id">
            {{ agent.id }}
          </option>
        </select>
        <div v-else class="composer-select-empty">使用服务默认 Agent</div>
      </label>

      <label class="composer-select-field">
        <span class="composer-select-label">模型</span>
        <select
          v-if="canChooseModel"
          :value="app.selectedModelKey.value"
          class="composer-select"
          :disabled="disabled"
          @change="app.selectModel(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="model in app.availableModels.value" :key="model.key" :value="model.key">
            {{ model.providerId }}/{{ model.modelId }}
          </option>
        </select>
        <div v-else class="composer-select-empty">使用服务默认模型</div>
      </label>

      <div class="composer-shortcut">Cmd/Ctrl + Enter 发送</div>
    </div>

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

.composer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.composer-select-field {
  display: grid;
  min-width: 0;
  flex: 1 1 11rem;
  gap: 0.375rem;
}

.composer-select-label,
.composer-shortcut {
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.composer-select,
.composer-select-empty {
  min-height: 2.75rem;
  padding: 0.75rem 0.875rem;
  border: 1px solid var(--input);
  border-radius: 1rem;
  background: var(--background);
  color: var(--foreground);
}

.composer-select {
  width: 100%;
  outline: none;
}

.composer-select:focus {
  border-color: var(--ring);
}

.composer-select-empty {
  display: flex;
  align-items: center;
}

.composer-shortcut {
  margin-left: auto;
  padding-bottom: 0.125rem;
  white-space: nowrap;
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
.composer-input:disabled,
.composer-select:disabled {
  opacity: 0.5;
}

@media (max-width: 640px) {
  .composer-shortcut {
    width: 100%;
    margin-left: 0;
    padding-bottom: 0;
  }
}
</style>
