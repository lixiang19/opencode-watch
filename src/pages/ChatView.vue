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
        <MessagesSquare class="h-10 w-10 text-slate-300" />
        <p class="text-sm text-slate-400 mt-3 max-w-[16rem] leading-relaxed">
          {{ app.activeSession.value ? '发送第一条消息开始对话' : '先回到对话页，或去项目页新建一个会话' }}
        </p>
      </div>
    </div>

    <ChatComposer />
  </div>
</template>
