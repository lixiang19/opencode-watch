<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { GitBranchPlus, LoaderCircle } from 'lucide-vue-next'

import Button from '@/components/ui/button/Button.vue'
import Card from '@/components/ui/card/Card.vue'
import Input from '@/components/ui/input/Input.vue'
import { buildWorktreeSessionName, formatPathTail } from '@/composables/useOpencodeApp/helpers'

const props = withDefaults(
  defineProps<{
    open: boolean
    busy?: boolean
    projectName: string
    directory: string
    error?: string
  }>(),
  {
    busy: false,
    error: ''
  }
)

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'confirm', worktreeName: string): void
}>()

const worktreeName = ref('')

const canSubmit = computed(() => Boolean(worktreeName.value.trim()) && !props.busy)

watch(
  () => props.open,
  (open) => {
    if (open) {
      worktreeName.value = buildWorktreeSessionName()
    }
  },
  { immediate: true }
)

function closeDialog() {
  if (props.busy) {
    return
  }

  emit('update:open', false)
}

function submit() {
  if (!canSubmit.value) {
    return
  }

  emit('confirm', worktreeName.value.trim())
}
</script>

<template>
  <div v-if="open" class="worktree-dialog" role="dialog" aria-modal="true" aria-labelledby="worktree-dialog-title">
    <div class="worktree-dialog-backdrop" @click="closeDialog" />

    <Card class="worktree-dialog-card">
      <div class="worktree-dialog-header">
        <div class="worktree-dialog-icon">
          <GitBranchPlus class="h-5 w-5" />
        </div>
        <div>
          <p class="worktree-dialog-kicker">新建 Worktree 对话</p>
          <h2 id="worktree-dialog-title">先确认这次分支名</h2>
        </div>
      </div>

      <div class="worktree-dialog-body">
        <p class="worktree-dialog-copy">会基于当前项目创建一个新的 worktree，然后在那个目录里开启对话。</p>
        <div class="worktree-dialog-meta">
          <span>{{ projectName || '未命名项目' }}</span>
          <span>{{ formatPathTail(directory, 4) }}</span>
        </div>

        <label class="worktree-dialog-field">
          <span>Worktree / 分支名</span>
          <Input v-model="worktreeName" placeholder="chat-20260314-123000-abcd" autofocus @keydown.enter.prevent="submit" />
        </label>

        <p class="worktree-dialog-note">这里填的名字会直接作为 worktree 名和分支名使用。</p>
        <p v-if="error" class="worktree-dialog-error">{{ error }}</p>
      </div>

      <div class="worktree-dialog-actions">
        <Button variant="outline" :disabled="busy" @click="closeDialog">取消</Button>
        <Button :disabled="!canSubmit" @click="submit">
          <LoaderCircle v-if="busy" class="h-4 w-4 animate-spin" />
          <GitBranchPlus v-else class="h-4 w-4" />
          {{ busy ? '创建中...' : '创建 Worktree 对话' }}
        </Button>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.worktree-dialog {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
}

.worktree-dialog-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--background) 36%, black);
  backdrop-filter: blur(10px);
}

.worktree-dialog-card {
  position: relative;
  width: min(100%, 32rem);
  padding: 1.25rem;
  border-radius: 1.5rem;
  box-shadow: var(--shadow-2xl);
}

.worktree-dialog-header {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.worktree-dialog-icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: color-mix(in srgb, var(--primary) 82%, var(--foreground));
}

.worktree-dialog-kicker {
  margin: 0 0 0.35rem;
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.worktree-dialog-header h2 {
  margin: 0;
  font-size: 1.4rem;
}

.worktree-dialog-body {
  display: grid;
  gap: 0.8rem;
  margin-top: 1rem;
}

.worktree-dialog-copy,
.worktree-dialog-note,
.worktree-dialog-meta,
.worktree-dialog-field span {
  color: var(--muted-foreground);
}

.worktree-dialog-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.worktree-dialog-field {
  display: grid;
  gap: 0.45rem;
}

.worktree-dialog-field span {
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.worktree-dialog-note {
  margin: 0;
  font-size: 0.8rem;
}

.worktree-dialog-error {
  margin: 0;
  color: var(--destructive);
  font-size: 0.8rem;
}

.worktree-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1rem;
}

@media (max-width: 640px) {
  .worktree-dialog-card {
    padding: 1rem;
  }

  .worktree-dialog-actions {
    flex-direction: column-reverse;
  }
}
</style>
