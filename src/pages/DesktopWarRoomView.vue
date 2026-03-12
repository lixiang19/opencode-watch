<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useRouter } from 'vue-router'
import { FolderSync, LoaderCircle, Sparkles, X } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatPane from '@/components/chat/ChatPane.vue'
import ConversationListView from '@/pages/ConversationListView.vue'
import ProjectsView from '@/pages/ProjectsView.vue'
import { useOpencodeStore } from '@/stores/opencode'

const app = useOpencodeStore()
const router = useRouter()

const orderedSessions = computed(() => app.sessions)
const openPanelIds = ref<string[]>([])
const panelLoadingState = ref<Record<string, boolean>>({})

let restoreRouterPush: null | ((to: RouteLocationRaw) => Promise<unknown>) = null

const openSessions = computed(() => {
  const sessionMap = new Map(orderedSessions.value.map((session) => [session.id, session] as const))
  return openPanelIds.value
    .map((sessionId) => sessionMap.get(sessionId))
    .filter((session): session is (typeof orderedSessions.value)[number] => Boolean(session))
})

function formatSessionDirectory(directory?: string | null) {
  if (!directory) {
    return '未绑定项目目录'
  }

  const normalized = directory.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/').filter(Boolean)

  if (segments.length <= 2) {
    return directory
  }

  return `.../${segments.slice(-2).join('/')}`
}

function getWindowMessages(sessionId: string) {
  if (app.selectedSessionId === sessionId) {
    return app.visibleMessages
  }

  return app.sessionPreviewMessages[sessionId] || []
}

async function openPanel(sessionId: string) {
  if (!sessionId) {
    return
  }

  app.clearSessionListBadges(sessionId)

  if (!openPanelIds.value.includes(sessionId)) {
    openPanelIds.value = [...openPanelIds.value, sessionId]
  }

  if (app.selectedSessionId === sessionId || app.sessionPreviewMessages[sessionId]?.length) {
    panelLoadingState.value = {
      ...panelLoadingState.value,
      [sessionId]: false
    }
    return
  }

  panelLoadingState.value = {
    ...panelLoadingState.value,
    [sessionId]: true
  }

  await nextTick()
  void app.loadSessionPreview(sessionId, { limit: 40 }).finally(() => {
    panelLoadingState.value = {
      ...panelLoadingState.value,
      [sessionId]: false
    }
  })
}

function closePanel(sessionId: string) {
  openPanelIds.value = openPanelIds.value.filter((id) => id !== sessionId)
  const nextState = { ...panelLoadingState.value }
  delete nextState[sessionId]
  panelLoadingState.value = nextState
}

async function loadOlderForPanel(sessionId: string) {
  if (!sessionId) {
    return
  }

  if (app.selectedSessionId !== sessionId) {
    await app.openSession(sessionId)
  }

  await app.loadOlderMessages()
}

function getSessionIdFromRoute(to: RouteLocationRaw) {
  if (typeof to === 'string') {
    const match = to.match(/^\/conversations\/([^/?#]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  }

  if ('name' in to && to.name === 'session') {
    const raw = to.params?.sessionId
    return Array.isArray(raw) ? String(raw[0] || '') : String(raw || '')
  }

  if ('path' in to && typeof to.path === 'string') {
    const match = to.path.match(/^\/conversations\/([^/?#]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  }

  return ''
}

function installDesktopRouterBridge() {
  const originalPush = router.push.bind(router)
  restoreRouterPush = (to: RouteLocationRaw) => originalPush(to)

  router.push = ((to: RouteLocationRaw) => {
    if (router.currentRoute.value.name === 'desktop-war-room') {
      const sessionId = getSessionIdFromRoute(to)
      if (sessionId) {
        void openPanel(sessionId)
        return Promise.resolve(router.currentRoute.value)
      }
    }

    return originalPush(to)
  }) as typeof router.push
}

function restoreDesktopRouterBridge() {
  if (!restoreRouterPush) {
    return
  }

  router.push = restoreRouterPush as typeof router.push
  restoreRouterPush = null
}

onMounted(() => {
  installDesktopRouterBridge()
  void app.preloadHomeData()
})

onBeforeUnmount(() => {
  restoreDesktopRouterBridge()
})

watch(
  () => app.authValidated,
  (ready) => {
    if (!ready) {
      return
    }

    void app.preloadHomeData()
  },
  { immediate: true }
)

watch(
  () => orderedSessions.value.map((session) => session.id).join(','),
  () => {
    const validIds = new Set(orderedSessions.value.map((session) => session.id))
    openPanelIds.value = openPanelIds.value.filter((sessionId) => validIds.has(sessionId))
    panelLoadingState.value = Object.fromEntries(
      Object.entries(panelLoadingState.value).filter(([sessionId]) => validIds.has(sessionId))
    )
  },
  { immediate: true }
)
</script>

<template>
  <div class="desktop-page">
    <div class="desktop-note">
      <Sparkles class="h-4 w-4" />
      <span>左侧复用移动端列表，右侧聊天窗复用和手机端同一套聊天面板。</span>
    </div>

    <div class="desktop-shell">
      <aside class="desktop-pane pane-projects">
        <ProjectsView />
      </aside>

      <aside class="desktop-pane pane-conversations">
        <ConversationListView />
      </aside>

      <main class="desktop-chat-stage">
        <div v-if="openSessions.length" class="chat-grid soft-scrollbar">
          <template v-for="session in openSessions" :key="session.id">
            <section v-if="panelLoadingState[session.id]" class="chat-window-placeholder">
              <header class="chat-window-placeholder-header">
                <div class="chat-window-copy">
                  <strong>{{ session.title || '未命名对话' }}</strong>
                  <span>{{ formatSessionDirectory(session.directory) }}</span>
                </div>

                <button type="button" class="chat-window-close" @click="closePanel(session.id)">
                  <X class="h-4 w-4" />
                </button>
              </header>

              <div class="chat-window-placeholder-body">
                <div class="placeholder-pill">
                  <LoaderCircle class="h-4 w-4 animate-spin" />
                  <span>正在打开对话…</span>
                </div>
                <div class="placeholder-bubble placeholder-bubble-short"></div>
                <div class="placeholder-bubble placeholder-bubble-long"></div>
                <div class="placeholder-bubble placeholder-bubble-mid placeholder-bubble-right"></div>
              </div>

              <div class="chat-window-placeholder-composer">
                <div class="placeholder-composer"></div>
              </div>
            </section>

            <ChatPane
              v-else
              embedded
              :title="session.title || '未命名对话'"
              :project-name="formatSessionDirectory(session.directory)"
              :messages="getWindowMessages(session.id)"
              :connected="app.streamReady"
              :busy="app.selectedSessionId === session.id && (app.sessionStatus === 'busy' || app.isSending)"
              :is-loading="app.selectedSessionId === session.id && app.isLoadingSession"
              :last-error="app.selectedSessionId === session.id ? app.lastError : ''"
              :has-truncated-messages="app.selectedSessionId === session.id && app.hasTruncatedMessages"
              :history-limit="app.historyMessageLimit"
              :show-working-indicator="app.selectedSessionId === session.id"
              empty-text="暂无消息"
            >
              <template #trailing>
                <button type="button" class="chat-window-close" @click="closePanel(session.id)">
                  <X class="h-4 w-4" />
                </button>
              </template>

              <template #history-action>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="app.isLoadingOlderMessages || app.selectedSessionId !== session.id"
                  @click="loadOlderForPanel(session.id)"
                >
                  <LoaderCircle v-if="app.isLoadingOlderMessages && app.selectedSessionId === session.id" class="h-3.5 w-3.5 animate-spin" />
                  <template v-else>加载更早</template>
                </Button>
              </template>

              <template #composer>
                <ChatComposer embedded :session-id="session.id" />
              </template>
            </ChatPane>
          </template>
        </div>

        <div v-else class="desktop-empty-stage">
          <div class="desktop-empty-card">
            <FolderSync class="h-5 w-5" />
            <strong>右侧还没有打开对话</strong>
            <p>从中间对话列表点开，或在左侧项目里新建对话后，它才会出现在这里。</p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.desktop-page {
  min-height: 100vh;
  padding: 1rem;
  overflow: auto;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--primary) 12%, transparent), transparent 24%),
    radial-gradient(circle at bottom right, color-mix(in srgb, var(--accent-foreground) 8%, transparent), transparent 22%),
    var(--background);
  color: var(--foreground);
}

.desktop-note {
  display: none;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--card) 92%, transparent);
  color: var(--muted-foreground);
}

.desktop-shell {
  display: grid;
  grid-template-columns: 22rem 22rem minmax(0, 1fr);
  gap: 1rem;
  min-width: 1580px;
  height: calc(100vh - 2rem);
}

.desktop-pane {
  min-height: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  border-radius: 1.5rem;
  background: color-mix(in srgb, var(--card) 94%, transparent);
  box-shadow: var(--shadow-xl);
  backdrop-filter: blur(20px);
}

.desktop-pane :deep(.projects-container),
.desktop-pane :deep(.conversations-container) {
  min-height: 100%;
  height: 100%;
  background: transparent;
}

.desktop-pane :deep(.projects-header),
.desktop-pane :deep(.conversations-header) {
  background: color-mix(in srgb, var(--card) 94%, transparent);
}

.desktop-pane :deep(.projects-content),
.desktop-pane :deep(.conversations-content) {
  min-height: 0;
  overflow-y: auto;
}

.desktop-pane :deep(.project-grid) {
  max-width: none;
}

.desktop-pane :deep(.empty-hero) {
  min-height: calc(100% - 4.5rem);
}

.desktop-chat-stage {
  min-height: 0;
}

.chat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  height: 100%;
  overflow-y: auto;
}

.chat-window-close {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 0.8rem;
  background: var(--background);
  color: var(--muted-foreground);
}

.chat-window-placeholder {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 34rem;
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: var(--card);
  overflow: hidden;
}

.chat-window-placeholder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.95rem 1rem 0.85rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  background: color-mix(in srgb, var(--card) 96%, transparent);
}

.chat-window-placeholder-body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1rem;
}

.placeholder-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  width: fit-content;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted-foreground);
  background: color-mix(in srgb, var(--muted) 32%, transparent);
  font-size: 0.82rem;
}

.placeholder-bubble {
  height: 3.25rem;
  border-radius: 1rem;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--muted) 56%, transparent),
    color-mix(in srgb, var(--background) 90%, transparent),
    color-mix(in srgb, var(--muted) 56%, transparent)
  );
  background-size: 220% 100%;
  animation: placeholder-shimmer 1.2s linear infinite;
}

.placeholder-bubble-short {
  width: 48%;
}

.placeholder-bubble-mid {
  width: 56%;
}

.placeholder-bubble-long {
  width: 76%;
}

.placeholder-bubble-right {
  margin-left: auto;
}

.chat-window-placeholder-composer {
  padding: 0 0.875rem 0.875rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
}

.placeholder-composer {
  height: 5.75rem;
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--muted) 48%, transparent),
    color-mix(in srgb, var(--background) 90%, transparent),
    color-mix(in srgb, var(--muted) 48%, transparent)
  );
  background-size: 220% 100%;
  animation: placeholder-shimmer 1.2s linear infinite;
}

.desktop-empty-stage {
  display: grid;
  height: 100%;
  place-items: center;
}

.desktop-empty-card {
  display: grid;
  gap: 0.55rem;
  place-items: center;
  padding: 2rem;
  border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
  border-radius: 1.5rem;
  background: color-mix(in srgb, var(--card) 94%, transparent);
  color: var(--muted-foreground);
  text-align: center;
}

.desktop-empty-card strong {
  color: var(--foreground);
}

.desktop-empty-card p {
  margin: 0;
  max-width: 24rem;
  line-height: 1.6;
}

@keyframes placeholder-shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -20% 0;
  }
}

@media (max-width: 1100px) {
  .desktop-note {
    display: inline-flex;
  }
}
</style>
