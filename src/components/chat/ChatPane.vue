<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'

import Badge from '@/components/ui/badge/Badge.vue'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import { formatPathTail } from '@/composables/useOpencodeApp/helpers'
import { isRenderableMessage } from '@/composables/useOpencodeApp/messages'
import type { Part } from '@opencode-ai/sdk/v2/client'
import type { ChatMessageRecord, SessionWorkingInfo } from '@/types/opencode'

const props = withDefaults(
  defineProps<{
    title: string
    projectName: string
    messages: ChatMessageRecord[]
    connected?: boolean
    busy?: boolean
    isLoading?: boolean
    lastError?: string
    hasTruncatedMessages?: boolean
    historyLimit?: number
    loadingOlder?: boolean
    embedded?: boolean
    emptyText?: string
    workingInfo?: SessionWorkingInfo | null
  }>(),
  {
    connected: false,
    busy: false,
    isLoading: false,
    lastError: '',
    hasTruncatedMessages: false,
    historyLimit: 0,
    loadingOlder: false,
    embedded: false,
    emptyText: '还没有消息',
    workingInfo: null
  }
)

const streamEl = ref<HTMLElement>()
const renderableMessages = computed(() => props.messages.filter((message) => isRenderableMessage(message)))
const patchParts = computed(() =>
  props.messages.flatMap((msg) =>
    msg.parts.filter((p): p is Extract<Part, { type: 'patch' }> => p.type === 'patch')
  )
)
const patchFiles = computed(() => {
  return [...new Set(patchParts.value.flatMap((p) => p.files))].map((file) => ({
    fullPath: file,
    displayPath: formatPathTail(file, 4)
  }))
})

type ActivityItem = Extract<Part, { type: 'tool' }> | Extract<Part, { type: 'reasoning' }>
const activityItems = computed(() =>
  props.messages.flatMap((msg) =>
    msg.parts.filter((p): p is ActivityItem => p.type === 'tool' || p.type === 'reasoning')
  )
)
const latestActivityItem = computed(() => activityItems.value[activityItems.value.length - 1] ?? null)

function clipActivityText(input: string, limit = 72) {
  const text = input.trim().replace(/\s+/g, ' ')
  if (!text) {
    return ''
  }

  return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text
}

function getActivityDisplayText(item: ActivityItem | null) {
  if (!item) {
    return ''
  }

  if (item.type === 'reasoning') {
    return clipActivityText(item.text)
  }

  const title = 'title' in item.state && typeof item.state.title === 'string'
    ? item.state.title.trim()
    : ''
  const output = 'output' in item.state && typeof item.state.output === 'string'
    ? item.state.output.trim()
    : ''
  const error = 'error' in item.state && typeof item.state.error === 'string'
    ? item.state.error.trim()
    : ''

  return clipActivityText(title || output || error || item.tool)
}

function toolStatusLabel(status: string) {
  switch (status) {
    case 'pending':   return '等待中'
    case 'running':   return '执行中'
    case 'completed': return '已完成'
    case 'error':     return '失败'
    default:          return status
  }
}

const messageTailSignal = computed(() => {
  const lastMessage = renderableMessages.value[renderableMessages.value.length - 1]
  return `${lastMessage?.id || ''}:${lastMessage?.updatedAt || 0}:${lastMessage?.parts.length || 0}`
})

const currentWorkingInfo = computed<SessionWorkingInfo>(() => props.workingInfo ?? {
  isWorking: false,
  kind: 'idle',
  summaryText: '',
  detailText: ''
})

const showAgentWorking = computed(() => {
  return Boolean(currentWorkingInfo.value.isWorking && !props.isLoading)
})

const workingBannerClass = computed(() => {
  switch (currentWorkingInfo.value.kind) {
    case 'question':
    case 'permission':
      return 'chat-working-banner-waiting'
    default:
      return 'chat-working-banner-running'
  }
})

const workingNeedsAttention = computed(() => {
  return currentWorkingInfo.value.kind === 'question' || currentWorkingInfo.value.kind === 'permission'
})

const workingBannerText = computed(() => {
  const latestActivityText = getActivityDisplayText(latestActivityItem.value)
  if (latestActivityText) {
    return latestActivityText
  }

  if (currentWorkingInfo.value.detailText) {
    return `${currentWorkingInfo.value.summaryText} · ${currentWorkingInfo.value.detailText}`
  }

  return currentWorkingInfo.value.summaryText
})

function scrollToBottom() {
  nextTick(() => {
    if (streamEl.value) {
      streamEl.value.scrollTop = streamEl.value.scrollHeight
    }
  })
}

watch(messageTailSignal, (value, previousValue) => {
  if (!value || value === previousValue) {
    return
  }

  scrollToBottom()
})

watch(showAgentWorking, (value, previousValue) => {
  if (!value || value === previousValue) {
    return
  }

  scrollToBottom()
})
</script>

<template>
  <div class="chat-layout" :class="{ 'chat-layout-embedded': embedded }">
    <div class="chat-head-stack">
      <header class="chat-topbar">
        <div class="topbar-leading">
          <slot name="leading" />
        </div>

        <div class="topbar-center">
          <div class="topbar-session-name">{{ title || '对话详情' }}</div>
          <div class="topbar-project-name">{{ projectName || '未绑定项目' }}</div>
        </div>

        <div class="topbar-right">
          <Badge v-if="busy" tone="accent" class="status-badge">
            <LoaderCircle class="h-3 w-3 animate-spin" />
            处理中
          </Badge>
          <span class="connection-pill" :class="connected ? 'pill-connected' : 'pill-disconnected'">
            <span class="connection-dot" />
            {{ connected ? '已连接' : '未连接' }}
          </span>
          <slot name="trailing" />
        </div>
      </header>

      <slot name="session-meta" />

      <div v-if="showAgentWorking" class="chat-working-banner" :class="workingBannerClass">
        <div class="chat-working-banner-icon">
          <LoaderCircle class="h-3.5 w-3.5" :class="{ 'animate-spin': !workingNeedsAttention }" />
        </div>
        <div class="chat-working-banner-copy">
          <strong>{{ workingNeedsAttention ? '现在需要你处理' : 'AI 正在工作' }}</strong>
          <span>{{ workingBannerText }}</span>
        </div>
      </div>
    </div>

    <div ref="streamEl" class="chat-stream soft-scrollbar">
      <div v-if="hasTruncatedMessages" class="chat-history-banner">
        <span class="chat-history-copy">仅加载最近 {{ historyLimit }} 条消息</span>
        <slot name="history-action" />
      </div>

      <div v-if="lastError" class="chat-alert">
        {{ lastError }}
      </div>

      <div v-if="isLoading" class="chat-loading">
        <LoaderCircle class="h-4 w-4 animate-spin" />
        <span>恢复历史消息…</span>
      </div>

      <template v-if="renderableMessages.length">
        <MessageBubble v-for="msg in renderableMessages" :key="msg.id" :message="msg" />
      </template>

      <div v-else class="chat-placeholder-row">
        {{ emptyText }}
      </div>
    </div>

    <div class="chat-footer-stack">
      <div v-if="activityItems.length || patchFiles.length" class="chat-meta-bar">
        <details v-if="activityItems.length" class="meta-disc">
          <summary class="meta-disc-trigger">活动 · {{ activityItems.length }}</summary>
          <ul class="meta-disc-list soft-scrollbar">
            <li v-for="item in activityItems" :key="item.id" class="activity-item">
              <span class="activity-tag" :class="item.type === 'reasoning' ? 'activity-tag-reasoning' : 'activity-tag-tool'">
                {{ item.type === 'reasoning' ? '思考' : '工具' }}
              </span>
              <span class="activity-name">{{ item.type === 'tool' ? item.tool : '思考过程' }}</span>
              <span v-if="item.type === 'tool'" class="activity-status" :class="`activity-status-${item.state.status}`">
                {{ toolStatusLabel(item.state.status) }}
              </span>
            </li>
          </ul>
        </details>

        <span v-if="activityItems.length && patchFiles.length" class="meta-sep" />

        <details v-if="patchFiles.length" class="meta-disc">
          <summary class="meta-disc-trigger">补丁 · {{ patchFiles.length }}</summary>
          <ul class="meta-disc-list soft-scrollbar">
            <li v-for="file in patchFiles" :key="file.fullPath" class="patch-file-item">{{ file.displayPath }}</li>
          </ul>
        </details>
      </div>

      <div class="chat-composer-slot">
        <slot name="composer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-layout {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: calc(100dvh - var(--tabbar-height, 0px));
  min-height: 0;
  background: var(--background);
  overflow: hidden;
}

.chat-head-stack {
  min-height: 0;
}

.chat-layout-embedded {
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: var(--card);
}

.chat-topbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.875rem;
  padding: calc(env(safe-area-inset-top) + 0.875rem) 1rem 0.875rem;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}

.chat-layout-embedded .chat-topbar {
  padding-top: 0.875rem;
}

.chat-working-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--border);
}

.chat-working-banner-running {
  background: color-mix(in srgb, var(--primary) 8%, var(--card));
}

.chat-working-banner-waiting {
  background: color-mix(in srgb, #d18d1f 12%, var(--card));
}

.chat-working-banner-icon {
  display: grid;
  width: 1.6rem;
  height: 1.6rem;
  flex-shrink: 0;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--background) 82%, transparent);
  color: var(--primary);
}

.chat-working-banner-waiting .chat-working-banner-icon {
  color: #b57611;
}

.chat-working-banner-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.chat-working-banner-copy strong,
.chat-working-banner-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-working-banner-copy strong {
  color: var(--foreground);
  font-size: 0.76rem;
  font-weight: 700;
}

.chat-working-banner-copy span {
  color: var(--muted-foreground);
  font-size: 0.7rem;
}

.topbar-leading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.topbar-center {
  min-width: 0;
}

.topbar-session-name {
  overflow: hidden;
  color: var(--foreground);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-project-name {
  overflow: hidden;
  margin-top: 0.125rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-badge {
  font-size: 0.6875rem;
  padding: 0.1875rem 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.connection-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  height: 1.5rem;
  padding: 0 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.pill-connected {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
}

.pill-disconnected {
  background: color-mix(in srgb, var(--muted-foreground) 12%, transparent);
  color: var(--muted-foreground);
}

.connection-dot {
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: 999px;
  background: currentColor;
}

.pill-connected .connection-dot {
  animation: pulse-dot 2s ease-in-out infinite;
}

.chat-stream {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.75rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1.25rem 1.125rem 0.5rem;
  scroll-padding-bottom: 1rem;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--primary) 22%, transparent) transparent;
  -webkit-overflow-scrolling: touch;
}

.chat-stream::-webkit-scrollbar {
  -webkit-appearance: none;
  width: 2px !important;
}

.chat-stream::-webkit-scrollbar-track {
  background: transparent;
}

.chat-stream::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--primary) 22%, transparent);
  border-radius: 9999px;
}

.chat-stream::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--primary) 34%, transparent);
}

.chat-alert {
  padding: 0.75rem 1rem;
  border: 1px solid color-mix(in srgb, var(--destructive) 35%, var(--border));
  border-radius: 1rem;
  background: color-mix(in srgb, var(--destructive) 8%, var(--card));
  color: var(--destructive);
  font-size: 0.875rem;
  line-height: 1.55;
}

.chat-history-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
}

.chat-history-copy {
  color: var(--muted-foreground);
  font-size: 0.8125rem;
}

.chat-loading {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--muted-foreground);
  font-size: 0.875rem;
}

.chat-placeholder-row {
  padding: 0.75rem 0.9rem;
  border: 1px dashed color-mix(in srgb, var(--border) 85%, transparent);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--muted) 34%, transparent);
  color: var(--muted-foreground);
  font-size: 0.82rem;
}

.chat-composer-slot {
  min-height: 0;
}

.chat-footer-stack {
  display: grid;
  grid-template-rows: auto auto;
  min-height: 0;
}

/* ── Meta bar (activity + patches) ── */
.chat-meta-bar {
  display: flex;
  align-items: flex-start;
  gap: 0;
  border-top: 1px solid var(--border);
  background: var(--card);
}

.meta-sep {
  width: 1px;
  align-self: stretch;
  background: var(--border);
}

.meta-disc {
  flex: 1;
  min-width: 0;
}

.meta-disc-trigger {
  display: flex;
  align-items: center;
  padding: 0.4rem 1rem;
  cursor: pointer;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 500;
  user-select: none;
  list-style: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-disc-trigger:hover {
  color: var(--foreground);
}

.meta-disc-list {
  margin: 0;
  padding: 0.25rem 1rem 0.5rem;
  max-height: 10rem;
  overflow-y: auto;
  display: grid;
  gap: 0.15rem;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--primary) 18%, transparent) transparent;
}

.meta-disc-list::-webkit-scrollbar {
  -webkit-appearance: none;
  width: 2px !important;
}

.meta-disc-list::-webkit-scrollbar-track {
  background: transparent;
}

.meta-disc-list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  border-radius: 9999px;
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.15rem 0;
}

.activity-tag {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 1.125rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 600;
}

.activity-tag-tool {
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: var(--primary);
}

.activity-tag-reasoning {
  background: color-mix(in srgb, var(--muted-foreground) 14%, transparent);
  color: var(--muted-foreground);
}

.activity-name {
  flex: 1;
  overflow: hidden;
  color: var(--foreground);
  font-size: 0.75rem;
  font-family: monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-status {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--muted-foreground);
}

.activity-status-running {
  color: var(--primary);
}

.activity-status-error {
  color: var(--destructive);
}

.patch-file-item {
  color: var(--muted-foreground);
  font-size: 0.73rem;
  font-family: monospace;
  word-break: break-all;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@media (min-width: 768px) {
  .chat-layout:not(.chat-layout-embedded) {
    width: min(58rem, calc(100vw - 2.5rem));
    height: calc(100dvh - var(--tabbar-height, 0px) - 2.5rem);
    margin: 1.25rem auto;
    border: 1px solid var(--border);
    border-radius: 1.75rem;
    box-shadow: 0 8px 48px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06);
    overflow: hidden;
  }
}

@media (max-width: 640px) {
  .chat-layout {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .chat-history-banner {
    border-radius: 1rem;
  }

  .chat-working-banner {
    padding: 0.45rem 0.875rem;
  }

  .chat-working-banner-copy strong {
    font-size: 0.72rem;
  }

  .chat-working-banner-copy span {
    font-size: 0.68rem;
  }
}
</style>
