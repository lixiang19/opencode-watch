<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { LoaderCircle, MessagesSquare } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import { useOpencodeState } from '@/lib/app-context'

const route = useRoute()
const app = useOpencodeState()
const streamEl = ref<HTMLElement>()
const messageTailSignal = computed(() => {
  const messages = app.visibleMessages.value
  const lastMessage = messages[messages.length - 1]

  return `${lastMessage?.id || ''}:${lastMessage?.updatedAt || 0}:${lastMessage?.content.length || 0}`
})
const showAgentWorking = computed(() => {
  if (app.isLoadingSession.value || app.sessionStatus.value !== 'busy') {
    return false
  }

  const lastMessage = app.visibleMessages.value[app.visibleMessages.value.length - 1]
  return !lastMessage || lastMessage.role === 'user'
})

async function syncSession(sessionId?: string | string[]) {
  const id = Array.isArray(sessionId) ? sessionId[0] : sessionId

  if (!id) {
    return
  }

  if (app.selectedSessionId.value === id && app.messages.value.length) {
    return
  }

  await app.openSession(id)
}

function scrollToBottom() {
  nextTick(() => {
    if (streamEl.value) {
      streamEl.value.scrollTop = streamEl.value.scrollHeight
    }
  })
}

async function loadOlderMessages() {
  if (!streamEl.value) {
    await app.loadOlderMessages()
    return
  }

  const previousHeight = streamEl.value.scrollHeight
  const previousTop = streamEl.value.scrollTop
  await app.loadOlderMessages()

  nextTick(() => {
    if (!streamEl.value) {
      return
    }

    const nextHeight = streamEl.value.scrollHeight
    streamEl.value.scrollTop = previousTop + (nextHeight - previousHeight)
  })
}

watch(
  () => route.params.sessionId,
  (id) => {
    void syncSession(id)
  },
  { immediate: true }
)

watch(
  messageTailSignal,
  (value, previousValue) => {
    if (!value || value === previousValue) {
      return
    }

    scrollToBottom()
  }
)
</script>

<template>
  <div class="chat-layout">
    <ChatHeader />

    <div ref="streamEl" class="chat-stream">
      <div v-if="app.hasTruncatedMessages.value" class="chat-history-banner">
        <div class="chat-history-copy">仅加载最近 {{ app.historyMessageLimit.value }} 条消息，以保证流畅度。</div>
        <Button
          variant="outline"
          size="sm"
          :disabled="app.isLoadingOlderMessages.value"
          @click="loadOlderMessages"
        >
          <LoaderCircle v-if="app.isLoadingOlderMessages.value" class="h-4 w-4 animate-spin" />
          <template v-else>加载更早消息</template>
        </Button>
      </div>

      <div v-if="app.lastError.value" class="chat-alert">
        {{ app.lastError.value }}
      </div>

      <div v-if="app.isLoadingSession.value" class="chat-loading">
        <LoaderCircle class="h-4 w-4 animate-spin" />
        <span>恢复历史消息…</span>
      </div>

      <template v-if="app.visibleMessages.value.length">
        <MessageBubble v-for="msg in app.visibleMessages.value" :key="msg.id" :message="msg" />
      </template>

      <div v-if="showAgentWorking" class="chat-working-card">
        <div class="chat-working-icon">
          <LoaderCircle class="h-4 w-4 animate-spin" />
        </div>
        <div class="chat-working-body">
          <strong>Agent 正在努力工作</strong>
          <span>正在分析上下文、调用工具或整理回复…</span>
        </div>
      </div>

      <div v-else-if="!app.isLoadingSession.value" class="chat-empty">
        <MessagesSquare class="chat-empty-icon h-10 w-10" />
        <p class="chat-empty-copy">
          {{ app.activeSession.value ? '发送第一条消息开始对话' : '先回到对话页，或去项目页新建一个会话' }}
        </p>
      </div>
    </div>

    <ChatComposer />
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

.chat-stream {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.875rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1rem 1rem 0.75rem;
}

.chat-alert {
  margin: 0;
  padding: 0.875rem 1rem;
  border: 1px solid color-mix(in srgb, var(--destructive) 40%, var(--border));
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--destructive) 10%, var(--card));
  color: var(--destructive);
}

.chat-history-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border);
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--accent) 20%, var(--card));
}

.chat-history-copy {
  color: var(--muted-foreground);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.chat-loading,
.chat-empty {
  color: var(--muted-foreground);
}

.chat-working-card {
  display: grid;
  max-width: min(86%, 28rem);
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  border-bottom-left-radius: 0.625rem;
  background: color-mix(in srgb, var(--accent) 22%, var(--card));
  color: var(--card-foreground);
}

.chat-working-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 999px;
  background: var(--card);
  color: var(--primary);
}

.chat-working-body {
  display: grid;
  gap: 0.25rem;
}

.chat-working-body strong {
  color: var(--foreground);
  font-size: 0.9375rem;
}

.chat-working-body span {
  color: var(--muted-foreground);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.chat-loading {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.chat-empty {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 1.5rem;
  text-align: center;
}

.chat-empty-icon {
  color: var(--muted-foreground);
  opacity: 0.5;
}

.chat-empty-copy {
  max-width: 16rem;
  margin: 0.75rem 0 0;
  line-height: 1.7;
}

@media (min-width: 768px) {
  .chat-layout {
    width: min(60rem, calc(100vw - 2.5rem));
    height: calc(100dvh - var(--tabbar-height, 0px) - 2.5rem);
    margin: 1.25rem auto;
    border: 1px solid var(--border);
    border-radius: 1.75rem;
    box-shadow: var(--shadow-xl);
    overflow: hidden;
  }
}

@media (max-width: 640px) {
  .chat-history-banner {
    flex-direction: column;
    align-items: stretch;
  }

  .chat-working-card {
    max-width: 92%;
  }
}
</style>
