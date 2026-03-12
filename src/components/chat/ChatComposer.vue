<script setup lang="ts">
import { computed } from 'vue'
import { SendHorizonal, LoaderCircle } from 'lucide-vue-next'

import Select from '@/components/ui/select/Select.vue'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()

const disabled = computed(() => !app.streamReady.value || app.isSending.value)
const canChooseAgent = computed(() => app.availableAgents.value.length > 0)
const canChooseModel = computed(() => app.availableModels.value.length > 0)
const hasCommandOptions = computed(() => app.availableCommands.value.length > 0)
const commandGroups = computed(() => {
  return [
    {
      label: '系统命令',
      items: app.availableCommands.value.filter((command) => command.category === 'system')
    },
    {
      label: '自定义命令',
      items: app.availableCommands.value.filter((command) => command.category === 'custom')
    },
    {
      label: 'Skill',
      items: app.availableCommands.value.filter((command) => command.category === 'skill')
    }
  ].filter((group) => group.items.length > 0)
})
const selectedCommandDescription = computed(() => app.selectedCommand.value?.description || '')
</script>

<template>
  <footer class="composer">
    <div class="composer-card">
      <div class="composer-meta">
        <div class="composer-selects">
          <Select
            v-if="canChooseAgent"
            :model-value="app.selectedAgentId.value"
            :disabled="disabled"
            class="composer-select"
            @change="app.selectAgent(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="agent in app.availableAgents.value" :key="agent.id" :value="agent.id">
              {{ agent.id }}
            </option>
          </Select>
          <span v-else class="composer-select-empty">默认 Agent</span>

          <Select
            v-if="canChooseModel"
            :model-value="app.selectedModelKey.value"
            :disabled="disabled"
            class="composer-select composer-select-model"
            @change="app.selectModel(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="model in app.availableModels.value" :key="model.key" :value="model.key">
              {{ model.providerId }}/{{ model.modelId }}
            </option>
          </Select>
          <span v-else class="composer-select-empty">默认模型</span>

          <Select
            :model-value="app.selectedCommandName.value"
            :disabled="disabled || !hasCommandOptions"
            class="composer-select composer-select-cmd"
            @change="app.selectCommand(($event.target as HTMLSelectElement).value)"
          >
            <option value="">/ 命令</option>
            <optgroup v-for="group in commandGroups" :key="group.label" :label="group.label">
              <option v-for="command in group.items" :key="command.name" :value="command.name">
                /{{ command.name }}{{ command.description ? ` — ${command.description}` : '' }}
              </option>
            </optgroup>
          </Select>
        </div>

        <span class="meta-shortcut">⌘↵</span>
      </div>

      <div v-if="selectedCommandDescription" class="composer-command-hint">
        {{ selectedCommandDescription }}
      </div>

      <div class="composer-input-wrap">
        <textarea
          :value="app.composerText.value"
          :disabled="disabled"
          placeholder="发送消息…"
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
          <LoaderCircle v-if="app.isSending.value" class="h-4 w-4 animate-spin" />
          <SendHorizonal v-else class="h-4 w-4" />
        </button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.composer {
  padding: 0 0.875rem calc(0.875rem + env(safe-area-inset-bottom));
  background: transparent;
}

.composer-card {
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: var(--card);
  box-shadow: var(--shadow-lg, 0 4px 24px rgba(0,0,0,.08));
  overflow: hidden;
}

/* ── Meta bar ── */
.composer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem 0;
}

.composer-selects {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.composer-select {
  flex: 1;
  min-width: 0;
  max-width: 11rem;
  font-size: 0.8125rem;
}

.composer-select-model {
  max-width: 14rem;
}

.composer-select-cmd {
  max-width: 9rem;
}

.composer-select-empty {
  display: inline-flex;
  align-items: center;
  height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--input);
  border-radius: 0.75rem;
  background: var(--background);
  color: var(--muted-foreground);
  font-size: 0.8125rem;
  white-space: nowrap;
}

.meta-shortcut {
  color: var(--muted-foreground);
  font-size: 0.75rem;
  flex-shrink: 0;
}

/* ── Command hint ── */
.composer-command-hint {
  margin: 0.375rem 0.75rem 0;
  padding: 0.4375rem 0.75rem;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--muted-foreground);
  font-size: 0.75rem;
  line-height: 1.5;
}

/* ── Input area ── */
.composer-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 0;
  padding: 0.5rem 0.625rem 0.625rem 0.875rem;
}

.composer-input {
  flex: 1;
  min-height: 2.25rem;
  max-height: 10rem;
  resize: none;
  padding: 0.375rem 0;
  border: 0;
  background: transparent;
  color: var(--foreground);
  font-size: 0.9375rem;
  line-height: 1.65;
  outline: none;
}

.composer-input::placeholder {
  color: var(--muted-foreground);
}

.composer-input:disabled {
  opacity: 0.5;
}

.btn-send {
  flex-shrink: 0;
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 0;
  border-radius: 0.75rem;
  background: var(--primary);
  color: var(--primary-foreground);
  transition: opacity 0.15s, transform 0.1s;
  cursor: pointer;
}

.btn-send:hover:not(:disabled) {
  opacity: 0.88;
  transform: scale(1.04);
}

.btn-send:active:not(:disabled) {
  transform: scale(0.96);
}

.btn-send:disabled {
  opacity: 0.35;
  cursor: default;
}

@media (max-width: 640px) {
  .composer {
    padding: 0 0.625rem calc(0.75rem + env(safe-area-inset-bottom));
  }

  .meta-shortcut {
    display: none;
  }

  .composer-select-model {
    display: none;
  }
}
</style>
