<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FolderOpenDot, GitBranchPlus, LoaderCircle, MessageCirclePlus, Settings } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import WorktreeCreateDialog from '@/components/chat/WorktreeCreateDialog.vue'
import { PROJECT_SESSION_PAGE_SIZE } from '@/composables/useOpencodeApp/constants'
import { getProjectIdentityKey, normalizeDirectory } from '@/composables/useOpencodeApp/helpers'
import { getSessionWorkingInfo } from '@/composables/useOpencodeApp/messages'
import { formatRelativeTime } from '@/lib/format'
import { useOpencodeStore } from '@/stores/opencode'
import type { ProjectRecord, SessionRecord } from '@/types/opencode'

const props = withDefaults(
  defineProps<{
    openSessionIds?: string[]
  }>(),
  {
    openSessionIds: () => []
  }
)

const emit = defineEmits<{
  (event: 'open-session', sessionId: string): void
  (event: 'open-new-session', directory: string): void
}>()

interface ProjectSessionGroup {
  key: string
  name: string
  directory: string
  icon?: ProjectRecord['icon']
  lastUpdated: number
  sessionCount: number
  sessions: SessionRecord[]
  manual?: boolean
  unbound?: boolean
}

const ICON_COLOR_VALUES: Record<string, string> = {
  pink: '#e85d75',
  mint: '#24b48a',
  orange: '#e98a1d',
  purple: '#7c62f2',
  cyan: '#1597b8',
  lime: '#7aac20'
}

const router = useRouter()
const app = useOpencodeStore()
const expandedProjectKeys = ref<string[]>([])
const projectLoadState = ref<Record<string, boolean>>({})
const projectLoadError = ref<Record<string, string>>({})
const projectLoadExhausted = ref<Record<string, boolean>>({})
const worktreeDialogOpen = ref(false)
const worktreeDialogDirectory = ref('')
const worktreeDialogProjectName = ref('')
const worktreeDialogError = ref('')
const isCreatingWorktree = ref(false)

const activeSessionIds = computed(() => new Set(props.openSessionIds))

const projectGroups = computed<ProjectSessionGroup[]>(() => {
  const groups = new Map<string, ProjectSessionGroup>()
  const unboundSessions: SessionRecord[] = []

  for (const project of app.projects) {
    const key = getProjectIdentityKey(project.projectId, project.directory)
    groups.set(key, {
      key,
      name: project.name,
      directory: normalizeDirectory(project.directory),
      icon: project.icon,
      lastUpdated: project.lastUpdated,
      sessionCount: project.sessionCount,
      sessions: [],
      manual: project.manual
    })
  }

  for (const session of app.sessions) {
    const grouping = app.getSessionProjectGrouping(session)
    if (!grouping?.directory) {
      unboundSessions.push(session)
      continue
    }

    const existing = groups.get(grouping.key)
    const updatedAt = session.time.updated || session.time.created || 0

    if (existing) {
      existing.sessions.push(session)
      existing.lastUpdated = Math.max(existing.lastUpdated, updatedAt)
      existing.sessionCount = Math.max(existing.sessionCount, existing.sessions.length)
      existing.icon = existing.icon || grouping.icon
    } else {
      groups.set(grouping.key, {
        key: grouping.key,
        name: grouping.name,
        directory: grouping.directory,
        icon: grouping.icon,
        lastUpdated: updatedAt,
        sessionCount: 1,
        sessions: [session]
      })
    }
  }

  const orderedGroups = Array.from(groups.values()).sort((left, right) => right.lastUpdated - left.lastUpdated)

  if (unboundSessions.length) {
    orderedGroups.push({
      key: '__unbound__',
      name: '未绑定项目',
      directory: '',
      lastUpdated: unboundSessions[0]?.time.updated ?? unboundSessions[0]?.time.created ?? Date.now(),
      sessionCount: unboundSessions.length,
      sessions: unboundSessions,
      unbound: true
    })
  }

  return orderedGroups
})

function syncExpandedProjects() {
  const validKeys = new Set(projectGroups.value.map((group) => group.key))
  const nextKeys = expandedProjectKeys.value.filter((key) => validKeys.has(key))

  projectLoadState.value = Object.fromEntries(Object.entries(projectLoadState.value).filter(([key]) => validKeys.has(key)))
  projectLoadError.value = Object.fromEntries(Object.entries(projectLoadError.value).filter(([key]) => validKeys.has(key)))
  projectLoadExhausted.value = Object.fromEntries(Object.entries(projectLoadExhausted.value).filter(([key]) => validKeys.has(key)))

  for (const group of projectGroups.value) {
    if (group.sessions.some((session) => activeSessionIds.value.has(session.id)) && !nextKeys.includes(group.key)) {
      nextKeys.push(group.key)
    }
  }

  if (!nextKeys.length && projectGroups.value.length) {
    const activeGroup = projectGroups.value.find((group) => {
      return group.sessions.some((session) => activeSessionIds.value.has(session.id))
    })

    nextKeys.push(activeGroup?.key || projectGroups.value[0].key)
  }

  expandedProjectKeys.value = nextKeys
}

watch(projectGroups, syncExpandedProjects, { immediate: true })
watch(() => props.openSessionIds.join(','), syncExpandedProjects)

function formatProjectDirectory(directory: string) {
  if (!directory) {
    return '未绑定项目目录'
  }

  const segments = directory.split('/').filter(Boolean)
  if (segments.length <= 2) {
    return directory
  }

  return `.../${segments.slice(-2).join('/')}`
}

function getProjectInitial(name: string) {
  return name.slice(0, 1).toUpperCase()
}

function getProjectCode(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '')
  return cleaned.slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase()
}

function getProjectIconSrc(group: ProjectSessionGroup) {
  return group.icon?.override || group.icon?.url || ''
}

function getProjectIconStyle(group: ProjectSessionGroup) {
  const accent = group.icon?.color ? ICON_COLOR_VALUES[group.icon.color] : ''
  return accent ? { '--project-icon-accent': accent } : undefined
}

function isExpanded(key: string) {
  return expandedProjectKeys.value.includes(key)
}

function toggleProject(group: ProjectSessionGroup) {
  if (group.directory) {
    app.draftDirectory = group.directory
  }

  expandedProjectKeys.value = isExpanded(group.key)
    ? expandedProjectKeys.value.filter((key) => key !== group.key)
    : [...expandedProjectKeys.value, group.key]
}

function openSession(sessionId: string) {
  emit('open-session', sessionId)
}

async function createSessionForProject(group: ProjectSessionGroup) {
  if (!group.directory) {
    return
  }

  app.draftDirectory = group.directory
  emit('open-new-session', group.directory)
}

function openWorktreeDialog(group: ProjectSessionGroup) {
  if (!group.directory) {
    return
  }

  worktreeDialogDirectory.value = group.directory
  worktreeDialogProjectName.value = group.name
  worktreeDialogError.value = ''
  worktreeDialogOpen.value = true
}

async function createWorktreeSessionForProject(worktreeName: string) {
  const directory = worktreeDialogDirectory.value.trim()
  if (!directory) {
    return
  }

  isCreatingWorktree.value = true
  worktreeDialogError.value = ''
  app.draftDirectory = directory
  const sessionId = await app.createDesktopWorktreeSession(directory, worktreeName)
  isCreatingWorktree.value = false
  if (!sessionId) {
    worktreeDialogError.value = app.lastError || '创建 Worktree 对话失败。'
    return
  }

  worktreeDialogOpen.value = false
  emit('open-session', sessionId)
}

async function createWorktreeSessionForGroup(group: ProjectSessionGroup) {
  if (!group.directory) {
    return
  }

  app.draftDirectory = group.directory
  openWorktreeDialog(group)
}

async function loadMoreForProject(group: ProjectSessionGroup) {
  if (!group.directory || projectLoadState.value[group.key]) {
    return
  }

  projectLoadState.value = {
    ...projectLoadState.value,
    [group.key]: true
  }
  projectLoadError.value = {
    ...projectLoadError.value,
    [group.key]: ''
  }

  try {
    const nextSessions = await app.loadMoreProjectSessions(group.directory)
    if (nextSessions.length < PROJECT_SESSION_PAGE_SIZE) {
      projectLoadExhausted.value = {
        ...projectLoadExhausted.value,
        [group.key]: true
      }
    }
  } catch (error) {
    projectLoadError.value = {
      ...projectLoadError.value,
      [group.key]: error instanceof Error ? error.message : '获取更多对话失败。'
    }
  } finally {
    projectLoadState.value = {
      ...projectLoadState.value,
      [group.key]: false
    }
  }
}

function getSessionWorkingState(sessionId: string) {
  const desktopState = app.desktopSessions[sessionId]
  const messages = desktopState?.messages || app.sessionPreviewMessages[sessionId] || []
  const status = desktopState?.sessionStatus || (app.selectedSessionId === sessionId ? app.sessionStatus : 'idle')
  return getSessionWorkingInfo(messages, status)
}

function getSessionPreviewState(session: SessionRecord) {
  const workingState = getSessionWorkingState(session.id)
  if (workingState.isWorking) {
    return workingState
  }

  return {
    isWorking: false,
    summaryText: '历史对话',
    detailText: ''
  }
}

const sessionRowState = computed(() => {
  return Object.fromEntries(app.sessions.map((session) => {
    const previewState = getSessionPreviewState(session)

    return [session.id, {
      badges: app.getSessionListBadges(session.id),
      isWorktree: app.isWorktreeSession(session),
      previewState
    }] as const
  }))
})
</script>

<template>
  <div class="desktop-project-sidebar">
    <header class="sidebar-header">
      <div class="sidebar-title-row">
        <span class="sidebar-label">Projects</span>
        <span v-if="projectGroups.length" class="sidebar-count">{{ projectGroups.length }}</span>
      </div>
    </header>

    <div v-if="projectGroups.length" class="sidebar-content">
      <section
        v-for="group in projectGroups"
        :key="group.key"
        class="project-group"
        :class="{ 'project-group-expanded': isExpanded(group.key) }"
      >
        <div class="project-row">
          <button type="button" class="project-toggle" @click="toggleProject(group)">
            <div class="project-icon-box" :style="getProjectIconStyle(group)">
              <img v-if="getProjectIconSrc(group)" :src="getProjectIconSrc(group)" alt="" class="project-icon-image" />
              <span v-else>{{ getProjectInitial(group.name) }}</span>
            </div>

            <div class="project-copy">
              <div class="project-heading-row">
                <strong>{{ group.name }}</strong>
              </div>
              <div class="project-meta-row">
                <span class="project-directory">{{ formatProjectDirectory(group.directory) }}</span>
                <span class="project-meta-dot">·</span>
                <span class="project-time">{{ formatRelativeTime(group.lastUpdated) }}</span>
              </div>
            </div>

          </button>

          <svg class="project-chevron" :class="{ 'project-chevron-expanded': isExpanded(group.key) }" width="12" height="12" viewBox="0 0 12 12" fill="none" @click="toggleProject(group)"><path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>

          <div v-if="!group.unbound" class="project-create-actions">
            <Button
              variant="ghost"
              size="sm"
              class="project-create-btn"
              :disabled="!app.streamReady"
              title="新建普通对话"
              @click.stop="createSessionForProject(group)"
            >
              <MessageCirclePlus class="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="project-create-btn project-create-btn-worktree"
              :disabled="!app.streamReady"
              title="新建 Worktree 对话"
              @click.stop="createWorktreeSessionForGroup(group)"
            >
              <GitBranchPlus class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div v-if="isExpanded(group.key)" class="session-list">
          <button
            v-for="session in group.sessions"
            :key="session.id"
            type="button"
            class="session-row"
            :class="{ 'session-row-active': activeSessionIds.has(session.id), 'session-row-worktree': sessionRowState[session.id]?.isWorktree }"
            @click="openSession(session.id)"
          >
            <div class="session-row-top">
              <div class="session-title-row">
                <span class="session-title">{{ session.title || '未命名对话' }}</span>
                <span v-if="sessionRowState[session.id]?.isWorktree" class="worktree-badge">wt</span>
              </div>
            </div>

            <div class="session-row-bottom">
              <div
                class="session-preview"
                :class="{ 'session-preview-working': sessionRowState[session.id]?.previewState.isWorking }"
              >
                <LoaderCircle
                  v-if="sessionRowState[session.id]?.previewState.isWorking"
                  class="session-preview-spinner animate-spin"
                />
                <span class="session-preview-text">{{ sessionRowState[session.id]?.previewState.summaryText }}</span>
                <span
                  v-if="sessionRowState[session.id]?.previewState.isWorking && sessionRowState[session.id]?.previewState.detailText"
                  class="session-preview-detail"
                >
                  {{ sessionRowState[session.id]?.previewState.detailText }}
                </span>
                <span class="session-meta-dot">·</span>
                <span class="session-time">{{ formatRelativeTime(session.time.updated || session.time.created) }}</span>
              </div>

              <div v-if="sessionRowState[session.id]?.badges.length" class="session-badges">
                <span
                  v-for="badge in sessionRowState[session.id]?.badges"
                  :key="badge.key"
                  class="session-badge"
                  :data-tone="badge.tone"
                >
                  {{ badge.label }}
                </span>
              </div>
            </div>
          </button>

          <div v-if="!group.sessions.length" class="empty-project-state">
            <span>还没有历史对话</span>
            <div class="empty-project-actions">
              <Button variant="outline" size="sm" :disabled="!app.streamReady || group.unbound" @click="createSessionForProject(group)">
                <MessageCirclePlus class="h-4 w-4" />
                新建对话
              </Button>
              <Button variant="outline" size="sm" :disabled="!app.streamReady || group.unbound" @click="createWorktreeSessionForGroup(group)">
                <GitBranchPlus class="h-4 w-4" />
                Worktree 对话
              </Button>
            </div>
          </div>

          <div v-if="!group.unbound" class="project-session-actions">
            <Button
              variant="outline"
              size="sm"
              class="project-more-btn"
              :disabled="projectLoadState[group.key]"
              @click="loadMoreForProject(group)"
            >
              <LoaderCircle v-if="projectLoadState[group.key]" class="h-3.5 w-3.5 animate-spin" />
              <template v-else>获取更多</template>
            </Button>
            <span v-if="projectLoadError[group.key]" class="project-session-feedback project-session-feedback-error">
              {{ projectLoadError[group.key] }}
            </span>
            <span v-else-if="projectLoadExhausted[group.key]" class="project-session-feedback">
              这个项目已经没有更多对话了
            </span>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="sidebar-empty">
      <div class="sidebar-empty-icon">
        <FolderOpenDot class="h-5 w-5" />
      </div>
      <strong>还没有项目</strong>
      <p>先在手机端项目页选择目录，或等已有会话同步后，这里会按项目归档显示。</p>
    </div>

    <footer class="sidebar-footer">
      <button type="button" class="sidebar-footer-btn" @click="router.push('/settings')">
        <Settings class="h-4 w-4" />
        <span>Settings</span>
      </button>
    </footer>

    <WorktreeCreateDialog
      v-model:open="worktreeDialogOpen"
      :busy="isCreatingWorktree"
      :project-name="worktreeDialogProjectName"
      :directory="worktreeDialogDirectory"
      :error="worktreeDialogError"
      @confirm="createWorktreeSessionForProject"
    />
  </div>
</template>

<style scoped>
/* ── Sidebar container ── */
.desktop-project-sidebar {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  background: var(--card);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
}

/* ── Header ── */
.sidebar-header {
  height: 3rem;
  padding: 0 1rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.sidebar-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.sidebar-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted-foreground);
  letter-spacing: 0.01em;
}

.sidebar-count {
  font-size: 0.72rem;
  color: var(--muted-foreground);
  background: var(--secondary);
  padding: 0.1rem 0.4rem;
  border-radius: 9999px;
  border: 1px solid var(--border);
}

/* ── Scrollable content ── */
.sidebar-content {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
}

.sidebar-content::-webkit-scrollbar { width: 2px; }
.sidebar-content::-webkit-scrollbar-track { background: transparent; }
.sidebar-content::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 9999px;
}

/* ── Project group ── */
.project-group {
  border-bottom: 1px solid var(--border);
}

.project-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.75rem;
  min-height: 2.75rem;
}

.project-toggle {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: opacity 0.1s;
  overflow: hidden;
}

.project-toggle:hover { opacity: 0.8; }

.project-icon-box {
  --project-icon-accent: var(--muted-foreground);
  display: flex;
  width: 1.625rem;
  height: 1.625rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--secondary);
  color: var(--project-icon-accent);
  font-size: 0.7rem;
  font-weight: 600;
  border: 1px solid var(--border);
}

.project-icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.project-copy {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 0.08rem;
}

.project-heading-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.project-heading-row strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--foreground);
}

.project-meta-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  color: var(--muted-foreground);
}

.project-directory,
.session-preview-text,
.session-preview-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.project-meta-dot,
.project-time,
.session-meta-dot,
.session-time {
  flex-shrink: 0;
  white-space: nowrap;
}

.project-time,
.session-time { color: var(--muted-foreground); }

.project-chevron {
  flex-shrink: 0;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.project-chevron:hover { color: var(--foreground); }

.project-chevron-expanded { transform: rotate(90deg); }

/* Action buttons */
.project-create-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
  margin-left: auto;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s;
}

.project-row:hover .project-create-actions {
  opacity: 1;
  pointer-events: auto;
}

.project-create-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 1.625rem;
  width: 1.625rem;
  min-width: 1.625rem;
  padding: 0;
  border-radius: var(--radius);
  color: var(--muted-foreground);
}

.project-create-btn:hover { color: var(--foreground); }

.project-create-btn-worktree { color: var(--muted-foreground); }

/* ── Session list ── */
.session-list {
  display: grid;
  padding: 0.25rem 0;
}

.session-row {
  display: grid;
  gap: 0.1rem;
  padding: 0.45rem 0.75rem 0.45rem 2.6rem;
  border: none;
  border-left: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.session-row:hover { background: var(--secondary); }

.session-row-worktree {
  position: relative;
  background: color-mix(in srgb, var(--primary) 5%, transparent);
  border-left: 2px solid color-mix(in srgb, var(--primary) 40%, transparent);
}

.session-row-worktree:hover {
  background: color-mix(in srgb, var(--primary) 9%, var(--secondary));
  border-left-color: color-mix(in srgb, var(--primary) 65%, transparent);
}

.session-row-active {
  background: var(--accent);
}

.session-row-active:hover { background: var(--accent); }

.session-row-worktree.session-row-active {
  background: color-mix(in srgb, var(--primary) 12%, var(--accent));
  border-left-color: var(--primary);
}

.session-row-top {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
}

.session-title {
  min-width: 0;
  flex: 1;
  font-size: 0.8rem;
  font-weight: 400;
  line-height: 1.3;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-row-active .session-title { font-weight: 500; }

.worktree-badge {
  flex-shrink: 0;
  font-size: 0.6rem;
  font-family: var(--font-mono);
  font-weight: 500;
  padding: 0.05rem 0.28rem;
  border-radius: 3px;
  color: var(--muted-foreground);
  border: 1px solid var(--border);
  background: var(--secondary);
  letter-spacing: 0.02em;
}

.session-row-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.session-preview {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.7rem;
  color: var(--muted-foreground);
}

.session-preview-working { color: var(--foreground); }

.session-preview-spinner {
  width: 0.65rem;
  height: 0.65rem;
  flex-shrink: 0;
  color: var(--foreground);
}

.session-time { font-size: 0.68rem; }

.session-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.15rem;
}

.session-badge {
  padding: 0.05rem 0.3rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  color: var(--muted-foreground);
  background: var(--secondary);
}

.session-badge[data-tone="success"] { color: #50e3c2; border-color: rgba(80, 227, 194, 0.2); }
.session-badge[data-tone="warning"] { color: #f5a623; border-color: rgba(245, 166, 35, 0.2); }
.session-badge[data-tone="error"]   { color: #e5484d; border-color: rgba(229, 72, 77, 0.2); }

/* ── Empty states ── */
.empty-project-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0.25rem 0.75rem;
  padding: 0.6rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.empty-project-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
}

.project-session-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.75rem;
}

.project-more-btn {
  border-radius: var(--radius);
  font-size: 0.72rem;
  height: 1.5rem;
}

.project-session-feedback {
  font-size: 0.7rem;
  color: var(--muted-foreground);
}

.project-session-feedback-error { color: var(--destructive); }

/* ── Footer ── */
.sidebar-footer {
  flex-shrink: 0;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border);
}

.sidebar-footer-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.5rem;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--muted-foreground);
  font-size: 0.8rem;
  font-weight: 400;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.sidebar-footer-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}

.sidebar-empty {
  display: grid;
  flex: 1;
  place-items: center;
  gap: 0.75rem;
  padding: 2rem 1.5rem;
  color: var(--muted-foreground);
  text-align: center;
}

.sidebar-empty-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--secondary);
  color: var(--muted-foreground);
}

.sidebar-empty strong {
  color: var(--foreground);
  font-size: 0.8125rem;
  font-weight: 500;
}

.sidebar-empty p {
  margin: 0;
  max-width: 16rem;
  line-height: 1.6;
  font-size: 0.75rem;
}
</style>
