<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Clock, FolderOpenDot, FolderSync, GitBranchPlus, ImagePlus, LoaderCircle, MessageCirclePlus, PencilLine, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import Input from '@/components/ui/input/Input.vue'
import WorktreeCreateDialog from '@/components/chat/WorktreeCreateDialog.vue'
import { formatRelativeTime } from '@/lib/format'
import { useOpencodeStore } from '@/stores/opencode'
import type { ProjectRecord } from '@/types/opencode'

const app = useOpencodeStore()
const router = useRouter()

const ICON_COLOR_OPTIONS = [
  { value: 'pink', label: '粉' },
  { value: 'mint', label: '薄荷' },
  { value: 'orange', label: '橙' },
  { value: 'purple', label: '葡萄' },
  { value: 'cyan', label: '青' },
  { value: 'lime', label: '青柠' }
] as const

const ICON_COLOR_VALUES: Record<string, string> = {
  pink: '#e85d75',
  mint: '#24b48a',
  orange: '#e98a1d',
  purple: '#7c62f2',
  cyan: '#1597b8',
  lime: '#7aac20'
}

const editingProject = ref<ProjectRecord | null>(null)
const iconColorDraft = ref('')
const iconOverrideDraft = ref('')
const iconFileName = ref('')
const editorError = ref('')
const isSavingIcon = ref(false)
const iconFileInput = ref<HTMLInputElement | null>(null)
const worktreeDialogOpen = ref(false)
const worktreeDialogDirectory = ref('')
const worktreeDialogProjectName = ref('')
const worktreeDialogError = ref('')
const isCreatingWorktree = ref(false)

function formatProjectDirectory(directory: string) {
  const normalized = directory.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)

  if (segments.length <= 2) {
    return directory
  }

  return `.../${segments.slice(-2).join('/')}`
}

function getProjectInitial(name: string) {
  return name.slice(0, 1).toUpperCase()
}

function getProjectIconSrc(project?: Pick<ProjectRecord, 'icon'> | null) {
  return project?.icon?.override || project?.icon?.url || ''
}

function getProjectIconStyle(project?: Pick<ProjectRecord, 'icon'> | null) {
  const accent = project?.icon?.color ? ICON_COLOR_VALUES[project.icon.color] : ''
  return accent ? { '--project-icon-accent': accent } : undefined
}

function openProjectIconEditor(project: ProjectRecord) {
  if (!project.projectId) {
    return
  }

  editingProject.value = project
  iconColorDraft.value = project.icon?.color || ''
  iconOverrideDraft.value = project.icon?.override || ''
  iconFileName.value = ''
  editorError.value = ''
}

function closeProjectIconEditor() {
  editingProject.value = null
  iconColorDraft.value = ''
  iconOverrideDraft.value = ''
  iconFileName.value = ''
  editorError.value = ''
  if (iconFileInput.value) {
    iconFileInput.value.value = ''
  }
}

function triggerIconFilePicker() {
  iconFileInput.value?.click()
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('读取图片失败，请重试。'))
    reader.readAsDataURL(file)
  })
}

async function handleIconFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }

  if (!file.type.startsWith('image/')) {
    editorError.value = '只能上传图片文件。'
    input.value = ''
    return
  }

  try {
    editorError.value = ''
    iconOverrideDraft.value = await readFileAsDataUrl(file)
    iconFileName.value = file.name
  } catch (error) {
    editorError.value = error instanceof Error ? error.message : '读取图片失败，请重试。'
  } finally {
    input.value = ''
  }
}

function clearCustomIcon() {
  iconOverrideDraft.value = ''
  iconFileName.value = ''
  editorError.value = ''
  if (iconFileInput.value) {
    iconFileInput.value.value = ''
  }
}

async function saveProjectIcon() {
  if (!editingProject.value?.projectId) {
    return
  }

  isSavingIcon.value = true
  editorError.value = ''

  try {
    await app.updateProject(editingProject.value.projectId, {
      icon: {
        url: editingProject.value.icon?.url,
        override: iconOverrideDraft.value || undefined,
        color: iconColorDraft.value || undefined
      }
    })
    closeProjectIconEditor()
  } catch (error) {
    editorError.value = error instanceof Error ? error.message : '更新项目图标失败。'
  } finally {
    isSavingIcon.value = false
  }
}

const draftProject = computed(() => {
  const directory = app.draftDirectory.trim()
  if (!directory) {
    return null
  }

  const exists = app.projects.some((project) => project.directory === directory)
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
  app.draftDirectory = directory
  const sessionId = await app.createSession(directory)
  if (!sessionId) {
    return
  }

  void router.push({ name: 'session', params: { sessionId } })
}

function openWorktreeDialog(directory: string, projectName: string) {
  worktreeDialogDirectory.value = directory
  worktreeDialogProjectName.value = projectName
  worktreeDialogError.value = ''
  worktreeDialogOpen.value = true
}

async function createWorktreeForProject(worktreeName: string) {
  const directory = worktreeDialogDirectory.value.trim()
  if (!directory) {
    return
  }

  isCreatingWorktree.value = true
  worktreeDialogError.value = ''
  app.draftDirectory = directory
  const sessionId = await app.createWorktreeSession(directory, { worktreeName })
  isCreatingWorktree.value = false
  if (!sessionId) {
    worktreeDialogError.value = app.lastError || '创建 Worktree 对话失败。'
    return
  }

  worktreeDialogOpen.value = false
  void router.push({ name: 'session', params: { sessionId } })
}

function useProjectDirectory(directory: string) {
  app.draftDirectory = directory
}

const hasProjects = computed(() => app.projects.length > 0 || !!draftProject.value)
const editingPreviewIcon = computed(() => iconOverrideDraft.value || editingProject.value?.icon?.url || '')
</script>

<template>
  <div class="projects-container">
    <header class="projects-header">
      <div class="header-title">
        <h1>项目</h1>
        <span class="count-badge" v-if="app.projects.length">
          {{ app.projects.length }}
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
                {{ getProjectInitial(draftProject.name) }}
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
            <div class="action-group action-group-stack">
              <Button 
                block 
                class="action-btn"
                :disabled="!app.streamReady"
                @click.stop="createForProject(draftProject.directory)"
              >
                <MessageCirclePlus class="h-4 w-4 mr-2" />
                开启新对话
              </Button>
              <Button 
                block 
                variant="outline"
                class="action-btn action-btn-secondary"
                :disabled="!app.streamReady"
                @click.stop="openWorktreeDialog(draftProject.directory, draftProject.name)"
              >
                <GitBranchPlus class="h-4 w-4 mr-2" />
                Worktree 对话
              </Button>
            </div>
          </div>
        </Card>

        <!-- 已有项目卡片 -->
        <Card 
          v-for="project in app.projects" 
          :key="project.directory" 
          class="project-card"
        >
          <button
            v-if="project.projectId"
            type="button"
            class="project-edit-trigger"
            :disabled="!app.streamReady"
            @click.stop="openProjectIconEditor(project)"
          >
            <PencilLine class="h-4 w-4" />
            图标
          </button>

          <div class="card-body" @click="useProjectDirectory(project.directory)">
            <div class="card-header-row">
              <div class="project-icon-box" :style="getProjectIconStyle(project)">
                <img v-if="getProjectIconSrc(project)" :src="getProjectIconSrc(project)" alt="" class="project-icon-image" />
                <span v-else>{{ getProjectInitial(project.name) }}</span>
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
            <div class="action-group">
              <Button 
                variant="outline" 
                size="sm"
                class="action-btn-mini"
                :disabled="!app.streamReady"
                @click.stop="createForProject(project.directory)"
              >
                <MessageCirclePlus class="h-4 w-4" />
                新建对话
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                class="action-btn-mini action-btn-mini-worktree"
                :disabled="!app.streamReady"
                @click.stop="openWorktreeDialog(project.directory, project.name)"
              >
                <GitBranchPlus class="h-4 w-4" />
                Worktree 对话
              </Button>
            </div>
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

      <WorktreeCreateDialog
        v-model:open="worktreeDialogOpen"
        :busy="isCreatingWorktree"
        :project-name="worktreeDialogProjectName"
        :directory="worktreeDialogDirectory"
        :error="worktreeDialogError"
        @confirm="createWorktreeForProject"
      />

      <transition name="fade">
        <div v-if="editingProject" class="editor-overlay" @click.self="closeProjectIconEditor">
          <Card class="editor-card">
            <div class="editor-body">
              <div class="editor-header">
                <div>
                  <h2>设置项目图标</h2>
                  <p>{{ editingProject.name }}</p>
                </div>
                <Button variant="ghost" size="icon" class="editor-close" @click="closeProjectIconEditor">
                  <X class="h-5 w-5" />
                </Button>
              </div>

              <div class="editor-preview-row">
                <div class="project-icon-box preview" :style="{ '--project-icon-accent': ICON_COLOR_VALUES[iconColorDraft] || '' }">
                  <img v-if="editingPreviewIcon" :src="editingPreviewIcon" alt="" class="project-icon-image" />
                  <span v-else>{{ getProjectInitial(editingProject.name) }}</span>
                </div>
                <div class="editor-preview-copy">
                  <strong>{{ iconOverrideDraft ? '自定义图标' : editingProject.icon?.url ? '自动发现图标' : '字母头像' }}</strong>
                  <p>{{ iconFileName || '支持上传一张图片，未上传时保留自动发现图标或首字母头像。' }}</p>
                </div>
              </div>

              <div class="editor-section">
                <div class="section-headline">
                  <ImagePlus class="h-4 w-4" />
                  <span>上传图片</span>
                </div>
                <input ref="iconFileInput" type="file" accept="image/*" class="sr-only" @change="handleIconFileChange" />
                <div class="editor-actions">
                  <Button class="editor-action-btn" @click="triggerIconFilePicker">选择图片</Button>
                  <Button variant="outline" class="editor-action-btn" :disabled="!iconOverrideDraft" @click="clearCustomIcon">清除上传</Button>
                </div>
              </div>

              <div class="editor-section">
                <div class="section-headline">
                  <Check class="h-4 w-4" />
                  <span>头像颜色</span>
                </div>
                <Input v-model="iconColorDraft" placeholder="留空则使用默认主题色" readonly />
                <div class="color-grid">
                  <button
                    v-for="option in ICON_COLOR_OPTIONS"
                    :key="option.value"
                    type="button"
                    class="color-chip"
                    :class="{ active: iconColorDraft === option.value }"
                    :style="{ '--chip-color': ICON_COLOR_VALUES[option.value] }"
                    @click="iconColorDraft = iconColorDraft === option.value ? '' : option.value"
                  >
                    <span class="color-dot"></span>
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <p v-if="editorError" class="editor-error">{{ editorError }}</p>
            </div>

            <div class="editor-footer">
              <Button variant="outline" class="editor-action-btn" @click="closeProjectIconEditor">取消</Button>
              <Button class="editor-action-btn" :disabled="isSavingIcon" @click="saveProjectIcon">
                <LoaderCircle v-if="isSavingIcon" class="h-4 w-4 animate-spin" />
                <Check v-else class="h-4 w-4" />
                保存图标
              </Button>
            </div>
          </Card>
        </div>
      </transition>
    </main>
  </div>
</template>

<style scoped>
/* ─────────────────────────────────────────
   布局容器
───────────────────────────────────────── */
.projects-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--background);
  color: var(--foreground);
}

/* ─────────────────────────────────────────
   顶部标题栏
───────────────────────────────────────── */
.projects-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.75rem 1.5rem 1.25rem;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--background);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.header-title h1 {
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.025em;
  color: var(--foreground);
}

.count-badge {
  font-size: 0.6875rem;
  font-weight: 700;
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
  border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  letter-spacing: 0.03em;
}

/* ─────────────────────────────────────────
   内容区 & 网格
───────────────────────────────────────── */
.projects-content {
  flex: 1;
  padding: 1.25rem 1.25rem 3rem;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--primary) 22%, transparent) transparent;
  -webkit-overflow-scrolling: touch;
}

.projects-content::-webkit-scrollbar {
  -webkit-appearance: none;
  width: 2px;
}

.projects-content::-webkit-scrollbar-track {
  background: transparent;
}

.projects-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--primary) 22%, transparent);
  border-radius: 9999px;
}

.projects-content::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--primary) 34%, transparent);
}

.project-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 680px;
  margin: 0 auto;
}

/* ─────────────────────────────────────────
   项目卡片
───────────────────────────────────────── */
.project-card {
  display: flex;
  flex-direction: column;
  border-radius: 0.875rem;
  border: 1px solid var(--border);
  background: var(--card);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

/* 左侧高亮条 — 悬停时展开 */
.project-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--primary);
  border-radius: 0 2px 2px 0;
  transform: scaleY(0);
  transform-origin: center;
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.project-card:hover::before {
  transform: scaleY(1);
}

.project-card:hover {
  border-color: color-mix(in srgb, var(--primary) 40%, var(--border));
  box-shadow: 0 4px 16px -4px color-mix(in srgb, var(--primary) 15%, transparent),
              0 1px 4px -1px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}

/* 草稿卡片 */
.draft-card {
  border-style: dashed;
  background: color-mix(in srgb, var(--primary) 3%, var(--card));
}

.draft-card::before {
  background: color-mix(in srgb, var(--muted-foreground) 70%, transparent);
}

/* ─────────────────────────────────────────
   编辑按钮（悬停显现）
───────────────────────────────────────── */
.project-edit-trigger {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--card) 90%, transparent);
  color: var(--muted-foreground);
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  backdrop-filter: blur(8px);
  opacity: 0;
  transition: opacity 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.project-card:hover .project-edit-trigger {
  opacity: 1;
}

.project-edit-trigger:hover {
  border-color: color-mix(in srgb, var(--primary) 50%, var(--border));
  color: var(--primary);
}

.project-edit-trigger:disabled {
  opacity: 0 !important;
}

/* ─────────────────────────────────────────
   卡片主体
───────────────────────────────────────── */
.card-body {
  padding: 1.125rem 1.125rem 0.875rem 1.25rem;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.card-header-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

/* ─────────────────────────────────────────
   项目图标
───────────────────────────────────────── */
.project-icon-box {
  --project-icon-accent: var(--primary);
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  background: var(--project-icon-accent);
  color: var(--primary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
  font-weight: 800;
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--project-icon-accent) 30%, transparent);
  transition: box-shadow 0.18s ease;
}

.project-card:hover .project-icon-box {
  box-shadow: 0 4px 12px color-mix(in srgb, var(--project-icon-accent) 40%, transparent);
}

.project-icon-box.draft {
  background: color-mix(in srgb, var(--muted-foreground) 15%, var(--muted));
  color: var(--muted-foreground);
  box-shadow: none;
}

.project-icon-box.preview {
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 0.875rem;
}

.project-icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ─────────────────────────────────────────
   标签 & 状态
───────────────────────────────────────── */
.tag-row {
  display: flex;
  gap: 0.35rem;
}

.status-tag {
  font-size: 0.5625rem;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  white-space: nowrap;
}

.status-tag.draft {
  background: color-mix(in srgb, var(--muted-foreground) 12%, transparent);
  color: var(--muted-foreground);
}

/* ─────────────────────────────────────────
   项目信息文字
───────────────────────────────────────── */
.project-details {
  flex: 1;
  min-width: 0;
}

.project-title {
  font-size: 0.9rem;
  font-weight: 700;
  margin: 0 0 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--foreground);
  letter-spacing: -0.015em;
}

.project-path {
  font-size: 0.6875rem;
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.8;
}

.inline-icon {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
}

/* ─────────────────────────────────────────
   卡片底部
───────────────────────────────────────── */
.card-footer {
  padding: 0.625rem 1.125rem 0.75rem 1.25rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.meta-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.6875rem;
  color: var(--muted-foreground);
  min-width: 0;
}

.meta-divider {
  opacity: 0.3;
  flex-shrink: 0;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.275rem;
  white-space: nowrap;
}

.action-btn {
  border-radius: 0.5rem;
  font-weight: 600;
  width: 100%;
}

.action-btn-secondary {
  color: color-mix(in srgb, var(--primary) 74%, var(--foreground));
}

.action-btn-mini {
  border-radius: 0.5rem;
  height: 1.875rem;
  font-size: 0.71875rem;
  padding: 0 0.75rem;
  gap: 0.35rem;
  flex-shrink: 0;
  white-space: nowrap;
}

.action-btn-mini-worktree {
  color: color-mix(in srgb, var(--primary) 74%, var(--foreground));
}

.action-group {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.action-group-stack {
  width: 100%;
  flex-direction: column;
  justify-content: stretch;
}

/* ─────────────────────────────────────────
   空状态
───────────────────────────────────────── */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 5rem 2rem;
  text-align: center;
}

.hero-icon {
  width: 4rem;
  height: 4rem;
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
  border-radius: 1.125rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
  color: var(--primary);
}

.empty-hero h2 {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 0.625rem;
  letter-spacing: -0.025em;
}

.empty-hero p {
  color: var(--muted-foreground);
  max-width: 18rem;
  margin: 0 0 1.75rem;
  line-height: 1.65;
  font-size: 0.875rem;
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
}

/* ─────────────────────────────────────────
   图标编辑器浮层
───────────────────────────────────────── */
.editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  background: color-mix(in srgb, black 42%, transparent);
  backdrop-filter: blur(6px);
}

.editor-card {
  width: min(100%, 30rem);
  max-height: min(calc(100vh - 4rem), 42rem);
  border-radius: 1.25rem;
  padding: 0;
  background: var(--card);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px -12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255,255,255,0.04);
}

.editor-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.375rem 1.375rem 0;
  overscroll-behavior: contain;
}

.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.editor-header h2 {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.editor-header p {
  margin: 0.25rem 0 0;
  color: var(--muted-foreground);
  font-size: 0.8125rem;
}

.editor-close {
  flex-shrink: 0;
}

.editor-preview-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--muted) 35%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}

.editor-preview-copy {
  min-width: 0;
}

.editor-preview-copy strong {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
}

.editor-preview-copy p {
  margin: 0.25rem 0 0;
  color: var(--muted-foreground);
  font-size: 0.78125rem;
  line-height: 1.5;
  word-break: break-word;
}

.editor-section {
  margin-top: 1.25rem;
}

.section-headline {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.625rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.editor-actions {
  display: flex;
  gap: 0.625rem;
  margin-top: 0.75rem;
}

.editor-footer {
  flex-shrink: 0;
  display: flex;
  gap: 0.625rem;
  padding: 1rem 1.375rem 1.375rem;
  background: var(--card);
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  margin-top: 1.25rem;
}

.editor-action-btn {
  flex: 1;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.625rem;
  margin-top: 0.75rem;
}

.color-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.5rem;
  padding: 0.625rem;
  border-radius: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--chip-color) 20%, var(--border));
  background: color-mix(in srgb, var(--chip-color) 7%, var(--card));
  color: var(--foreground);
  font-size: 0.78125rem;
  font-weight: 600;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.color-chip:hover {
  border-color: color-mix(in srgb, var(--chip-color) 55%, var(--border));
  background: color-mix(in srgb, var(--chip-color) 12%, var(--card));
}

.color-chip.active {
  border-color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 14%, var(--card));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--chip-color) 16%, transparent);
}

.color-dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 999px;
  background: var(--chip-color);
}

.editor-error {
  margin: 1rem 0 0;
  color: var(--destructive);
  font-size: 0.78125rem;
  padding: 0.625rem 0.875rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--destructive) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--destructive) 20%, transparent);
}

/* ─────────────────────────────────────────
   过渡动画
───────────────────────────────────────── */
.fade-enter-active {
  transition: opacity 0.2s ease;
}

.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ─────────────────────────────────────────
   响应式：单列
───────────────────────────────────────── */
@media (max-width: 600px) {
  .projects-header {
    padding: 1.25rem 1.125rem 1rem;
  }

  .projects-content {
    padding: 1rem 1rem 3rem;
  }

  /* 移动端编辑器从底部弹出 */
  .editor-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .editor-card {
    width: 100%;
    max-height: calc(92vh - env(safe-area-inset-bottom));
    border-radius: 1.25rem 1.25rem 0 0;
  }

  .editor-body {
    padding: 1.125rem 1.125rem 0;
  }

  .editor-footer {
    padding: 0.875rem 1.125rem calc(0.875rem + env(safe-area-inset-bottom));
  }

  .card-footer {
    flex-direction: column;
    align-items: stretch;
    gap: 0.625rem;
  }

  .meta-info {
    justify-content: center;
    flex-wrap: wrap;
  }

  .editor-actions,
  .editor-preview-row {
    flex-direction: column;
    align-items: stretch;
  }

  .color-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* 移动端编辑按钮始终可见 */
  .project-edit-trigger {
    opacity: 1;
  }
}
</style>
