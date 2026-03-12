<script setup lang="ts">
import { Wifi, WifiOff } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import { formatRelativeTime } from '@/lib/format'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()
const router = useRouter()

function openConversation(sessionId: string) {
  void router.push({ name: 'session', params: { sessionId } })
}
</script>

<template>
  <section class="page conversations-page">
    <header class="wechat-header">
      <div class="page-intro">
        <p class="wechat-overline">消息中心</p>
        <h1 class="wechat-title">对话</h1>
        <p class="page-copy">保持最近上下文触手可达，快速回到每一次协作现场。</p>
      </div>

      <div class="status-chip" :class="app.streamReady.value ? 'status-chip-online' : 'status-chip-offline'">
        <Wifi v-if="app.streamReady.value" class="h-4 w-4" />
        <WifiOff v-else class="h-4 w-4" />
        <span>{{ app.streamReady.value ? '实时连接' : '等待连接' }}</span>
      </div>
    </header>

    <div class="list-panel">
      <div v-if="!app.sessions.value.length" class="empty-state empty-state-large">
        <div class="empty-icon">
          <Wifi v-if="app.streamReady.value" class="h-6 w-6" />
          <WifiOff v-else class="h-6 w-6" />
        </div>
        <h2>{{ app.streamReady.value ? '还没有对话' : '尚未连接服务' }}</h2>
        <p>{{ app.streamReady.value ? '去项目页选一个项目，然后点“新建对话”。' : '先完成认证并建立连接。' }}</p>
      </div>

      <button
        v-for="session in app.sessions.value"
        :key="session.id"
        type="button"
        class="wechat-row"
        @click="openConversation(session.id)"
      >
        <div class="wechat-avatar">{{ (session.title || session.directory || 'O').slice(0, 1).toUpperCase() }}</div>
        <div class="wechat-row-body">
          <div class="wechat-row-top">
            <strong>{{ session.title || '未命名对话' }}</strong>
            <span>{{ formatRelativeTime(session.time.updated || session.time.created) }}</span>
          </div>
          <div class="wechat-row-bottom">
            <span>{{ session.directory || '未绑定项目目录' }}</span>
          </div>
        </div>
      </button>
    </div>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 1rem;
  padding-top: calc(env(safe-area-inset-top) + 1rem);
}

.wechat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.page-intro {
  max-width: 34rem;
}

.wechat-overline {
  margin: 0 0 0.5rem;
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.wechat-title {
  margin: 0;
  color: var(--foreground);
  font-size: clamp(2rem, 6vw, 3rem);
  line-height: 1;
}

.page-copy {
  margin: 0.75rem 0 0;
  color: var(--muted-foreground);
  line-height: 1.7;
}

.status-chip {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  gap: 0.5rem;
  align-self: flex-start;
  padding: 0 1rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  color: var(--muted-foreground);
  box-shadow: var(--shadow-sm);
}

.status-chip-online {
  border-color: color-mix(in srgb, var(--primary) 28%, var(--border));
  color: var(--foreground);
}

.status-chip-offline {
  border-color: color-mix(in srgb, var(--destructive) 28%, var(--border));
  color: var(--destructive);
}

.list-panel {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: var(--card);
  box-shadow: var(--shadow-lg);
}

.wechat-row {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.875rem;
  padding: 1rem 1.125rem;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  background: transparent;
  text-align: left;
  transition: background-color 0.2s ease;
}

.wechat-row:hover {
  background: color-mix(in srgb, var(--accent) 42%, transparent);
}

.wechat-row:last-child {
  border-bottom: 0;
}

.wechat-avatar {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 1rem;
  background: var(--primary);
  color: var(--primary-foreground);
  font-weight: 700;
}

.wechat-row-body {
  min-width: 0;
}

.wechat-row-top,
.wechat-row-bottom {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.wechat-row-top strong {
  overflow: hidden;
  color: var(--foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wechat-row-top span,
.wechat-row-bottom span {
  color: var(--muted-foreground);
  font-size: 0.8125rem;
}

.wechat-row-bottom {
  margin-top: 0.375rem;
}

.empty-state {
  display: flex;
  min-height: 50vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 2.5rem 1.5rem;
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 1rem;
  background: var(--accent);
  color: var(--accent-foreground);
}

.empty-state h2 {
  margin: 0;
}

.empty-state p {
  max-width: 18rem;
  margin: 0;
  color: var(--muted-foreground);
  line-height: 1.7;
}
</style>
