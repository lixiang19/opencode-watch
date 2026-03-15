<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { FolderSync, LoaderCircle, X } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatPane from '@/components/chat/ChatPane.vue'
import WorktreeSessionBanner from '@/components/chat/WorktreeSessionBanner.vue'
import { normalizeDirectory } from '@/composables/useOpencodeApp/helpers'
import DesktopProjectSidebar from '@/components/layout/DesktopProjectSidebar.vue'
import { getSessionWorkingInfo } from '@/composables/useOpencodeApp/messages'
import { useOpencodeStore } from '@/stores/opencode'
import type { SessionRecord } from '@/types/opencode'

const app = useOpencodeStore()

const orderedSessions = computed(() => app.sessions)
const openPanelIds = ref<string[]>([])
const panelLoadingState = ref<Record<string, boolean>>({})
const MIN_PANEL_PLACEHOLDER_MS = 220

type SessionPanel = {
  id: string
  session: SessionRecord
}

type OpenPanel = SessionPanel

const openPanels = computed<OpenPanel[]>(() => {
  const sessionMap = new Map(orderedSessions.value.map((session) => [session.id, session] as const))
  return openPanelIds.value
    .map((panelId) => {
      const session = sessionMap.get(panelId)
      if (!session) {
        return null
      }

      return {
        id: panelId,
        session
      } satisfies SessionPanel
    })
    .filter((panel): panel is OpenPanel => Boolean(panel))
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

function getPanelWorkingInfo(sessionId: string) {
  const sessionState = getDesktopSessionState(sessionId)
  if (!sessionState || sessionState.isLoadingSession) {
    return null
  }

  return getSessionWorkingInfo(sessionState.messages, sessionState.sessionStatus)
}

function getPanelWorktreeInfo(sessionId: string) {
  return app.getSessionWorktreeInfo(sessionId)
}

function getPanelHeaderBadges(sessionId: string) {
  return app.getSessionListBadges(sessionId)
}

async function openNewSessionPanel(directory: string) {
  const normalizedDirectory = normalizeDirectory(directory)
  if (!normalizedDirectory) {
    return
  }

  const sessionId = await app.createDesktopSession(normalizedDirectory)
  if (!sessionId) {
    return
  }

  if (!openPanelIds.value.includes(sessionId)) {
    openPanelIds.value = [...openPanelIds.value, sessionId]
  }

  void app.ensureSessionWorktreeInfo(sessionId)
}

async function openPanel(sessionId: string) {
  if (!sessionId) {
    return
  }

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
  void app.ensureSessionWorktreeInfo(sessionId)

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
    panelLoadingState.value = Object.fromEntries(Object.entries(panelLoadingState.value).filter(([sessionId]) => validIds.has(sessionId)))
  },
  { immediate: true }
)
</script>

<template>
  <div class="desktop-page vercel-theme">
    <div class="desktop-shell">
      <aside class="desktop-sidebar">
        <DesktopProjectSidebar :open-session-ids="openPanelIds" @open-session="openPanel" @open-new-session="openNewSessionPanel" />
      </aside>

      <main class="desktop-chat-stage">
        <div v-if="openPanels.length" class="chat-grid soft-scrollbar">
          <template v-for="panel in openPanels" :key="panel.id">
            <div class="chat-grid-item">
              <section v-if="panelLoadingState[panel.id]" class="chat-window-placeholder">
                <header class="chat-window-placeholder-header">
                  <div class="chat-window-copy">
                    <strong>{{ panel.session.title || '未命名对话' }}</strong>
                    <span>{{ formatSessionDirectory(panel.session.directory) }}</span>
                  </div>

                  <button type="button" class="chat-window-close" @click="closePanel(panel.id)">
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
                :title="panel.session.title || '未命名对话'"
                :project-name="formatSessionDirectory(panel.session.directory)"
                :badges="getPanelHeaderBadges(panel.id)"
                :messages="getWindowMessages(panel.id)"
                :connected="app.streamReady"
                :busy="getDesktopSessionState(panel.id)?.sessionStatus === 'busy' || getDesktopSessionState(panel.id)?.isSending"
                :is-loading="getDesktopSessionState(panel.id)?.isLoadingSession"
                :last-error="getDesktopSessionState(panel.id)?.lastError || ''"
                :has-truncated-messages="getDesktopSessionState(panel.id)?.hasMoreHistory"
                :history-limit="getDesktopSessionState(panel.id)?.historyMessageLimit || 0"
                :working-info="getPanelWorkingInfo(panel.id)"
                empty-text="暂无消息"
              >
                <template #trailing>
                  <WorktreeSessionBanner
                    v-if="getPanelWorktreeInfo(panel.id)"
                    :session-id="panel.id"
                    :project-name="getPanelWorktreeInfo(panel.id)?.projectName || ''"
                    :root-directory="getPanelWorktreeInfo(panel.id)?.rootDirectory || ''"
                    :worktree-directory="getPanelWorktreeInfo(panel.id)?.worktreeDirectory || ''"
                    :root-branch="getPanelWorktreeInfo(panel.id)?.rootBranch || ''"
                    :root-branch-loading="getPanelWorktreeInfo(panel.id)?.rootBranchLoading"
                    :root-branch-error="getPanelWorktreeInfo(panel.id)?.rootBranchError || ''"
                    :branch="getPanelWorktreeInfo(panel.id)?.branch || ''"
                    :branch-loading="getPanelWorktreeInfo(panel.id)?.branchLoading"
                    :branch-error="getPanelWorktreeInfo(panel.id)?.branchError || ''"
                    @removed="closePanel(panel.id)"
                  />
                  <button type="button" class="chat-window-close" @click="closePanel(panel.id)">
                    <X class="h-4 w-4" />
                  </button>
                </template>

                <template #history-action>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="getDesktopSessionState(panel.id)?.isLoadingOlderMessages || !getDesktopSessionState(panel.id)?.hasMoreHistory"
                    @click="loadOlderForPanel(panel.id)"
                  >
                    <LoaderCircle v-if="getDesktopSessionState(panel.id)?.isLoadingOlderMessages" class="h-3.5 w-3.5 animate-spin" />
                    <template v-else>加载更早</template>
                  </Button>
                </template>

                <template #composer>
                  <ChatComposer embedded :session-id="panel.id" />
                </template>
              </ChatPane>
            </div>
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
  padding: 0;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 0.875rem;
}

.desktop-note {
  display: none;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.desktop-shell {
  --desktop-panel-height: 100dvh;
  --sidebar-width: clamp(18rem, 20vw, 22rem);
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  gap: 0;
  height: var(--desktop-panel-height);
}

.desktop-sidebar {
  min-height: 0;
  overflow: hidden;
  padding: 0;
  border-right: 1px solid var(--border);
  background: var(--card);
  display: flex;
  flex-direction: column;
}

.desktop-chat-stage {
  height: 100%;
  min-height: 0;
  background: var(--background);
}

.chat-grid-item {
  display: flex;
  min-height: var(--desktop-panel-height);
  height: var(--desktop-panel-height);
  min-width: 0;
  align-self: start;
  border-right: 1px solid var(--border);
}

.chat-grid-item > * {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.chat-grid-item :deep(.chat-layout-embedded) {
  height: 100%;
  width: 100%;
  min-width: 0;
  border-radius: 0 !important;
}

.chat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  align-items: start;
  gap: 0;
  height: 100%;
  overflow-y: auto;
}

.chat-window-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius);
  background: transparent;
  color: var(--muted-foreground);
  border: none;
  transition: color 0.1s ease, background 0.1s ease;
  flex-shrink: 0;
}

.chat-window-close:hover {
  background: var(--secondary);
  color: var(--foreground);
}

/* Loading placeholder */
.chat-window-placeholder {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  border: none;
  border-radius: 0;
  background: var(--background);
  overflow: hidden;
}

.chat-window-placeholder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0 1rem;
  height: 3rem;
  border-bottom: 1px solid var(--border);
}

.chat-window-copy {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
}

.chat-window-copy strong {
  color: var(--foreground);
  font-weight: 500;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-window-copy span {
  color: var(--muted-foreground);
  font-size: 0.72rem;
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-window-copy span::before {
  content: '/ ';
  opacity: 0.4;
}

.chat-window-placeholder-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem 1rem;
}

.placeholder-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  width: fit-content;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--muted-foreground);
  background: transparent;
  font-size: 0.75rem;
}

.placeholder-bubble {
  height: 0.875rem;
  border-radius: 2px;
  background: var(--secondary);
  opacity: 0.6;
}

.placeholder-bubble-short { width: 38%; }
.placeholder-bubble-mid   { width: 54%; }
.placeholder-bubble-long  { width: 72%; }
.placeholder-bubble-right { margin-left: auto; opacity: 0.4; }

.chat-window-placeholder-composer {
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border);
}

.placeholder-composer {
  height: 2.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--secondary);
  opacity: 0.5;
}

/* Empty state */
.desktop-empty-stage {
  display: grid;
  height: 100%;
  place-items: center;
}

.desktop-empty-card {
  display: grid;
  gap: 0.5rem;
  place-items: center;
  padding: 2.5rem 3rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--muted-foreground);
  text-align: center;
}

.desktop-empty-card strong {
  color: var(--foreground);
  font-size: 0.875rem;
  font-weight: 500;
}

.desktop-empty-card p {
  margin: 0;
  max-width: 22rem;
  line-height: 1.6;
  font-size: 0.8rem;
}

@media (max-width: 1100px) {
  .desktop-note {
    display: inline-flex;
  }
}
</style>
