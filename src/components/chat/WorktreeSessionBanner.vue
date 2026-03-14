<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, Copy, GitBranch, GitMerge, LoaderCircle, Save, Trash2 } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import Input from '@/components/ui/input/Input.vue'
import { formatPathTail, quoteShellPath } from '@/composables/useOpencodeApp/helpers'
import {
  commitGitDirectory,
  getGitDirectoryStatus,
  mergeGitBranch,
  removeGitWorktree,
  type GitDirectoryStatus
} from '@/lib/localBackend'
import { useOpencodeStore } from '@/stores/opencode'

const emit = defineEmits<{
  (event: 'removed'): void
}>()

const props = defineProps<{
  sessionId: string
  projectName: string
  rootDirectory: string
  worktreeDirectory: string
  rootBranch?: string
  rootBranchLoading?: boolean
  rootBranchError?: string
  branch?: string
  branchLoading?: boolean
  branchError?: string
}>()

const app = useOpencodeStore()
const feedback = ref('')
let feedbackTimer: number | null = null
const pendingAction = ref<'status' | 'commit' | 'merge' | 'remove' | ''>('')
const removeConfirmOpen = ref(false)
const commitDialogOpen = ref(false)
const commitMessage = ref('')
const localStatusError = ref('')
const worktreeStatus = ref<GitDirectoryStatus | null>(null)
const rootStatus = ref<GitDirectoryStatus | null>(null)
const expanded = ref(false)

const mergeCommand = computed(() => {
  if (!effectiveBranch.value) {
    return ''
  }

  return `git -C ${quoteShellPath(props.rootDirectory)} merge ${quoteShellPath(effectiveBranch.value)}`
})

const cleanupCommand = computed(() => {
  const commands = [`git -C ${quoteShellPath(props.rootDirectory)} worktree remove ${quoteShellPath(props.worktreeDirectory)}`]
  if (effectiveBranch.value) {
    commands.push(`git -C ${quoteShellPath(props.rootDirectory)} branch -d ${quoteShellPath(effectiveBranch.value)}`)
  }

  return commands.join(' && ')
})

const effectiveBranch = computed(() => worktreeStatus.value?.branch || props.branch || '')
const effectiveRootBranch = computed(() => rootStatus.value?.branch || props.rootBranch || '')
const worktreeDirty = computed(() => worktreeStatus.value?.dirty ?? false)
const rootDirty = computed(() => rootStatus.value?.dirty ?? false)
const worktreeChangedCount = computed(() => worktreeStatus.value?.changedCount ?? 0)
const rootChangedCount = computed(() => rootStatus.value?.changedCount ?? 0)

const rootBranchLabel = computed(() => {
  if (effectiveRootBranch.value) {
    return effectiveRootBranch.value
  }

  if (pendingAction.value === 'status' || props.rootBranchLoading) {
    return '正在读取主仓库分支...'
  }

  return '暂未拿到主仓库分支'
})

const branchLabel = computed(() => {
  if (effectiveBranch.value) {
    return effectiveBranch.value
  }

  if (pendingAction.value === 'status' || props.branchLoading) {
    return '正在读取分支...'
  }

  return '暂未拿到分支名'
})

const worktreeStateText = computed(() => {
  if (pendingAction.value === 'status') {
    return '正在检查 worktree 状态...'
  }

  if (worktreeDirty.value) {
    return `worktree 还有 ${worktreeChangedCount.value} 个未提交改动，先提交再合并`
  }

  return 'worktree 工作区已干净'
})

const rootStateText = computed(() => {
  if (pendingAction.value === 'status') {
    return '正在检查主仓库状态...'
  }

  if (rootDirty.value) {
    return `主仓库当前有 ${rootChangedCount.value} 个未提交改动，合并时以 Git 实际结果为准`
  }

  return '主仓库工作区已干净'
})

const collapsedSummary = computed(() => {
  if (localStatusError.value || props.rootBranchError || props.branchError) {
    return '状态异常'
  }

  if (worktreeDirty.value) {
    return `待提交 ${worktreeChangedCount.value}`
  }

  if (pendingAction.value === 'merge') {
    return '合并中'
  }

  return '已就绪'
})

const collapsedDescription = computed(() => `${rootBranchLabel.value} ← ${branchLabel.value}`)

watch(
  () => [props.sessionId, props.rootDirectory, props.worktreeDirectory].join('|'),
  () => {
    void refreshStatuses()
  },
  { immediate: true }
)

function seedCommitMessage() {
  commitMessage.value = `chore: save ${effectiveBranch.value || 'worktree'} changes`
}

async function refreshStatuses() {
  if (!props.rootDirectory || !props.worktreeDirectory) {
    return
  }

  pendingAction.value = 'status'
  localStatusError.value = ''

  const shouldRefreshSessionInfo = !props.branch || !props.rootBranch || props.branchLoading || props.rootBranchLoading
  const [nextWorktreeStatus, nextRootStatus, nextSessionInfo] = await Promise.allSettled([
    getGitDirectoryStatus(props.worktreeDirectory),
    getGitDirectoryStatus(props.rootDirectory),
    shouldRefreshSessionInfo ? app.ensureSessionWorktreeInfo(props.sessionId) : Promise.resolve(null)
  ])

  if (nextWorktreeStatus.status === 'fulfilled') {
    worktreeStatus.value = nextWorktreeStatus.value
  } else {
    localStatusError.value = nextWorktreeStatus.reason instanceof Error ? nextWorktreeStatus.reason.message : '读取 worktree 状态失败。'
  }

  if (nextRootStatus.status === 'fulfilled') {
    rootStatus.value = nextRootStatus.value
  } else if (!localStatusError.value) {
    localStatusError.value = nextRootStatus.reason instanceof Error ? nextRootStatus.reason.message : '读取主仓库状态失败。'
  }

  if (nextSessionInfo.status === 'rejected' && !localStatusError.value) {
    localStatusError.value = nextSessionInfo.reason instanceof Error ? nextSessionInfo.reason.message : '同步 worktree 信息失败。'
  }

  pendingAction.value = ''
}

async function copyText(label: string, text: string) {
  if (!text) {
    return
  }

  await navigator.clipboard.writeText(text)
  feedback.value = `${label}已复制`
  if (feedbackTimer) {
    window.clearTimeout(feedbackTimer)
  }
  feedbackTimer = window.setTimeout(() => {
    feedback.value = ''
    feedbackTimer = null
  }, 1800)
}

async function mergeIntoRoot() {
  if (pendingAction.value || !props.sessionId) {
    return
  }

  if (worktreeDirty.value) {
    seedCommitMessage()
    commitDialogOpen.value = true
    expanded.value = true
    feedback.value = '当前 worktree 还有未提交改动，请先提交。'
    return
  }

  pendingAction.value = 'merge'
  try {
    await mergeGitBranch(props.rootDirectory, effectiveBranch.value)
    await refreshStatuses()
    expanded.value = true
    feedback.value = '已合并到主仓库当前分支'
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '合并失败，请在终端手动处理。'
  } finally {
    pendingAction.value = ''
  }
}

async function removeWorktree() {
  if (pendingAction.value || !props.sessionId) {
    return
  }

  removeConfirmOpen.value = false
  pendingAction.value = 'remove'
  try {
    await removeGitWorktree(props.rootDirectory, props.worktreeDirectory, effectiveBranch.value)
    await app.archiveSession(props.sessionId, props.worktreeDirectory)
    await app.refreshSessions({ reopen: false })
    feedback.value = 'Worktree 已删除，对话已从列表移除'
    emit('removed')
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '删除 Worktree 失败。'
  } finally {
    pendingAction.value = ''
  }
}

async function commitWorktree() {
  if (pendingAction.value || !commitMessage.value.trim()) {
    return
  }

  pendingAction.value = 'commit'
  try {
    await commitGitDirectory(props.worktreeDirectory, commitMessage.value.trim())
    commitDialogOpen.value = false
    await refreshStatuses()
    expanded.value = true
    feedback.value = '当前 worktree 改动已提交'
  } catch (error) {
    if (error instanceof Error && error.message.includes('没有可提交的改动')) {
      feedback.value = '当前 worktree 已经是干净的，没有未提交改动；如果还不能合并，请看主仓库状态。'
    } else {
      feedback.value = error instanceof Error ? error.message : '提交失败，请检查 Git 配置。'
    }
  } finally {
    pendingAction.value = ''
  }
}
</script>

<template>
  <div class="worktree-anchor">
    <button type="button" class="worktree-trigger" :aria-expanded="expanded" @click="expanded = !expanded">
      <GitBranch class="h-3 w-3 worktree-trigger-icon" />
      <span class="worktree-trigger-label">Worktree</span>
      <span class="worktree-trigger-state">{{ collapsedSummary }}</span>
      <ChevronDown class="h-3 w-3 worktree-trigger-chevron" :class="{ 'worktree-trigger-chevron-open': expanded }" />
    </button>

    <div v-if="expanded" class="worktree-panel">
      <div class="worktree-panel-head">
        <div class="worktree-title-row">
          <span class="worktree-pill">Worktree 对话</span>
          <span class="worktree-project">{{ projectName }}</span>
        </div>
        <div class="worktree-collapse-meta">
          <span class="worktree-branch-inline">
            <GitBranch class="h-3.5 w-3.5" />
            {{ collapsedDescription }}
          </span>
          <span class="worktree-inline-path">{{ formatPathTail(worktreeDirectory, 3) }}</span>
        </div>
      </div>

      <div class="worktree-copy">
        <div class="worktree-path-row">
          <span>主仓库 {{ formatPathTail(rootDirectory, 3) }}</span>
          <span>工作目录 {{ formatPathTail(worktreeDirectory, 4) }}</span>
        </div>
        <div class="worktree-status-row">
          <span>{{ rootStateText }}</span>
          <span>{{ worktreeStateText }}</span>
        </div>
        <p v-if="localStatusError" class="worktree-error">{{ localStatusError }}</p>
        <p v-if="rootBranchError || branchError" class="worktree-error">{{ rootBranchError || branchError }}</p>
        <p v-else class="worktree-tip">结束后回到主仓库执行合并，再删除 worktree。</p>
      </div>

      <div class="worktree-actions">
        <Button variant="outline" size="sm" :disabled="pendingAction === 'merge' || pendingAction === 'remove'" @click="seedCommitMessage(); commitDialogOpen = true">
          <LoaderCircle v-if="pendingAction === 'commit'" class="h-3.5 w-3.5 animate-spin" />
          <Save v-else class="h-3.5 w-3.5" />
          {{ pendingAction === 'commit' ? '正在提交...' : '提交改动' }}
        </Button>
        <Button variant="outline" size="sm" :disabled="!mergeCommand || pendingAction === 'remove'" @click="mergeIntoRoot">
          <LoaderCircle v-if="pendingAction === 'merge'" class="h-3.5 w-3.5 animate-spin" />
          <GitMerge v-else class="h-3.5 w-3.5" />
          {{ pendingAction === 'merge' ? '正在合并...' : '合并回主仓库' }}
        </Button>
        <Button variant="outline" size="sm" :disabled="pendingAction === 'merge'" @click="removeConfirmOpen = true">
          <LoaderCircle v-if="pendingAction === 'remove'" class="h-3.5 w-3.5 animate-spin" />
          <Trash2 v-else class="h-3.5 w-3.5" />
          {{ pendingAction === 'remove' ? '正在删除...' : '删除 Worktree' }}
        </Button>
        <Button variant="ghost" size="sm" :disabled="!worktreeDirectory || !!pendingAction" @click="copyText('清理命令', cleanupCommand)">
          <Copy class="h-3.5 w-3.5" />
          复制命令
        </Button>
      </div>
      <p v-if="feedback" class="worktree-feedback">{{ feedback }}</p>
    </div>

    <div v-if="removeConfirmOpen" class="worktree-confirm" role="dialog" aria-modal="true" aria-labelledby="worktree-remove-title">
      <div class="worktree-confirm-backdrop" @click="removeConfirmOpen = false" />
      <Card class="worktree-confirm-card">
        <h3 id="worktree-remove-title">确认删除这个 Worktree？</h3>
        <p>这会移除当前 worktree 目录，并把这条对话从列表里归档隐藏。</p>
        <div class="worktree-confirm-meta">
          <span>主仓库分支：{{ rootBranchLabel }}</span>
          <span>Worktree 分支：{{ branchLabel }}</span>
          <span>目录：{{ formatPathTail(worktreeDirectory, 4) }}</span>
        </div>
        <div class="worktree-confirm-actions">
          <Button variant="outline" :disabled="pendingAction === 'remove'" @click="removeConfirmOpen = false">取消</Button>
          <Button variant="destructive" :disabled="pendingAction === 'remove'" @click="removeWorktree">
            <LoaderCircle v-if="pendingAction === 'remove'" class="h-4 w-4 animate-spin" />
            <Trash2 v-else class="h-4 w-4" />
            {{ pendingAction === 'remove' ? '删除中...' : '确认删除' }}
          </Button>
        </div>
      </Card>
    </div>

    <div v-if="commitDialogOpen" class="worktree-confirm" role="dialog" aria-modal="true" aria-labelledby="worktree-commit-title">
      <div class="worktree-confirm-backdrop" @click="commitDialogOpen = false" />
      <Card class="worktree-confirm-card">
        <h3 id="worktree-commit-title">提交当前 Worktree 改动</h3>
        <p>会在 worktree 内执行 `git add -A` 和 `git commit -m ...`，提交后才能真正合并回主仓库。</p>
        <div class="worktree-confirm-meta">
          <span>分支：{{ branchLabel }}</span>
          <span>待提交文件：{{ worktreeChangedCount }}</span>
        </div>
        <label class="worktree-commit-field">
          <span>Commit message</span>
          <Input v-model="commitMessage" placeholder="chore: save worktree changes" @keydown.enter.prevent="commitWorktree" />
        </label>
        <div class="worktree-confirm-actions">
          <Button variant="outline" :disabled="pendingAction === 'commit'" @click="commitDialogOpen = false">取消</Button>
          <Button :disabled="pendingAction === 'commit' || !commitMessage.trim()" @click="commitWorktree">
            <LoaderCircle v-if="pendingAction === 'commit'" class="h-4 w-4 animate-spin" />
            <Save v-else class="h-4 w-4" />
            {{ pendingAction === 'commit' ? '提交中...' : '确认提交' }}
          </Button>
        </div>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.worktree-anchor {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.worktree-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.75rem;
  padding: 0 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--secondary);
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-family: var(--font-sans);
  font-weight: 400;
  cursor: pointer;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.worktree-trigger:hover {
  background: var(--accent);
  color: var(--foreground);
  border-color: color-mix(in srgb, var(--foreground) 15%, transparent);
}

.worktree-trigger-icon { color: var(--muted-foreground); flex-shrink: 0; }

.worktree-trigger-label {
  color: var(--foreground);
  font-weight: 500;
  white-space: nowrap;
}

.worktree-trigger-state {
  display: inline-flex;
  align-items: center;
  padding: 0.05rem 0.32rem;
  border: 1px solid var(--border);
  border-radius: 9999px;
  color: var(--muted-foreground);
  font-size: 0.65rem;
  background: transparent;
}

.worktree-trigger-chevron {
  color: var(--muted-foreground);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.worktree-trigger-chevron-open { transform: rotate(180deg); }

.worktree-panel {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 30;
  display: grid;
  gap: 0.75rem;
  width: min(28rem, calc(100vw - 2rem));
  padding: 0.875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--popover);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  font-family: var(--font-sans);
  font-size: 0.8rem;
}

.worktree-panel-head {
  display: grid;
  gap: 0.35rem;
}

.worktree-copy {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
}

.worktree-title-row,
.worktree-collapse-meta,
.worktree-path-row,
.worktree-status-row,
.worktree-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.worktree-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.4rem;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: var(--secondary);
  color: var(--foreground);
  font-size: 0.7rem;
  font-weight: 500;
}

.worktree-project {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--muted-foreground);
}

.worktree-summary-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--foreground) 7%, transparent);
  color: var(--muted-foreground);
  font-size: 0.71rem;
  font-weight: 600;
}

.worktree-branch-inline,
.worktree-inline-path {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.worktree-inline-path {
  opacity: 0.82;
}

.worktree-collapse-toggle {
  display: none;
}

.worktree-collapse-meta,
.worktree-path-row,
.worktree-status-row,
.worktree-tip,
.worktree-error {
  font-size: 0.78rem;
  color: var(--muted-foreground);
}

.worktree-error {
  color: var(--destructive);
}

.worktree-feedback {
  margin: 0;
  font-size: 0.78rem;
  color: color-mix(in srgb, var(--primary) 80%, var(--foreground));
}

.worktree-confirm {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.worktree-confirm-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--background) 32%, black);
  backdrop-filter: blur(8px);
}

.worktree-confirm-card {
  position: relative;
  width: min(100%, 28rem);
  padding: 1.25rem;
  border-radius: var(--radius);
  font-family: var(--font-sans);
  background: var(--popover);
  border: 1px solid var(--border);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}

.worktree-confirm-card h3,
.worktree-confirm-card p {
  margin: 0;
}

.worktree-confirm-card p,
.worktree-confirm-meta {
  color: var(--muted-foreground);
}

.worktree-confirm-card p {
  margin-top: 0.5rem;
  line-height: 1.6;
}

.worktree-confirm-meta {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.85rem;
  font-size: 0.8rem;
}

.worktree-commit-field {
  display: grid;
  gap: 0.45rem;
  margin-top: 0.9rem;
}

.worktree-commit-field span {
  color: var(--muted-foreground);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.worktree-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1rem;
}

@media (max-width: 720px) {
  .worktree-trigger {
    padding-inline: 0.62rem;
  }

  .worktree-title-row,
  .worktree-collapse-meta,
  .worktree-status-row,
  .worktree-actions {
    gap: 0.4rem;
  }

  .worktree-actions {
    width: 100%;
  }

  .worktree-panel {
    position: fixed;
    top: calc(env(safe-area-inset-top) + 4.25rem);
    right: 0.8rem;
    left: 0.8rem;
    width: auto;
    max-height: min(70vh, 34rem);
    overflow: auto;
  }

  .worktree-summary-pill {
    order: 3;
  }

  .worktree-inline-path {
    width: 100%;
  }

  .worktree-confirm-actions {
    flex-direction: column-reverse;
  }
}
</style>
