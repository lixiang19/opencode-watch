<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { FolderSync, LoaderCircle, Sparkles, X } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatPane from '@/components/chat/ChatPane.vue'
import { hasActiveToolCall } from '@/composables/useOpencodeApp/messages'
import ConversationListView from '@/pages/ConversationListView.vue'
import ProjectsView from '@/pages/ProjectsView.vue'
import { useOpencodeStore } from '@/stores/opencode'

const app = useOpencodeStore()

const orderedSessions = computed(() => app.sessions)
const openPanelIds = ref<string[]>([])
const panelLoadingState = ref<Record<string, boolean>>({})
const MIN_PANEL_PLACEHOLDER_MS = 220

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

function getDesktopSessionState(sessionId: string) {
  return app.desktopSessions[sessionId] ?? null
}

function getWindowMessages(sessionId: string) {
  return getDesktopSessionState(sessionId)?.messages || app.sessionPreviewMessages[sessionId] || []
}

function showPanelWorkingIndicator(sessionId: string) {
  const sessionState = getDesktopSessionState(sessionId)
  if (!sessionState || sessionState.isLoadingSession || sessionState.sessionStatus !== 'busy') {
    return false
  }

  return hasActiveToolCall(sessionState.messages)
}

async function openPanel(sessionId: string) {
  if (!sessionId) {
    return
  }

  app.clearSessionListBadges(sessionId)
  const isNewPanel = !openPanelIds.value.includes(sessionId)
  const hasUsableState = Boolean(getDesktopSessionState(sessionId) && !getDesktopSessionState(sessionId)?.lastError)

  if (isNewPanel) {
    openPanelIds.value = [...openPanelIds.value, sessionId]
  }

  if (!isNewPanel && hasUsableState) {
    return
  }

  const startedAt = Date.now()
  panelLoadingState.value = {
    ...panelLoadingState.value,
    [sessionId]: true
  }

  await nextTick()

  const loadSession = app.openDesktopSession(sessionId)

  void loadSession.finally(async () => {
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_PANEL_PLACEHOLDER_MS) {
      await new Promise((resolve) => window.setTimeout(resolve, MIN_PANEL_PLACEHOLDER_MS - elapsed))
    }

    panelLoadingState.value = {
      ...panelLoadingState.value,
      [sessionId]: false
    }
  })
}

function closePanel(sessionId: string) {
  openPanelIds.value = openPanelIds.value.filter((id) => id !== sessionId)
  app.closeDesktopSession(sessionId)
  const nextState = { ...panelLoadingState.value }
  delete nextState[sessionId]
  panelLoadingState.value = nextState
}

async function loadOlderForPanel(sessionId: string) {
  if (!sessionId) {
    return
  }

  await app.loadOlderDesktopMessages(sessionId)
}

onMounted(() => {
  void app.preloadHomeData()
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
    const removedIds = openPanelIds.value.filter((sessionId) => !validIds.has(sessionId))
    openPanelIds.value = openPanelIds.value.filter((sessionId) => validIds.has(sessionId))
    for (const sessionId of removedIds) {
      app.closeDesktopSession(sessionId)
    }
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
      <span>左侧把项目和会话收进同一个边栏，并改成更轻的分割线列表。</span>
    </div>

    <div class="desktop-shell">
      <aside class="desktop-sidebar">
        <section class="desktop-sidebar-section sidebar-projects">
          <ProjectsView desktop-mode @open-session="openPanel" />
        </section>

        <section class="desktop-sidebar-section sidebar-conversations">
          <ConversationListView desktop-mode @open-session="openPanel" />
        </section>
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
              :busy="getDesktopSessionState(session.id)?.sessionStatus === 'busy' || getDesktopSessionState(session.id)?.isSending"
              :is-loading="getDesktopSessionState(session.id)?.isLoadingSession"
              :last-error="getDesktopSessionState(session.id)?.lastError || ''"
              :has-truncated-messages="getDesktopSessionState(session.id)?.hasMoreHistory"
              :history-limit="getDesktopSessionState(session.id)?.historyMessageLimit || 0"
              :show-working-indicator="showPanelWorkingIndicator(session.id)"
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
                  :disabled="getDesktopSessionState(session.id)?.isLoadingOlderMessages || !getDesktopSessionState(session.id)?.hasMoreHistory"
                  @click="loadOlderForPanel(session.id)"
                >
                  <LoaderCircle v-if="getDesktopSessionState(session.id)?.isLoadingOlderMessages" class="h-3.5 w-3.5 animate-spin" />
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
            <p>从左侧合并列表点开，或在项目里新建对话后，它才会出现在这里。</p>
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
  grid-template-columns: 25rem minmax(0, 1fr);
  gap: 1.25rem;
  min-width: 1360px;
  height: calc(100vh - 2rem);
}

.desktop-sidebar {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1.1fr);
  min-height: 0;
  overflow: hidden;
  padding-right: 1rem;
  border-right: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
}

.desktop-sidebar-section {
  min-height: 0;
  overflow: hidden;
}

.desktop-sidebar-section + .desktop-sidebar-section {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
}

.desktop-sidebar-section :deep(.projects-container),
.desktop-sidebar-section :deep(.conversations-container) {
  min-height: 100%;
  height: 100%;
  background: transparent;
}

.desktop-sidebar-section :deep(.projects-header),
.desktop-sidebar-section :deep(.conversations-header) {
  padding: 0 0 0.85rem;
  position: static;
  background: transparent;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

.desktop-sidebar-section :deep(.projects-content),
.desktop-sidebar-section :deep(.conversations-content) {
  min-height: 0;
  overflow-y: auto;
  padding: 0;
}

.desktop-sidebar-section :deep(.project-grid) {
  max-width: none;
  gap: 0;
}

.desktop-sidebar-section :deep(.empty-hero) {
  min-height: calc(100% - 4.5rem);
}

.desktop-sidebar-section :deep(.project-card) {
  border: none !important;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 58%, transparent) !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.desktop-sidebar-section :deep(.project-card::before) {
  content: none !important;
}

.desktop-sidebar-section :deep(.project-card:last-child) {
  border-bottom: none !important;
}

.desktop-sidebar-section :deep(.project-card:hover) {
  transform: none;
  box-shadow: none !important;
  border-color: color-mix(in srgb, var(--border) 58%, transparent) !important;
}

.desktop-sidebar-section :deep(.draft-card) {
  border-style: solid !important;
}

.desktop-sidebar-section :deep(.card-body) {
  padding: 1rem 0;
}

.desktop-sidebar-section :deep(.card-footer) {
  padding: 0 0 1rem;
  border-top: none;
  background: transparent;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.desktop-sidebar-section :deep(.project-edit-trigger) {
  top: 0.9rem;
  right: 0;
}

.desktop-chat-stage {
  height: 100%;
  min-height: 0;
}

.desktop-chat-stage :deep(.chat-layout-embedded) {
  height: 100%;
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
  height: 100%;
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
