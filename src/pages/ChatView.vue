<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { LoaderCircle, MessagesSquare } from 'lucide-vue-next'

import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import { useOpencodeState } from '@/lib/app-context'

const route = useRoute()
const app = useOpencodeState()
const streamEl = ref<HTMLElement>()

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

watch(
  () => route.params.sessionId,
  (id) => {
    void syncSession(id)
  },
  { immediate: true }
)

watch(
  () => app.messages.value,
  () => scrollToBottom(),
  { deep: true }
)
</script>

<template>
  <div class="chat-layout">
    <ChatHeader />

    <div ref="streamEl" class="chat-stream">
      <div v-if="app.lastError.value" class="chat-alert">
        {{ app.lastError.value }}
      </div>

      <div v-if="app.isLoadingSession.value" class="chat-loading">
        <LoaderCircle class="h-4 w-4 animate-spin" />
        <span>恢复历史消息…</span>
      </div>

      <template v-if="app.messages.value.length">
        <MessageBubble v-for="msg in app.messages.value" :key="msg.id" :message="msg" />
      </template>

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
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  background: var(--background);
}

.chat-stream {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.875rem;
  overflow-y: auto;
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

.chat-loading,
.chat-empty {
  color: var(--muted-foreground);
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
    min-height: calc(100vh - 2.5rem);
    margin: 1.25rem auto;
    border: 1px solid var(--border);
    border-radius: 1.75rem;
    box-shadow: var(--shadow-xl);
    overflow: hidden;
  }
}
</style>
