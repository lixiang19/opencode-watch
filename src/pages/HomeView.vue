<script setup lang="ts">
import { computed } from 'vue'
import { BellDot, ChevronRight, Plus, Radio, Sparkles } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import { useOpencodeState } from '@/lib/app-context'
import { formatRelativeTime } from '@/lib/format'

const router = useRouter()
const app = useOpencodeState()

const activeProjectTitle = computed(
  () => app.selectedProjectMeta.value?.name || app.projects.value[0]?.name || '选择一个项目继续'
)

const activeSessionTitle = computed(
  () => app.activeSession.value?.title || app.filteredSessions.value[0]?.title || '还没有打开的会话'
)

const connectionTone = computed(() => {
  if (app.lastError.value) {
    return 'danger'
  }

  return app.streamReady.value ? 'success' : 'muted'
})

const connectionText = computed(() => {
  if (app.lastError.value) {
    return '连接异常'
  }

  return app.streamReady.value ? '已连接' : '未连接'
})

function openChat(sessionId?: string) {
  if (sessionId) {
    void app.openSession(sessionId)
    void router.push({ name: 'chat', params: { sessionId } })
    return
  }

  if (app.selectedSessionId.value) {
    void router.push({ name: 'chat', params: { sessionId: app.selectedSessionId.value } })
    return
  }

  void router.push({ name: 'chat' })
}

async function createAndOpenSession() {
  await app.createSession()

  if (app.selectedSessionId.value) {
    void router.push({ name: 'chat', params: { sessionId: app.selectedSessionId.value } })
  }
}

function selectProject(directory: string) {
  app.selectedProject.value = directory
}
</script>

<template>
  <div class="screen-page">
    <section class="hero-panel">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-3">
          <Badge :tone="connectionTone">{{ connectionText }}</Badge>
          <div class="space-y-2">
            <p class="eyebrow">Opencode Watch</p>
            <h1 class="text-[1.9rem] font-semibold leading-tight tracking-[-0.05em] text-slate-950">
              把会话像消息流一样继续下去。
            </h1>
          </div>
        </div>

        <button class="icon-chip" type="button" @click="router.push({ name: 'settings' })">
          <BellDot class="h-5 w-5" />
        </button>
      </div>

      <div class="glass-strip mt-5">
        <div>
          <p class="eyebrow">当前项目</p>
          <p class="mt-1 text-sm font-semibold text-slate-950">{{ activeProjectTitle }}</p>
        </div>
        <div class="text-right">
          <p class="eyebrow">当前会话</p>
          <p class="mt-1 line-clamp-1 text-sm font-semibold text-slate-950">{{ activeSessionTitle }}</p>
        </div>
      </div>

      <div class="mt-5 flex gap-3">
        <Button class="flex-1" @click="openChat(app.selectedSessionId.value)">
          <Sparkles class="h-4 w-4" />
          继续聊天
        </Button>
        <Button variant="outline" class="flex-1" :disabled="!app.canCreateSession.value" @click="createAndOpenSession">
          <Plus class="h-4 w-4" />
          新会话
        </Button>
      </div>
    </section>

    <section class="section-block">
      <div class="section-head">
        <div>
          <p class="eyebrow">项目筛选</p>
          <h2 class="section-title">最近项目</h2>
        </div>
        <span class="section-meta">{{ app.projects.value.length }} 个</span>
      </div>

      <div class="project-pill-row soft-scrollbar">
        <button
          v-for="project in app.projects.value"
          :key="project.directory"
          type="button"
          class="project-pill"
          :class="app.selectedProject.value === project.directory ? 'project-pill-active' : ''"
          @click="selectProject(project.directory)"
        >
          <span class="truncate">{{ project.name }}</span>
          <span class="project-pill-count">{{ project.sessionCount }}</span>
        </button>
      </div>
    </section>

    <section class="section-block pb-6">
      <div class="section-head">
        <div>
          <p class="eyebrow">会话流</p>
          <h2 class="section-title">继续上次上下文</h2>
        </div>
        <span class="section-meta">{{ app.filteredSessions.value.length }} 条</span>
      </div>

      <div class="mt-4 space-y-3">
        <Card
          v-for="session in app.filteredSessions.value"
          :key="session.id"
          class="session-card cursor-pointer"
          @click="openChat(session.id)"
        >
          <div class="flex items-start gap-3">
            <div class="session-avatar">
              <Radio class="h-4 w-4" />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="line-clamp-1 text-[15px] font-semibold text-slate-950">
                    {{ session.title || '未命名会话' }}
                  </p>
                  <p class="mt-1 line-clamp-1 text-xs text-slate-500">
                    {{ formatRelativeTime(session.time.updated || session.time.created) }} · {{ session.directory || '未绑定项目' }}
                  </p>
                </div>
                <ChevronRight class="mt-1 h-4 w-4 shrink-0 text-slate-400" />
              </div>

              <div class="mt-3 flex items-center gap-2">
                <Badge :tone="app.selectedSessionId.value === session.id ? 'accent' : 'muted'">
                  {{ app.selectedSessionId.value === session.id ? '当前' : session.id.slice(0, 6) }}
                </Badge>
                <span class="text-[11px] text-slate-400">轻触继续对话</span>
              </div>
            </div>
          </div>
        </Card>

        <Card v-if="!app.filteredSessions.value.length" class="empty-card">
          <p class="text-sm font-semibold text-slate-900">这个项目还没有会话</p>
          <p class="mt-2 text-sm leading-6 text-slate-500">
            先去设置里确认连接，再创建一个新会话，后面它就会像消息一样出现在这里。
          </p>
        </Card>
      </div>
    </section>
  </div>
</template>
