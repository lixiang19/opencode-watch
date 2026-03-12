<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Clock, FolderOpenDot, FolderSync, ImagePlus, LoaderCircle, MessageCirclePlus, PencilLine, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import Input from '@/components/ui/input/Input.vue'
import { formatRelativeTime } from '@/lib/format'
import { useOpencodeState } from '@/lib/app-context'
import type { ProjectRecord } from '@/types/opencode'

const app = useOpencodeState()
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
const editingPreviewIcon = computed(() => iconOverrideDraft.value || editingProject.value?.icon?.url || '')
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
          <button
            v-if="project.projectId"
            type="button"
            class="project-edit-trigger"
            :disabled="!app.streamReady.value"
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

.project-edit-trigger {
  position: absolute;
  top: 0.875rem;
  right: 0.875rem;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--background) 85%, transparent);
  color: var(--muted-foreground);
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  font-size: 0.75rem;
  font-weight: 600;
  backdrop-filter: blur(10px);
}

.project-edit-trigger:disabled {
  opacity: 0.5;
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
  --project-icon-accent: var(--primary);
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  background: var(--project-icon-accent);
  color: var(--primary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--project-icon-accent) 20%, transparent);
  flex-shrink: 0;
  overflow: hidden;
}

.project-icon-box.draft {
  background: var(--accent);
  color: var(--accent-foreground);
}

.project-icon-box.preview {
  width: 4rem;
  height: 4rem;
}

.project-icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  background: color-mix(in srgb, black 38%, transparent);
}

.editor-card {
  width: min(100%, 32rem);
  max-height: min(calc(100vh - 4rem), 44rem);
  border-radius: 1.5rem;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.editor-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem 1.25rem 0;
  overscroll-behavior: contain;
}

.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.editor-header h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
}

.editor-header p {
  margin: 0.35rem 0 0;
  color: var(--muted-foreground);
  font-size: 0.875rem;
}

.editor-close {
  flex-shrink: 0;
}

.editor-preview-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1.25rem;
  padding: 1rem;
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--muted) 40%, transparent);
}

.editor-preview-copy {
  min-width: 0;
}

.editor-preview-copy strong {
  display: block;
  font-size: 0.95rem;
}

.editor-preview-copy p {
  margin: 0.35rem 0 0;
  color: var(--muted-foreground);
  font-size: 0.8125rem;
  line-height: 1.5;
  word-break: break-word;
}

.editor-section {
  margin-top: 1.25rem;
}

.section-headline {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
}

.editor-actions,
.editor-footer {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.875rem;
}

.editor-footer {
  flex-shrink: 0;
  padding: 1rem 1.25rem 1.25rem;
  background: var(--card);
  border-top: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
}

.editor-action-btn {
  flex: 1;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.875rem;
}

.color-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 2.75rem;
  padding: 0.75rem;
  border-radius: 1rem;
  border: 1px solid color-mix(in srgb, var(--chip-color) 22%, var(--border));
  background: color-mix(in srgb, var(--chip-color) 10%, var(--card));
  color: var(--foreground);
  font-size: 0.8125rem;
  font-weight: 600;
}

.color-chip.active {
  border-color: var(--chip-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--chip-color) 18%, transparent);
}

.color-dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 999px;
  background: var(--chip-color);
}

.editor-error {
  margin: 1rem 0 0;
  color: var(--destructive);
  font-size: 0.8125rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .editor-overlay {
    align-items: flex-start;
    padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem calc(5.75rem + env(safe-area-inset-bottom));
  }

  .editor-card {
    width: 100%;
    height: auto;
    max-height: calc(100vh - 7.5rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    border-radius: 1.25rem;
  }

  .editor-body {
    padding: 1rem 1rem 0;
  }

  .card-footer,
  .editor-actions,
  .editor-footer,
  .editor-preview-row {
    flex-direction: column;
    align-items: stretch;
  }

  .project-edit-trigger {
    top: 0.75rem;
    right: 0.75rem;
  }

  .meta-info {
    justify-content: center;
    flex-wrap: wrap;
  }

  .color-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .editor-footer {
    padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
  }
}
</style>
