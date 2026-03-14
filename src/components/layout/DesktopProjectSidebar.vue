<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, FolderOpenDot, GitBranchPlus, LoaderCircle, MessageCirclePlus } from 'lucide-vue-next'

import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import WorktreeCreateDialog from '@/components/chat/WorktreeCreateDialog.vue'
import { PROJECT_SESSION_PAGE_SIZE } from '@/composables/useOpencodeApp/constants'
import { getDirectoryName, getProjectIdentityKey, normalizeDirectory } from '@/composables/useOpencodeApp/helpers'
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
  const projectById = new Map(app.projects.map((project) => [project.projectId || '', project] as const))

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
    const sessionDirectory = normalizeDirectory(session.directory)
    if (!sessionDirectory) {
      unboundSessions.push(session)
      continue
    }

    const rootDirectory = normalizeDirectory(
      session.project?.worktree ||
        projectById.get(session.projectId || session.project?.id || '')?.directory ||
        sessionDirectory
    )
    const key = getProjectIdentityKey(session.projectId || session.project?.id || '', rootDirectory || sessionDirectory)
    const existing = groups.get(key)
    const updatedAt = session.time.updated || session.time.created || 0

    if (existing) {
      existing.sessions.push(session)
      existing.lastUpdated = Math.max(existing.lastUpdated, updatedAt)
      existing.sessionCount = Math.max(existing.sessionCount, existing.sessions.length)
      existing.icon = existing.icon || session.project?.icon
    } else {
      groups.set(key, {
        key,
        name: session.project?.name || getDirectoryName(rootDirectory || sessionDirectory),
        directory: rootDirectory || sessionDirectory,
        icon: session.project?.icon,
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
    nextKeys.push(projectGroups.value[0].key)
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
  app.clearSessionListBadges(sessionId)
  emit('open-session', sessionId)
}

async function createSessionForProject(group: ProjectSessionGroup) {
  if (!group.directory) {
    return
  }

  app.draftDirectory = group.directory
  const sessionId = await app.createDesktopSession(group.directory)
  if (!sessionId) {
    return
  }

  emit('open-session', sessionId)
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
        <div class="sidebar-title-block">
          <h1>项目</h1>
          <p>点击项目名展开历史对话</p>
        </div>
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

            <ChevronRight class="project-chevron" :class="{ 'project-chevron-expanded': isExpanded(group.key) }" />
          </button>

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
                <Badge v-if="sessionRowState[session.id]?.isWorktree" tone="accent" class="worktree-badge">Worktree</Badge>
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
                <Badge
                  v-for="badge in sessionRowState[session.id]?.badges"
                  :key="badge.key"
                  :tone="badge.tone"
                  class="session-badge"
                >
                  {{ badge.label }}
                </Badge>
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
.desktop-project-sidebar {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  background: transparent;
}

.sidebar-header {
  padding: 0 0 0.65rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
}

.sidebar-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.sidebar-title-block {
  display: grid;
  gap: 0.3rem;
}

.sidebar-title-block h1 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.sidebar-title-block p {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted-foreground);
}

.sidebar-count {
  display: inline-flex;
  min-width: 1.85rem;
  align-items: center;
  justify-content: center;
  padding: 0.2rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
  font-size: 0.7rem;
  font-weight: 700;
}

.sidebar-content {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.1rem;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--primary) 18%, transparent) transparent;
}

.sidebar-content::-webkit-scrollbar {
  -webkit-appearance: none;
  width: 2px;
}

.sidebar-content::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-content::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 18%, transparent);
}

.project-group {
  border-bottom: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
}

.project-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0;
}

.project-toggle {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.65rem;
  flex: 0 1 auto;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
}

.project-icon-box {
  --project-icon-accent: var(--primary);
  display: flex;
  width: 2.35rem;
  height: 2.35rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0.8rem;
  background: var(--project-icon-accent);
  color: var(--primary-foreground);
  font-size: 1rem;
  font-weight: 800;
  box-shadow: 0 8px 18px -12px color-mix(in srgb, var(--project-icon-accent) 55%, transparent);
}

.project-icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.project-copy {
  display: grid;
  min-width: 0;
  gap: 0.12rem;
}

.project-heading-row,
.session-row-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.session-row-top {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.project-heading-row strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-heading-row strong {
  font-size: 0.94rem;
  font-weight: 700;
}

.project-meta-row,
.project-time,
.session-time,
.session-preview,
.session-preview-detail {
  color: var(--muted-foreground);
}

.project-meta-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.76rem;
}

.project-directory,
.session-preview-text,
.session-preview-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-meta-dot,
.project-time {
  flex-shrink: 0;
  white-space: nowrap;
}

.project-chevron {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  color: var(--muted-foreground);
  transition: transform 0.18s ease;
}

.project-chevron-expanded {
  transform: rotate(90deg);
}

.project-create-btn {
  height: 2rem;
  min-width: 2rem;
  padding: 0;
  border-radius: 0.8rem;
  color: var(--muted-foreground);
}

.project-create-actions {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.project-row:hover .project-create-actions {
  opacity: 1;
  pointer-events: auto;
}

.project-create-btn-worktree {
  color: color-mix(in srgb, var(--primary) 72%, var(--foreground));
}

.session-list {
  display: grid;
  gap: 0.25rem;
  padding: 0 0 0.45rem 0.28rem;
}

.session-row {
  display: grid;
  gap: 0.18rem;
  padding: 0.58rem 0.58rem;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 0.82rem;
  background: color-mix(in srgb, var(--card) 84%, transparent);
  text-align: left;
  transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease;
}

.session-row-worktree {
  position: relative;
  border-color: color-mix(in srgb, var(--primary) 28%, var(--border));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--primary) 10%, transparent), transparent 32%),
    color-mix(in srgb, var(--card) 92%, transparent);
}

.session-row-worktree::before {
  content: '';
  position: absolute;
  left: 0.22rem;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 0.2rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 78%, var(--foreground));
}

.session-row:hover {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--border));
  background: color-mix(in srgb, var(--accent) 45%, transparent);
  transform: translateX(2px);
}

.session-row-worktree:hover {
  border-color: color-mix(in srgb, var(--primary) 46%, var(--border));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--primary) 16%, transparent), transparent 36%),
    color-mix(in srgb, var(--accent) 50%, transparent);
}

.session-row-active {
  border-color: color-mix(in srgb, var(--primary) 50%, var(--border));
  background: color-mix(in srgb, var(--primary) 10%, var(--card));
}

.session-row-worktree.session-row-active {
  border-color: color-mix(in srgb, var(--primary) 56%, var(--border));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--primary) 18%, transparent), transparent 40%),
    color-mix(in srgb, var(--primary) 10%, var(--card));
}

.session-title {
  min-width: 0;
  flex: 1;
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--foreground);
  white-space: normal;
  word-break: break-word;
}

.worktree-badge {
  flex-shrink: 0;
  font-size: 0.62rem;
  padding: 0.08rem 0.34rem;
  background: color-mix(in srgb, var(--primary) 16%, transparent);
  color: color-mix(in srgb, var(--primary) 78%, var(--foreground));
  border: 1px solid color-mix(in srgb, var(--primary) 24%, transparent);
}

.session-time,
.project-time {
  flex-shrink: 0;
  font-size: 0.7rem;
}

.session-row-bottom {
  align-items: flex-start;
}

.session-preview {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 0.28rem;
  font-size: 0.72rem;
}

.session-meta-dot {
  flex-shrink: 0;
}

.session-preview-working {
  color: var(--foreground);
}

.session-preview-spinner {
  width: 0.8rem;
  height: 0.8rem;
  flex-shrink: 0;
  color: var(--primary);
}

.session-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.2rem;
}

.session-badge {
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  font-size: 0.58rem;
  letter-spacing: 0.08em;
}

.empty-project-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 0.9rem;
  border: 1px dashed color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 1rem;
  color: var(--muted-foreground);
  font-size: 0.8rem;
}

.empty-project-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.project-session-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 0.15rem;
}

.project-more-btn {
  border-radius: 0.9rem;
}

.project-session-feedback {
  font-size: 0.72rem;
  color: var(--muted-foreground);
}

.project-session-feedback-error {
  color: var(--destructive);
}

.sidebar-empty {
  display: grid;
  flex: 1;
  place-items: center;
  gap: 0.6rem;
  padding: 2rem 1rem;
  color: var(--muted-foreground);
  text-align: center;
}

.sidebar-empty-icon {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--foreground);
}

.sidebar-empty strong {
  color: var(--foreground);
}

.sidebar-empty p {
  margin: 0;
  max-width: 18rem;
  line-height: 1.6;
}
</style>
