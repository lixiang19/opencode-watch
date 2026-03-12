<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, LoaderCircle } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Badge from '@/components/ui/badge/Badge.vue'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()
const router = useRouter()

const statusText = computed(() =>
  app.sessionStatus.value === 'busy' || app.isSending.value ? '处理中' : ''
)

function goBack() {
  void router.push({ name: 'conversations' })
}
</script>

<template>
  <header class="chat-topbar">
    <button class="btn-icon" type="button" @click="goBack">
      <ArrowLeft class="h-5 w-5" />
    </button>

    <div class="topbar-title">
      <div class="topbar-session-name">{{ app.activeSession.value?.title || '对话详情' }}</div>
      <div class="topbar-project-name">{{ app.selectedProjectMeta.value?.name || app.activeSession.value?.directory || '未绑定项目' }}</div>
    </div>

    <div class="topbar-right">
      <Badge v-if="statusText" tone="accent" class="text-[10px] px-2 py-0.5">
        <LoaderCircle class="h-3 w-3 animate-spin mr-1" />
        {{ statusText }}
      </Badge>
      <div class="connection-dot" :class="app.streamReady.value ? 'dot-connected' : 'dot-disconnected'" />
    </div>
  </header>
</template>

<style scoped>
.chat-topbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  padding: calc(env(safe-area-inset-top) + 1rem) 1rem 0.875rem;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}

.btn-icon {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.topbar-title {
  min-width: 0;
}

.topbar-session-name {
  overflow: hidden;
  color: var(--foreground);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-project-name {
  overflow: hidden;
  margin-top: 0.25rem;
  color: var(--muted-foreground);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.connection-dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 999px;
}

.dot-connected {
  background: var(--primary);
}

.dot-disconnected {
  background: var(--muted-foreground);
  opacity: 0.45;
}
</style>
