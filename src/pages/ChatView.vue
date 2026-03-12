<script setup lang="ts">
import { computed, watch } from 'vue'
import {
  ChevronLeft,
  Command,
  LoaderCircle,
  MessagesSquare,
  SendHorizonal,
  Settings2,
  Slash
} from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'

import MessageBubble from '@/components/chat/MessageBubble.vue'
import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import { useOpencodeState } from '@/lib/app-context'

const route = useRoute()
const router = useRouter()
const app = useOpencodeState()

const currentModeHint = computed(() =>
  app.composerMode.value === 'command'
    ? '命令会直接发给当前会话。'
    : '继续当前会话，不切上下文。'
)

const sessionStatusText = computed(() =>
  app.sessionStatus.value === 'busy' || app.isSending.value ? '处理中' : '空闲'
)

const quickCommands = ['/status', '/model', '/help', '/resume']

async function syncSessionFromRoute(sessionId?: string | string[]) {
  const value = Array.isArray(sessionId) ? sessionId[0] : sessionId

  if (!value) {
    return
  }

  if (app.selectedSessionId.value === value && app.messages.value.length) {
    return
  }

  await app.openSession(value)
}

function useQuickCommand(command: string) {
  app.composerMode.value = 'command'
  app.composerText.value = command
}

watch(
  () => route.params.sessionId,
  (sessionId) => {
    void syncSessionFromRoute(sessionId)
  },
  { immediate: true }
)
</script>

<template>
  <div class="chat-page">
    <header class="chat-header">
      <button class="icon-chip" type="button" @click="router.push({ name: 'home' })">
        <ChevronLeft class="h-5 w-5" />
      </button>

      <div class="min-w-0 flex-1 text-center">
        <p class="line-clamp-1 text-[15px] font-semibold text-slate-950">
          {{ app.activeSession.value?.title || '选择会话开始' }}
        </p>
        <p class="line-clamp-1 text-xs text-slate-500">
          {{ app.selectedProjectMeta.value?.name || app.draftDirectory.value || '请先选择项目' }}
        </p>
      </div>

      <button class="icon-chip" type="button" @click="router.push({ name: 'settings' })">
        <Settings2 class="h-5 w-5" />
      </button>
    </header>

    <div class="chat-status-row">
      <Badge :tone="app.streamReady.value ? 'success' : 'muted'">{{ app.connectionStateLabel.value }}</Badge>
      <Badge :tone="app.sessionStatus.value === 'busy' || app.isSending.value ? 'accent' : 'muted'">
        {{ sessionStatusText }}
      </Badge>
      <Badge :tone="app.composerMode.value === 'command' ? 'accent' : 'muted'">
        {{ app.composerMode.value === 'command' ? '命令模式' : '对话模式' }}
      </Badge>
    </div>

    <section class="chat-stream soft-scrollbar">
      <div v-if="app.lastError.value" class="alert-card">
        {{ app.lastError.value }}
      </div>

      <div v-if="app.isLoadingSession.value" class="loading-card">
        <LoaderCircle class="h-4 w-4 animate-spin" />
        正在恢复历史消息...
      </div>

      <template v-if="app.messages.value.length">
        <MessageBubble v-for="message in app.messages.value" :key="message.id" :message="message" />
      </template>

      <div v-else class="chat-empty-state">
        <div class="chat-empty-icon">
          <MessagesSquare class="h-6 w-6" />
        </div>
        <p class="text-base font-semibold text-slate-950">还没有消息</p>
        <p class="text-sm leading-6 text-slate-500">
          回到首页选一个历史会话，或者直接在这里输入第一条消息开始。
        </p>
      </div>
    </section>

    <footer class="composer-shell">
      <div class="mode-switcher">
        <button
          type="button"
          class="mode-switcher-item"
          :class="app.composerMode.value === 'prompt' ? 'mode-switcher-item-active' : ''"
          @click="app.composerMode.value = 'prompt'"
        >
          <MessagesSquare class="h-4 w-4" />
          对话
        </button>
        <button
          type="button"
          class="mode-switcher-item"
          :class="app.composerMode.value === 'command' ? 'mode-switcher-item-active' : ''"
          @click="app.composerMode.value = 'command'"
        >
          <Command class="h-4 w-4" />
          命令
        </button>
      </div>

      <div v-if="app.composerMode.value === 'command'" class="quick-command-row soft-scrollbar">
        <button
          v-for="command in quickCommands"
          :key="command"
          type="button"
          class="quick-command-chip"
          @click="useQuickCommand(command)"
        >
          <Slash class="h-3.5 w-3.5" />
          {{ command }}
        </button>
      </div>

      <div class="composer-card">
        <Textarea
          v-model="app.composerText.value"
          :disabled="!app.streamReady.value || app.isSending.value"
          :placeholder="app.composerMode.value === 'command' ? '/status' : '继续当前 opencode 对话…'"
          class="composer-textarea"
          @keydown.ctrl.enter.prevent="app.sendCurrentMessage"
          @keydown.meta.enter.prevent="app.sendCurrentMessage"
        />

        <div class="composer-actions">
          <p class="text-xs leading-5 text-slate-500">{{ currentModeHint }}</p>
          <Button :disabled="!app.streamReady.value || app.isSending.value" class="h-12 min-w-[112px] rounded-2xl" @click="app.sendCurrentMessage">
            <LoaderCircle v-if="app.isSending.value" class="h-4 w-4 animate-spin" />
            <SendHorizonal v-else class="h-4 w-4" />
            {{ app.composerMode.value === 'command' ? '发送命令' : '发送消息' }}
          </Button>
        </div>
      </div>
    </footer>
  </div>
</template>
