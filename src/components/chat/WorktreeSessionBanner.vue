<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Copy, GitBranch, GitMerge, LoaderCircle, Save, Trash2 } from 'lucide-vue-next'

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
} from '@/lib/gitBridge'
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
    return `主仓库当前有 ${rootChangedCount.value} 个未提交改动，暂时不能合并`
  }

  return '主仓库工作区已干净'
})

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

  const [nextWorktreeStatus, nextRootStatus, nextSessionInfo] = await Promise.allSettled([
    getGitDirectoryStatus(props.worktreeDirectory),
    getGitDirectoryStatus(props.rootDirectory),
    app.ensureSessionWorktreeInfo(props.sessionId)
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
    feedback.value = '当前 worktree 还有未提交改动，请先提交。'
    return
  }

  if (rootDirty.value) {
    feedback.value = `worktree 已经是干净的，但主仓库当前还有 ${rootChangedCount.value} 个未提交改动，请先在主仓库处理。`
    return
  }

  pendingAction.value = 'merge'
  try {
    await mergeGitBranch(props.rootDirectory, effectiveBranch.value)
    await refreshStatuses()
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
  <div class="worktree-banner">
    <div class="worktree-copy">
      <div class="worktree-title-row">
        <span class="worktree-pill">Worktree 对话</span>
        <span class="worktree-project">{{ projectName }}</span>
      </div>
      <div class="worktree-meta-row">
        <GitBranch class="h-3.5 w-3.5" />
        <span>{{ rootBranchLabel }} ← 合并 {{ branchLabel }}</span>
      </div>
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
.worktree-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border));
  border-radius: 1rem;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--primary) 8%, transparent), transparent 65%),
    color-mix(in srgb, var(--card) 94%, transparent);
}

.worktree-copy {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.worktree-title-row,
.worktree-meta-row,
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
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: color-mix(in srgb, var(--primary) 82%, var(--foreground));
  font-size: 0.72rem;
  font-weight: 700;
}

.worktree-project {
  font-size: 0.78rem;
  color: var(--muted-foreground);
}

.worktree-meta-row,
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
  width: 100%;
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
  padding: 1rem;
  border-radius: 1.25rem;
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
  .worktree-banner {
    padding: 0.8rem 0.9rem;
  }

  .worktree-actions {
    width: 100%;
  }

  .worktree-confirm-actions {
    flex-direction: column-reverse;
  }
}
</style>
