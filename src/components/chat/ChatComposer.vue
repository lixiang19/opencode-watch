<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ImagePlus, SendHorizonal, Square, X } from 'lucide-vue-next'

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
import type { ComposerImageAttachment } from '@/types/opencode'

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
const imageInputEl = ref<HTMLInputElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const attachedImages = ref<ComposerImageAttachment[]>([])
const imageError = ref('')

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
const selectedVariantValue = computed(() => (props.sessionId ? desktopSession.value?.selectedVariant || undefined : app.selectedVariant || undefined))
const selectedCommandValue = computed(() => (props.sessionId ? desktopSession.value?.selectedCommandName || undefined : app.selectedCommandName || undefined))
const selectedModelDetail = computed(() => {
  return availableModels.value.find((model) => model.key === selectedModelValue.value) ?? null
})
const currentVariants = computed(() => selectedModelDetail.value?.variants ?? [])
const canChooseVariant = computed(() => currentVariants.value.length > 0)
const currentMessages = computed(() => (props.sessionId ? desktopSession.value?.messages ?? [] : app.messages))
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
const hasAttachedImages = computed(() => attachedImages.value.length > 0)
const canAttachImages = computed(() => !disabled.value && !hasSelectedCommand.value)
const canSend = computed(() => {
  return !disabled.value && (Boolean(composerValue.value.trim()) || hasSelectedCommand.value || hasAttachedImages.value)
})
const canStop = computed(() => isSending.value)
const composerHintText = computed(() => {
  if (hasSelectedCommand.value) {
    return '已选命令，可空内容发送'
  }

  if (!hasAttachedImages.value) {
    return ''
  }

  return attachedImages.value.length === 1 ? '已附 1 张图片' : `已附 ${attachedImages.value.length} 张图片`
})
const latestUsage = computed(() => {
  const model = selectedModelDetail.value
  if (!model) {
    return null
  }

  for (let index = currentMessages.value.length - 1; index >= 0; index -= 1) {
    const message = currentMessages.value[index]
    if (message.role !== 'assistant' || !message.tokens || !message.model) {
      continue
    }

    if (message.model.providerId !== model.providerId || message.model.modelId !== model.modelId) {
      continue
    }

    if (currentVariants.value.length > 0 && (message.variant || '') !== (selectedVariantValue.value || '')) {
      continue
    }

    return message.tokens
  }

  return null
})
const contextUsageText = computed(() => {
  const limit = selectedModelDetail.value?.limit?.context ?? 0
  if (!limit) {
    return ''
  }

  const used = (latestUsage.value?.input ?? 0) + (latestUsage.value?.output ?? 0)
  return `上下文 ${formatTokenCount(used)} / ${formatTokenCount(limit)}`
})

function formatTokenCount(value: number) {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`
  }

  return `${value}`
}

function syncTextareaHeight() {
  const textarea = textareaEl.value
  if (!textarea) {
    return
  }

  textarea.style.height = '0px'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`
}

function createAttachmentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('读取图片失败，请重试。'))
        return
      }

      resolve(reader.result)
    }
    reader.onerror = () => reject(new Error('读取图片失败，请重试。'))
    reader.readAsDataURL(file)
  })
}

function resetImageInput() {
  if (imageInputEl.value) {
    imageInputEl.value.value = ''
  }
}

function clearImages() {
  attachedImages.value = []
  imageError.value = ''
  resetImageInput()
}

function removeImage(imageId: string) {
  attachedImages.value = attachedImages.value.filter((image) => image.id !== imageId)
}

function clearSelectedCommand() {
  if (props.sessionId) {
    app.selectDesktopCommand(props.sessionId, '')
    return
  }

  app.selectCommand('')
}

function openImagePicker() {
  if (!canAttachImages.value) {
    return
  }

  imageInputEl.value?.click()
}

async function handleImageChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) {
    return
  }

  try {
    const nextImages = await Promise.all(
      files.map(async (file) => {
        if (!file.type.startsWith('image/')) {
          throw new Error('只能上传图片文件。')
        }

        return {
          id: createAttachmentId(),
          filename: file.name,
          mime: file.type,
          dataUrl: await readFileAsDataUrl(file)
        } satisfies ComposerImageAttachment
      })
    )

    attachedImages.value = [...attachedImages.value, ...nextImages]
    imageError.value = ''
    clearSelectedCommand()
  } catch (error) {
    imageError.value = error instanceof Error ? error.message : '读取图片失败，请重试。'
  } finally {
    input.value = ''
  }
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

function handleVariantChange(value: unknown) {
  const nextValue = String(value ?? '')

  if (props.sessionId) {
    app.selectDesktopVariant(props.sessionId, nextValue)
    return
  }

  app.selectVariant(nextValue)
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

    if (nextValue && attachedImages.value.length) {
      clearImages()
    }

    app.selectDesktopCommand(props.sessionId, nextValue)
    return
  }

  if (nextValue && attachedImages.value.length) {
    clearImages()
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
    if (!text && !hasSelectedCommand.value && !hasAttachedImages.value) {
      return
    }

    const sent = await app.sendDesktopMessage(props.sessionId, text, attachedImages.value)
    if (sent) {
      localText.value = ''
      clearImages()
    }
    return
  }

  const sent = await app.sendCurrentMessage(attachedImages.value)
  if (sent) {
    clearImages()
  }
}

async function handleStop() {
  if (props.sessionId) {
    await app.stopDesktopSession(props.sessionId)
    return
  }

  await app.stopCurrentSession()
}

async function handlePrimaryAction() {
  if (canStop.value) {
    await handleStop()
    return
  }

  await handleSend()
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
  void handlePrimaryAction()
}

watch(composerValue, () => {
  nextTick(syncTextareaHeight)
})

watch(() => props.sessionId, () => {
  clearImages()
  nextTick(syncTextareaHeight)
})

onMounted(() => {
  syncTextareaHeight()
})
</script>

<template>
  <footer class="composer" :class="{ 'composer-embedded': embedded }">
    <div class="composer-card">
      <div class="composer-meta composer-meta-top">
        <div class="composer-selects composer-selects-top">
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

      <div v-if="attachedImages.length || imageError" class="composer-attachments">
        <div v-if="attachedImages.length" class="composer-attachment-list">
          <div v-for="image in attachedImages" :key="image.id" class="composer-attachment-chip">
            <img :src="image.dataUrl" :alt="image.filename" class="composer-attachment-thumb" />
            <div class="composer-attachment-meta">
              <span class="composer-attachment-name">{{ image.filename }}</span>
              <button
                type="button"
                class="composer-attachment-remove"
                :disabled="disabled"
                :aria-label="`移除 ${image.filename}`"
                @click="removeImage(image.id)"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        <p v-if="imageError" class="composer-image-error">{{ imageError }}</p>
      </div>

      <div class="composer-input-wrap">
        <input
          ref="imageInputEl"
          class="composer-file-input"
          type="file"
          accept="image/*"
          multiple
          :disabled="!canAttachImages"
          @change="handleImageChange"
        />
        <button
          type="button"
          class="btn-attach"
          :disabled="!canAttachImages"
          aria-label="添加图片"
          @click="openImagePicker"
        >
          <ImagePlus class="h-4 w-4" />
        </button>
        <div class="composer-input-shell" :class="{ 'composer-input-shell-active': canSend }">
        <textarea
          ref="textareaEl"
          :value="composerValue"
          :disabled="disabled"
          :placeholder="hasSelectedCommand ? '可直接发送命令，或补充说明…' : ''"
          class="composer-input soft-scrollbar"
          rows="1"
          @input="handleComposerInput(($event.target as HTMLTextAreaElement).value)"
          @keydown="handleComposerKeydown"
        />
        <div class="composer-input-hint">
          <span>{{ composerHintText }}</span>
          <span v-if="contextUsageText" class="composer-context-hint">{{ contextUsageText }}</span>
        </div>
        </div>
        <button
          type="button"
          class="btn-send"
          :class="{ 'btn-stop': canStop }"
          :disabled="!canStop && !canSend"
          :aria-label="canStop ? '停止对话' : '发送消息'"
          @click="handlePrimaryAction"
        >
          <Square v-if="canStop" class="h-3.5 w-3.5 fill-current" />
          <SendHorizonal v-else class="h-4 w-4" />
        </button>
      </div>

      <div class="composer-meta composer-meta-bottom">
        <div class="composer-selects composer-selects-bottom">
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
            v-if="canChooseVariant"
            :model-value="selectedVariantValue"
            :disabled="disabled"
            @update:model-value="handleVariantChange"
          >
            <SelectTrigger class="composer-select composer-select-variant">
              <SelectValue placeholder="变体" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="variant in currentVariants" :key="variant" :value="variant">
                {{ variant }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
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
  border-radius: 1rem;
  background: var(--card);
  overflow: hidden;
}

/* ── Meta bar ── */
.composer-meta {
  display: flex;
  align-items: center;
   justify-content: flex-start;
  gap: 0.5rem;
   padding: 0 0.75rem;
}

.composer-selects {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
   flex-wrap: wrap;
 }

.composer-meta-top {
  padding-top: 0.5rem;
}

.composer-meta-bottom {
  padding-bottom: 0.75rem;
}

.composer-selects-top {
  overflow: hidden;
}

.composer-selects-bottom {
  justify-content: flex-start;
}

.composer-select {
  flex: 1;
  min-width: 0;
  max-width: 11rem;
  height: 1.875rem;
  font-size: 0.78rem;
}

.composer-select-model {
  max-width: 14rem;
}

.composer-select-cmd {
  max-width: 12rem;
}

.composer-select-variant {
  max-width: 7rem;
}

.composer-select-empty {
  display: inline-flex;
  align-items: center;
  height: 1.875rem;
  padding: 0 0.625rem;
  border: 1px solid var(--input);
  border-radius: 0.5rem;
  background: var(--background);
  color: var(--muted-foreground);
  font-size: 0.78rem;
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

.composer-attachments {
  display: grid;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem 0;
}

.composer-attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
}

.composer-attachment-chip {
  display: grid;
  gap: 0.375rem;
  width: 5.5rem;
}

.composer-attachment-thumb {
  width: 5.5rem;
  height: 5.5rem;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 0.875rem;
  object-fit: cover;
  background: color-mix(in srgb, var(--muted) 68%, white 32%);
}

.composer-attachment-meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.composer-attachment-name {
  flex: 1;
  min-width: 0;
  font-size: 0.68rem;
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-attachment-remove {
  display: grid;
  width: 1.4rem;
  height: 1.4rem;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted) 78%, white 22%);
  color: var(--foreground);
  cursor: pointer;
}

.composer-attachment-remove:disabled {
  opacity: 0.45;
  cursor: default;
}

.composer-image-error {
  margin: 0;
  color: #b42318;
  font-size: 0.75rem;
}

/* ── Input area ── */
.composer-input-wrap {
  display: flex;
  align-items: flex-end;
   gap: 0.625rem;
    padding: 0.5rem 0.75rem 0.75rem;
}

.composer-file-input {
  display: none;
}

.btn-attach {
  flex-shrink: 0;
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--background) 90%, white 10%);
  color: var(--foreground);
  transition: opacity 0.15s;
  cursor: pointer;
}

.btn-attach:hover:not(:disabled) {
  opacity: 0.82;
}

.btn-attach:disabled {
  opacity: 0.35;
  cursor: default;
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

.composer-context-hint {
  margin-left: auto;
  white-space: nowrap;
}

.btn-send {
  flex-shrink: 0;
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 0;
  border-radius: 0.625rem;
  background: var(--primary);
  color: var(--primary-foreground);
  transition: opacity 0.15s;
  cursor: pointer;
}

.btn-stop {
  background: color-mix(in srgb, var(--destructive) 88%, black 0%);
  color: var(--destructive-foreground);
}

.btn-send:hover:not(:disabled) {
  opacity: 0.82;
}

.btn-send:active:not(:disabled) {
  opacity: 0.7;
}

.btn-send:disabled {
  opacity: 0.35;
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

  .composer-meta-bottom {
    padding-bottom: 0.625rem;
  }

  .composer-select,
  .composer-select-model,
  .composer-select-variant,
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

  .composer-attachments {
    padding: 0.375rem 0.625rem 0;
  }

  .composer-attachment-chip {
    width: 4.75rem;
  }

  .composer-attachment-thumb {
    width: 4.75rem;
    height: 4.75rem;
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
