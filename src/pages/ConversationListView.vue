<script setup lang="ts">
import { computed } from 'vue'
import { Wifi, WifiOff, MessageSquare, Clock, Folder, ChevronRight } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import { formatRelativeTime } from '@/lib/format'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()
const router = useRouter()

const projectLookup = computed(() => {
  const byDirectory = new Map<string, (typeof app.projects.value)[number]>()
  const byId = new Map<string, (typeof app.projects.value)[number]>()

  for (const project of app.projects.value) {
    byDirectory.set(project.directory, project)
    if (project.projectId) {
      byId.set(project.projectId, project)
    }
  }

  return {
    byDirectory,
    byId
  }
})

const ICON_COLOR_VALUES: Record<string, string> = {
  pink: '#e85d75',
  mint: '#24b48a',
  orange: '#e98a1d',
  purple: '#7c62f2',
  cyan: '#1597b8',
  lime: '#7aac20'
}

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

function getSessionInitial(title?: string, directory?: string | null) {
  return (title || directory || 'O').slice(0, 1).toUpperCase()
}

function getSessionProjectIcon(session: (typeof app.sessions.value)[number]) {
  const project =
    (session.project?.id ? projectLookup.value.byId.get(session.project.id) : undefined) ||
    (session.directory ? projectLookup.value.byDirectory.get(session.directory) : undefined)

  return project?.icon?.override || project?.icon?.url || session.project?.icon?.override || session.project?.icon?.url || ''
}

function getSessionProjectIconStyle(session: (typeof app.sessions.value)[number]) {
  const project =
    (session.project?.id ? projectLookup.value.byId.get(session.project.id) : undefined) ||
    (session.directory ? projectLookup.value.byDirectory.get(session.directory) : undefined)
  const accentKey = project?.icon?.color || session.project?.icon?.color || ''
  const accent = accentKey ? ICON_COLOR_VALUES[accentKey] : ''
  return accent ? { '--session-icon-accent': accent } : undefined
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
        <div
          v-for="session in app.sessions.value"
          :key="session.id"
          class="session-item"
          @click="openConversation(session.id)"
        >
          <div class="session-avatar-box">
            <div class="avatar-circle" :style="getSessionProjectIconStyle(session)">
              <img
                v-if="getSessionProjectIcon(session)"
                :src="getSessionProjectIcon(session)"
                alt=""
                class="avatar-image"
              />
              <span v-else>{{ getSessionInitial(session.title, session.directory) }}</span>
            </div>
            <!-- 可以后续添加未读红点 -->
          </div>

          <div class="session-info">
            <div class="session-top-row">
              <h3 class="session-title">{{ session.title || '未命名对话' }}</h3>
              <span class="session-time">
                {{ formatRelativeTime(session.time.updated || session.time.created) }}
              </span>
            </div>
            
            <div class="session-bottom-row">
              <p class="session-preview">
                {{ formatSessionDirectory(session.directory) }}
              </p>
              <div class="session-badges" v-if="app.getSessionListBadges(session.id).length">
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
          </div>
        </div>
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
  padding: 1.25rem 1rem 0.75rem;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--background);
  border-bottom: 0.5px solid color-mix(in srgb, var(--border) 40%, transparent);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-title h1 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
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
  padding: 0;
}

.sessions-list {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  margin: 0;
}

/* 聊天列表项样式 */
.session-item {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  cursor: pointer;
  transition: background-color 0.15s ease;
  border-bottom: 0.5px solid color-mix(in srgb, var(--border) 40%, transparent);
}

.session-item:last-child {
  border-bottom: none;
}

.session-item:hover {
  background-color: color-mix(in srgb, var(--accent) 8%, transparent);
}

.session-avatar-box {
  flex-shrink: 0;
  position: relative;
}

.avatar-circle {
  --session-icon-accent: var(--primary);
  width: 3rem;
  height: 3rem;
  border-radius: 0.75rem;
  background: var(--session-icon-accent);
  color: var(--primary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
  font-weight: 600;
  overflow: hidden;
  /* 聊天软件风格：更清爽的头像，不带过多阴影 */
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.session-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.session-title {
  font-size: 1rem;
  font-weight: 500;
  margin: 0;
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-time {
  font-size: 0.75rem;
  color: var(--muted-foreground);
  flex-shrink: 0;
  font-weight: 400;
}

.session-bottom-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.session-preview {
  font-size: 0.8125rem;
  color: var(--muted-foreground);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  line-height: 1.25rem;
}

.session-badges {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.session-badge {
  padding: 0.125rem 0.375rem;
  font-size: 0.625rem;
  border-radius: 4px;
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
