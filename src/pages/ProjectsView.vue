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
      <div>
        <p class="wechat-overline">工作区</p>
        <h1 class="wechat-title">项目</h1>
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
          <div>
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
          <div>
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
