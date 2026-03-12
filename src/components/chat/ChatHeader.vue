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
    <button class="btn-back" type="button" @click="goBack">
      <ArrowLeft class="h-4 w-4" />
    </button>

    <div class="topbar-center">
      <div class="topbar-session-name">{{ app.activeSession.value?.title || '对话详情' }}</div>
      <div class="topbar-project-name">{{ app.activeSession.value?.directory || '未绑定项目' }}</div>
    </div>

    <div class="topbar-right">
      <Badge v-if="statusText" tone="accent" class="status-badge">
        <LoaderCircle class="h-3 w-3 animate-spin" />
        {{ statusText }}
      </Badge>
      <span
        class="connection-pill"
        :class="app.streamReady.value ? 'pill-connected' : 'pill-disconnected'"
      >
        <span class="connection-dot" />
        {{ app.streamReady.value ? '已连接' : '未连接' }}
      </span>
    </div>
  </header>
</template>

<style scoped>
.chat-topbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.875rem;
  padding: calc(env(safe-area-inset-top) + 0.875rem) 1rem 0.875rem;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}

.btn-back {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--background);
  color: var(--foreground);
  transition: background 0.15s, color 0.15s;
  cursor: pointer;
}

.btn-back:hover {
  background: var(--accent);
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

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
</style>
