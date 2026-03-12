<script setup lang="ts">
import { Wifi, WifiOff, MessageSquare, Clock, Folder, ChevronRight } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import { formatRelativeTime } from '@/lib/format'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()
const router = useRouter()

function formatSessionDirectory(directory?: string | null) {
  if (!directory) {
    return '未绑定项目目录'
  }

  const normalized = directory.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)

  if (segments.length <= 2) {
    return directory
  }

  return `.../${segments.slice(-2).join('/')}`
}

function openConversation(sessionId: string) {
  app.clearSessionListBadges(sessionId)
  void router.push({ name: 'session', params: { sessionId } })
}
</script>

<template>
  <div class="conversations-container">
    <header class="conversations-header">
      <div class="header-title">
        <h1>我的对话</h1>
        <span class="count-badge" v-if="app.sessions.value.length">
          {{ app.sessions.value.length }}
        </span>
      </div>
    </header>

    <main class="conversations-content">
      <div v-if="app.sessions.value.length" class="sessions-list">
        <Card
          v-for="session in app.sessions.value"
          :key="session.id"
          class="session-card"
          @click="openConversation(session.id)"
        >
          <div class="card-body">
            <div class="session-avatar-box">
              <div class="avatar-circle">
                {{ (session.title || session.directory || 'O').slice(0, 1).toUpperCase() }}
              </div>
            </div>

            <div class="session-info">
              <div class="session-top-row">
                <div class="session-heading">
                  <h3 class="session-title">{{ session.title || '未命名对话' }}</h3>
                  <div class="session-badges">
                    <Badge
                      v-for="badge in app.getSessionListBadges(session.id)"
                      :key="badge.key"
                      :tone="badge.tone"
                      class="session-badge"
                    >
                      {{ badge.label }}
                    </Badge>
                  </div>
                </div>
                <span class="session-time">
                  <Clock class="inline-icon" />
                  {{ formatRelativeTime(session.time.updated || session.time.created) }}
                </span>
              </div>
              
              <div class="session-meta">
                <p class="session-path">
                  <Folder class="inline-icon" />
                  {{ formatSessionDirectory(session.directory) }}
                </p>
              </div>
            </div>

            <div class="session-action">
              <ChevronRight class="h-5 w-5 text-muted-foreground opacity-30" />
            </div>
          </div>
        </Card>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-hero">
        <div class="hero-icon">
          <Wifi v-if="app.streamReady.value" class="h-10 w-10 text-primary" />
          <WifiOff v-else class="h-10 w-10 text-muted-foreground" />
        </div>
        <h2>{{ app.streamReady.value ? '还没有对话' : '服务连接已断开' }}</h2>
        <p>
          {{ app.streamReady.value 
            ? '您可以前往项目页选择一个项目并开启新的智能对话。' 
            : '请检查您的网络连接或在设置页面更新服务配置。' 
          }}
        </p>
        <div class="hero-actions">
          <Button v-if="app.streamReady.value" @click="router.push('/')">
            <MessageSquare class="h-4 w-4 mr-2" />
            浏览项目
          </Button>
          <Button v-else variant="outline" @click="router.push('/settings')">
            检查连接设置
          </Button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.conversations-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--background);
  color: var(--foreground);
}

.conversations-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem 1.25rem 1rem;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--background);
}

.header-title {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.header-title h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.02em;
}

.count-badge {
  font-size: 0.75rem;
  background: var(--muted);
  color: var(--muted-foreground);
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-weight: 500;
}

.conversations-content {
  flex: 1;
  padding: 0 1rem 2rem;
}

.sessions-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 800px;
  margin: 0 auto;
}

/* 对话卡片样式 */
.session-card {
  border-radius: 1rem;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid var(--border);
  background: var(--card);
  cursor: pointer;
}

.session-card:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--accent) 5%, var(--card));
  border-color: var(--primary);
  box-shadow: 0 8px 20px -12px rgba(0,0,0,0.1);
}

.card-body {
  padding: 1.125rem 1.25rem;
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.session-avatar-box {
  flex-shrink: 0;
}

.avatar-circle {
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 1rem;
  background: var(--primary);
  color: var(--primary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 700;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--primary) 15%, transparent);
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-top-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.375rem;
}

.session-heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.session-title {
  font-size: 1.0625rem;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--foreground);
}

.session-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  flex-shrink: 0;
}

.session-badge {
  padding: 0.25rem 0.55rem;
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.session-time {
  font-size: 0.75rem;
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.session-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.session-path {
  font-size: 0.8125rem;
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-icon {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
  opacity: 0.6;
}

.session-action {
  flex-shrink: 0;
  margin-left: 0.5rem;
}

/* 空状态 */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6rem 2rem;
  text-align: center;
}

.hero-icon {
  width: 5rem;
  height: 5rem;
  background: var(--muted);
  border-radius: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2rem;
}

.empty-hero h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0 0 1rem;
}

.empty-hero p {
  color: var(--muted-foreground);
  max-width: 20rem;
  margin: 0 0 2.5rem;
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  gap: 1rem;
}
</style>
