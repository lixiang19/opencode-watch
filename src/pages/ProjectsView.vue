<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, FolderOpenDot, MessageCirclePlus } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Button from '@/components/ui/button/Button.vue'
import { formatRelativeTime } from '@/lib/format'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()
const router = useRouter()

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
    name: segments[segments.length - 1] || '临时项目',
    sessionCount: 0,
    lastUpdated: Date.now()
  }
})

async function createForProject(directory: string) {
  app.selectedProject.value = directory
  app.draftDirectory.value = directory
  await app.createSession(directory)
  if (app.selectedSessionId.value) {
    void router.push({ name: 'session', params: { sessionId: app.selectedSessionId.value } })
  }
}

function selectProject(directory: string) {
  app.selectedProject.value = directory
  app.draftDirectory.value = directory
}
</script>

<template>
  <section class="page projects-page">
    <header class="wechat-header">
      <div class="page-intro">
        <p class="wechat-overline">工作区</p>
        <h1 class="wechat-title">项目</h1>
        <p class="page-copy">用更清晰的项目卡片组织上下文，减少切换时的视觉干扰。</p>
      </div>
      <div class="project-badge">{{ app.projects.value.length }} 个项目</div>
    </header>

    <div class="project-current">
      <div>
        <p class="card-kicker">当前项目</p>
        <h2>{{ app.selectedProjectMeta.value?.name || '还没选项目' }}</h2>
        <p>{{ app.selectedProject.value || app.draftDirectory.value || '在下面选一个项目，或先去设置输入项目路径。' }}</p>
      </div>
    </div>

    <div class="project-list">
      <article v-if="draftProject" class="project-card project-card-draft">
        <button type="button" class="project-card-main" @click="selectProject(draftProject.directory)">
          <div class="project-icon"><FolderOpenDot class="h-5 w-5" /></div>
          <div class="project-card-content">
            <h3>{{ draftProject.name }}</h3>
            <p>{{ draftProject.directory }}</p>
            <span>来自设置页草稿路径</span>
          </div>
        </button>
        <Button size="sm" class="project-create-btn" :disabled="!app.streamReady.value" @click="createForProject(draftProject.directory)">
          <MessageCirclePlus class="h-4 w-4" />
          新建对话
        </Button>
      </article>

      <article
        v-for="project in app.projects.value"
        :key="project.directory"
        class="project-card"
        :class="{ 'project-card-active': app.selectedProject.value === project.directory }"
      >
        <button type="button" class="project-card-main" @click="selectProject(project.directory)">
          <div class="project-icon"><FolderOpenDot class="h-5 w-5" /></div>
          <div class="project-card-content">
            <div class="project-card-top">
              <h3>{{ project.name }}</h3>
              <ArrowRight class="h-4 w-4" />
            </div>
            <p>{{ project.directory }}</p>
            <span>{{ project.sessionCount }} 个对话 · {{ formatRelativeTime(project.lastUpdated) }}</span>
          </div>
        </button>

        <Button size="sm" class="project-create-btn" :disabled="!app.streamReady.value" @click="createForProject(project.directory)">
          <MessageCirclePlus class="h-4 w-4" />
          新建对话
        </Button>
      </article>

      <div v-if="!app.projects.value.length && !draftProject" class="empty-state">
        <div class="empty-icon"><FolderOpenDot class="h-6 w-6" /></div>
        <h2>还没有项目</h2>
        <p>连接成功后会自动拉取服务端项目，或者先在设置页填一个本地目录。</p>
      </div>
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

.wechat-overline,
.card-kicker {
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

.page-copy,
.project-current p,
.project-card p,
.project-card span,
.empty-state p {
  color: var(--muted-foreground);
}

.page-copy {
  margin: 0.75rem 0 0;
  line-height: 1.7;
}

.project-badge,
.project-current,
.project-card {
  border: 1px solid var(--border);
  background: var(--card);
  box-shadow: var(--shadow-lg);
}

.project-badge {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  padding: 0 1rem;
  border-radius: 999px;
  color: var(--muted-foreground);
}

.project-current {
  padding: 1.25rem;
  border-radius: 1.5rem;
}

.project-current h2,
.project-card h3 {
  margin: 0;
  color: var(--foreground);
}

.project-current p {
  margin: 0.375rem 0 0;
  line-height: 1.7;
}

.project-list {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.project-card {
  display: grid;
  gap: 0.875rem;
  padding: 1rem;
  border-radius: 1.5rem;
}

.project-card-active {
  border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
}

.project-card-draft {
  background: color-mix(in srgb, var(--accent) 38%, var(--card));
}

.project-card-main {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.875rem;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}

.project-card-content {
  min-width: 0;
}

.project-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.625rem;
}

.project-card p {
  margin: 0.375rem 0;
  line-height: 1.6;
  word-break: break-word;
}

.project-card span {
  font-size: 0.8125rem;
}

.project-icon,
.empty-icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 1rem;
  background: var(--accent);
  color: var(--accent-foreground);
}

.project-create-btn {
  width: 100%;
  justify-content: center;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 2.5rem 1.5rem;
  text-align: center;
}

.empty-state h2 {
  margin: 0;
}

.empty-state p {
  max-width: 18rem;
  margin: 0;
  line-height: 1.7;
}

@media (min-width: 640px) {
  .project-card {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .project-create-btn {
    width: auto;
    min-width: 7.5rem;
  }
}
</style>
