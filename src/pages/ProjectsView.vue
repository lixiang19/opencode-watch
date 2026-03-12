<script setup lang="ts">
import { computed } from 'vue'
import { FolderOpenDot, MessageCirclePlus, FolderSync, Clock } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import { formatRelativeTime } from '@/lib/format'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()
const router = useRouter()

function formatProjectDirectory(directory: string) {
  const normalized = directory.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)

  if (segments.length <= 2) {
    return directory
  }

  return `.../${segments.slice(-2).join('/')}`
}

const draftProject = computed(() => {
  const directory = app.draftDirectory.value.trim()
  if (!directory) {
    return null
  }

  const exists = app.projects.value.some((project) => project.directory === directory)
  if (exists) {
    return null
  }

  const segments = directory.split('/').filter(Boolean)

  return {
    directory,
    name: segments[segments.length - 1] || '新项目',
    sessionCount: 0,
    lastUpdated: Date.now()
  }
})

async function createForProject(directory: string) {
  app.draftDirectory.value = directory
  await app.createSession(directory)
  if (app.selectedSessionId.value) {
    void router.push({ name: 'session', params: { sessionId: app.selectedSessionId.value } })
  }
}

function useProjectDirectory(directory: string) {
  app.draftDirectory.value = directory
}

const hasProjects = computed(() => app.projects.value.length > 0 || !!draftProject.value)
</script>

<template>
  <div class="projects-container">
    <header class="projects-header">
      <div class="header-title">
        <h1>项目</h1>
        <span class="count-badge" v-if="app.projects.value.length">
          {{ app.projects.value.length }}
        </span>
      </div>
    </header>

    <main class="projects-content">
      <div v-if="hasProjects" class="project-grid">
        <!-- 草稿项目卡片 -->
        <Card v-if="draftProject" class="project-card draft-card">
          <div class="card-body" @click="useProjectDirectory(draftProject.directory)">
            <div class="card-header-row">
              <div class="project-icon-box draft">
                {{ draftProject.name.slice(0, 1).toUpperCase() }}
              </div>
              <div class="tag-row">
                <span class="status-tag draft">待载入</span>
              </div>
            </div>
            
            <div class="project-details">
              <h3 class="project-title">{{ draftProject.name }}</h3>
              <p class="project-path">
                <FolderSync class="inline-icon" />
                {{ formatProjectDirectory(draftProject.directory) }}
              </p>
            </div>
          </div>
          <div class="card-footer">
            <Button 
              block 
              class="action-btn"
              :disabled="!app.streamReady.value"
              @click.stop="createForProject(draftProject.directory)"
            >
              <MessageCirclePlus class="h-4 w-4 mr-2" />
              开启新对话
            </Button>
          </div>
        </Card>

        <!-- 已有项目卡片 -->
        <Card 
          v-for="project in app.projects.value" 
          :key="project.directory" 
          class="project-card"
        >
          <div class="card-body" @click="useProjectDirectory(project.directory)">
            <div class="card-header-row">
              <div class="project-icon-box">
                {{ project.name.slice(0, 1).toUpperCase() }}
              </div>
            </div>

            <div class="project-details">
              <h3 class="project-title">{{ project.name }}</h3>
              <p class="project-path">
                {{ formatProjectDirectory(project.directory) }}
              </p>
            </div>
          </div>
          
          <div class="card-footer">
            <div class="meta-info">
              <span class="meta-item">
                <Clock class="inline-icon" />
                {{ formatRelativeTime(project.lastUpdated) }}
              </span>
              <span class="meta-divider">•</span>
              <span class="meta-item">{{ project.sessionCount }} 个对话</span>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              class="action-btn-mini"
              :disabled="!app.streamReady.value"
              @click.stop="createForProject(project.directory)"
            >
              <MessageCirclePlus class="h-4 w-4" />
              新建对话
            </Button>
          </div>
        </Card>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-hero">
        <div class="hero-icon">
          <FolderOpenDot class="h-10 w-10" />
        </div>
        <h2>欢迎使用 OpenCode</h2>
        <p>这里将显示您最近活跃的项目。目前还没有发现任何项目。</p>
        <div class="hero-actions">
          <Button @click="router.push('/settings')">前往设置配置目录</Button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.projects-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--background);
  color: var(--foreground);
}

.projects-header {
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

.projects-content {
  flex: 1;
  padding: 0 1rem 2rem;
}

.project-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 800px;
  margin: 0 auto;
}

/* 卡片样式 */
.project-card {
  display: flex;
  flex-direction: column;
  border-radius: 1rem;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid var(--border);
  background: var(--card);
  cursor: pointer;
  position: relative;
}

.project-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px -10px rgba(0,0,0,0.1);
  border-color: var(--primary);
}

.draft-card {
  background: color-mix(in srgb, var(--primary) 5%, var(--card));
  border-style: dashed;
}

.card-body {
  padding: 1.25rem;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.card-header-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.project-icon-box {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  background: var(--primary);
  color: var(--primary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--primary) 20%, transparent);
  flex-shrink: 0;
}

.project-icon-box.draft {
  background: var(--accent);
  color: var(--accent-foreground);
}

.tag-row {
  display: flex;
  gap: 0.5rem;
}

.status-tag {
  font-size: 0.625rem;
  padding: 0.125rem 0.4rem;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
  white-space: nowrap;
}

.status-tag.draft {
  background: var(--accent);
  color: var(--accent-foreground);
}

.project-details {
  flex: 1;
  min-width: 0;
}

.project-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0 0 0.375rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--foreground);
}

.project-path {
  font-size: 0.8125rem;
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  word-break: break-all;
}

.inline-icon {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}

.card-footer {
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: color-mix(in srgb, var(--muted) 15%, transparent);
}

.meta-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}

.meta-divider {
  opacity: 0.3;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.action-btn {
  border-radius: 0.5rem;
  font-weight: 600;
  width: auto;
  min-width: 120px;
}

.action-btn-mini {
  border-radius: 0.625rem;
  padding: 0 1rem;
  height: 2.25rem;
  font-size: 0.8125rem;
  gap: 0.5rem;
}

/* 空状态 */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
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
  color: var(--muted-foreground);
}

.empty-hero h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0 0 1rem;
}

.empty-hero p {
  color: var(--muted-foreground);
  max-width: 20rem;
  margin: 0 0 2rem;
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  gap: 1rem;
}
</style>
