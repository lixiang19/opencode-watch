<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, GitBranch, GitMerge, LoaderCircle, Trash2 } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import { formatPathTail, quoteShellPath } from '@/composables/useOpencodeApp/helpers'
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
const pendingAction = ref<'merge' | 'remove' | ''>('')
const removeConfirmOpen = ref(false)

const mergeCommand = computed(() => {
  if (!props.branch) {
    return ''
  }

  return `git -C ${quoteShellPath(props.rootDirectory)} merge ${quoteShellPath(props.branch)}`
})

const cleanupCommand = computed(() => {
  const commands = [`git -C ${quoteShellPath(props.rootDirectory)} worktree remove ${quoteShellPath(props.worktreeDirectory)}`]
  if (props.branch) {
    commands.push(`git -C ${quoteShellPath(props.rootDirectory)} branch -d ${quoteShellPath(props.branch)}`)
  }

  return commands.join(' && ')
})

const rootBranchLabel = computed(() => {
  if (props.rootBranch) {
    return props.rootBranch
  }

  if (props.rootBranchLoading) {
    return '正在读取主仓库分支...'
  }

  return '暂未拿到主仓库分支'
})

const branchLabel = computed(() => {
  if (props.branch) {
    return props.branch
  }

  if (props.branchLoading) {
    return '正在读取分支...'
  }

  return '暂未拿到分支名'
})

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

  pendingAction.value = 'merge'
  try {
    await app.mergeWorktreeSession(props.sessionId)
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
    await app.removeWorktreeSession(props.sessionId)
    feedback.value = 'Worktree 已删除，对话已从列表移除'
    emit('removed')
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '删除 Worktree 失败。'
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
      <p v-if="rootBranchError || branchError" class="worktree-error">{{ rootBranchError || branchError }}</p>
      <p v-else class="worktree-tip">结束后回到主仓库执行合并，再删除 worktree。</p>
    </div>

    <div class="worktree-actions">
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
