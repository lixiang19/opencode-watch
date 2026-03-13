<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { SendHorizonal, LoaderCircle } from 'lucide-vue-next'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useOpencodeStore } from '@/stores/opencode'

const app = useOpencodeStore()
const props = withDefaults(
  defineProps<{
    sessionId?: string
    embedded?: boolean
  }>(),
  {
    sessionId: '',
    embedded: false
  }
)
const DEFAULT_AGENT_VALUE = '__default_agent__'
const DEFAULT_MODEL_VALUE = '__default_model__'
const NO_COMMAND_VALUE = '__no_command__'
const localText = ref('')
const textareaEl = ref<HTMLTextAreaElement | null>(null)

const desktopSession = computed(() => (props.sessionId ? app.desktopSessions[props.sessionId] ?? null : null))
const availableAgents = computed(() => (props.sessionId ? desktopSession.value?.availableAgents ?? [] : app.availableAgents))
const availableModels = computed(() => (props.sessionId ? desktopSession.value?.availableModels ?? [] : app.availableModels))
const availableCommands = computed(() => (props.sessionId ? desktopSession.value?.availableCommands ?? [] : app.availableCommands))
const isSending = computed(() => (props.sessionId ? Boolean(desktopSession.value?.isSending) : app.isSending))

const disabled = computed(() => {
  if (props.sessionId) {
    return !app.streamReady || Boolean(desktopSession.value?.isSending)
  }

  return !app.streamReady || app.isSending
})
const canChooseAgent = computed(() => availableAgents.value.length > 0)
const canChooseModel = computed(() => availableModels.value.length > 0)
const hasCommandOptions = computed(() => availableCommands.value.length > 0)
const selectedAgentValue = computed(() => (props.sessionId ? desktopSession.value?.selectedAgentId || undefined : app.selectedAgentId || undefined))
const selectedModelValue = computed(() => (props.sessionId ? desktopSession.value?.selectedModelKey || undefined : app.selectedModelKey || undefined))
const selectedCommandValue = computed(() => (props.sessionId ? desktopSession.value?.selectedCommandName || undefined : app.selectedCommandName || undefined))
const commandGroups = computed(() => {
  return [
    {
      label: '系统命令',
      items: availableCommands.value.filter((command) => command.category === 'system')
    },
    {
      label: '自定义命令',
      items: availableCommands.value.filter((command) => command.category === 'custom')
    },
    {
      label: 'Skill',
      items: availableCommands.value.filter((command) => command.category === 'skill')
    }
  ].filter((group) => group.items.length > 0)
})
const selectedCommandDescription = computed(() => {
  if (props.sessionId) {
    return availableCommands.value.find((command) => command.name === desktopSession.value?.selectedCommandName)?.description || ''
  }

  return app.selectedCommand?.description || ''
})
const hasSelectedCommand = computed(() => Boolean(selectedCommandValue.value))
const canSend = computed(() => {
  return !disabled.value && (Boolean(composerValue.value.trim()) || hasSelectedCommand.value)
})

function syncTextareaHeight() {
  const textarea = textareaEl.value
  if (!textarea) {
    return
  }

  textarea.style.height = '0px'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`
}

function handleAgentChange(value: unknown) {
  const nextValue = value === DEFAULT_AGENT_VALUE ? '' : String(value ?? '')

  if (props.sessionId) {
    app.selectDesktopAgent(props.sessionId, nextValue)
    return
  }

  app.selectAgent(nextValue)
}

function handleModelChange(value: unknown) {
  const nextValue = value === DEFAULT_MODEL_VALUE ? '' : String(value ?? '')

  if (props.sessionId) {
    app.selectDesktopModel(props.sessionId, nextValue)
    return
  }

  app.selectModel(nextValue)
}

function handleCommandChange(value: unknown) {
  const nextValue = value === NO_COMMAND_VALUE ? '' : String(value ?? '')

  if (props.sessionId) {
    const nextCommand = availableCommands.value.find((command) => command.name === nextValue) ?? null
    if (nextCommand?.category === 'skill') {
      localText.value = `务必使用skill：${nextCommand.name}。`
      app.selectDesktopCommand(props.sessionId, '')
      return
    }

    app.selectDesktopCommand(props.sessionId, nextValue)
    return
  }

  app.selectCommand(nextValue)
}

const composerValue = computed(() => (props.sessionId ? localText.value : app.composerText))

function handleComposerInput(value: string) {
  if (props.sessionId) {
    localText.value = value
    return
  }

  app.composerText = value
}

async function handleSend() {
  if (props.sessionId) {
    const text = localText.value.trim()
    if (!text && !hasSelectedCommand.value) {
      return
    }

    const sent = await app.sendDesktopMessage(props.sessionId, text)
    if (sent) {
      localText.value = ''
    }
    return
  }

  await app.sendCurrentMessage()
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return
  }

  if (event.key !== 'Enter') {
    return
  }

  if (event.shiftKey) {
    return
  }

  event.preventDefault()
  void handleSend()
}

watch(composerValue, () => {
  nextTick(syncTextareaHeight)
})

watch(() => props.sessionId, () => {
  nextTick(syncTextareaHeight)
})

onMounted(() => {
  syncTextareaHeight()
})
</script>

<template>
  <footer class="composer" :class="{ 'composer-embedded': embedded }">
    <div class="composer-card">
      <div class="composer-meta">
        <div class="composer-selects">
          <Select
            v-if="canChooseAgent"
            :model-value="selectedAgentValue"
            :disabled="disabled"
            @update:model-value="handleAgentChange"
          >
            <SelectTrigger class="composer-select">
              <SelectValue placeholder="默认 Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="DEFAULT_AGENT_VALUE">默认 Agent</SelectItem>
              <SelectItem v-for="agent in availableAgents" :key="agent.id" :value="agent.id">
                {{ agent.id }}
              </SelectItem>
            </SelectContent>
          </Select>
          <span v-else class="composer-select-empty">默认 Agent</span>

          <Select
            v-if="canChooseModel"
            :model-value="selectedModelValue"
            :disabled="disabled"
            @update:model-value="handleModelChange"
          >
            <SelectTrigger class="composer-select composer-select-model">
              <SelectValue placeholder="默认模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="DEFAULT_MODEL_VALUE">默认模型</SelectItem>
              <SelectItem v-for="model in availableModels" :key="model.key" :value="model.key">
                {{ model.providerId }}/{{ model.modelId }}
              </SelectItem>
            </SelectContent>
          </Select>
          <span v-else class="composer-select-empty">默认模型</span>

          <Select
            :model-value="selectedCommandValue"
            :disabled="disabled || !hasCommandOptions"
            @update:model-value="handleCommandChange"
          >
            <SelectTrigger class="composer-select composer-select-cmd">
              <SelectValue placeholder="/ 命令" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_COMMAND_VALUE">普通消息</SelectItem>
              <SelectGroup v-for="group in commandGroups" :key="group.label">
                <SelectLabel>{{ group.label }}</SelectLabel>
                <SelectItem v-for="command in group.items" :key="command.name" :value="command.name">
                  /{{ command.name }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

      </div>

      <div v-if="selectedCommandDescription" class="composer-command-hint">
        {{ selectedCommandDescription }}
      </div>

      <div class="composer-input-wrap">
        <div class="composer-input-shell" :class="{ 'composer-input-shell-active': canSend }">
        <textarea
          ref="textareaEl"
          :value="composerValue"
          :disabled="disabled"
          :placeholder="hasSelectedCommand ? '可直接发送命令，或补充说明…' : '输入消息，Enter 发送，Shift+Enter 换行'"
          class="composer-input soft-scrollbar"
          rows="1"
          @input="handleComposerInput(($event.target as HTMLTextAreaElement).value)"
          @keydown="handleComposerKeydown"
        />
        <div class="composer-input-hint">
          <span>{{ hasSelectedCommand ? '已选命令，可空内容发送' : 'Enter 发送' }}</span>
          <span>Shift + Enter 换行</span>
        </div>
        </div>
        <button
          type="button"
          class="btn-send"
          :disabled="!canSend"
          :aria-label="isSending ? '发送中' : '发送消息'"
          @click="handleSend"
        >
          <LoaderCircle v-if="isSending" class="h-4 w-4 animate-spin" />
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

.composer-embedded {
  padding: 0 0.875rem 0.875rem;
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
   gap: 0.625rem;
   padding: 0.5rem 0.75rem 0.75rem;
}

.composer-input-shell {
   flex: 1;
   min-width: 0;
   display: flex;
   flex-direction: column;
   gap: 0.35rem;
   padding: 0.125rem 0 0;
   border-bottom: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
   transition: border-color 0.18s ease;
}

.composer-input-shell:focus-within,
.composer-input-shell-active {
   border-bottom-color: color-mix(in srgb, var(--primary) 34%, var(--border));
}

.composer-input {
   min-height: 2.25rem;
   max-height: 13.75rem;
   resize: none;
   overflow-y: auto;
   padding: 0.375rem 0 0;
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

.composer-input-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.125rem;
  color: var(--muted-foreground);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.btn-send {
  flex-shrink: 0;
  display: grid;
   width: 2.75rem;
   height: 2.75rem;
   place-items: center;
   border: 0;
   border-radius: 0.95rem;
   background: var(--primary);
   color: var(--primary-foreground);
   box-shadow: 0 10px 22px color-mix(in srgb, var(--primary) 18%, transparent);
   transition: opacity 0.15s, transform 0.1s, box-shadow 0.15s;
   cursor: pointer;
}

.btn-send:hover:not(:disabled) {
   opacity: 0.88;
   transform: scale(1.04);
   box-shadow: 0 12px 28px color-mix(in srgb, var(--primary) 24%, transparent);
}

.btn-send:active:not(:disabled) {
  transform: scale(0.96);
}

.btn-send:disabled {
   opacity: 0.42;
   box-shadow: none;
   cursor: default;
}

@media (max-width: 640px) {
  .composer {
    padding: 0 0.625rem calc(0.75rem + env(safe-area-inset-bottom));
  }

   .composer-meta {
    flex-direction: column;
    align-items: stretch;
  }

  .composer-selects {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .composer-select,
  .composer-select-model,
  .composer-select-cmd,
  .composer-select-empty {
    max-width: none;
    width: 100%;
  }

  .composer-select-cmd {
    grid-column: 1 / -1;
  }

  .composer-input-wrap {
    gap: 0.5rem;
    padding: 0.375rem 0.625rem 0.625rem;
  }

  .composer-input {
    line-height: 1.58;
  }

  .composer-input-hint {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.125rem;
  }

  .meta-shortcut {
    display: none;
  }
}
</style>
