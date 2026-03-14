<script setup lang="ts">
import { computed, watch } from 'vue'
import { ArrowLeft, LoaderCircle } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'

import Button from '@/components/ui/button/Button.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatPane from '@/components/chat/ChatPane.vue'
import WorktreeSessionBanner from '@/components/chat/WorktreeSessionBanner.vue'
import { getSessionWorkingInfo } from '@/composables/useOpencodeApp/messages'
import { useOpencodeStore } from '@/stores/opencode'

const route = useRoute()
const router = useRouter()
const app = useOpencodeStore()

const workingInfo = computed(() => getSessionWorkingInfo(app.messages, app.sessionStatus))
const activeWorktreeInfo = computed(() => app.getSessionWorktreeInfo(app.selectedSessionId))

async function syncSession(sessionId?: string | string[]) {
  const id = Array.isArray(sessionId) ? sessionId[0] : sessionId
  if (!id) {
    return
  }

  if (app.selectedSessionId === id && app.messages.length) {
    return
  }

  await app.openSession(id)
}

async function loadOlderMessages() {
  await app.loadOlderMessages()
}

function goBack() {
  void router.push({ name: 'conversations' })
}

watch(
  () => route.params.sessionId,
  (id) => {
    void syncSession(id)
  },
  { immediate: true }
)

watch(
  () => app.selectedSessionId,
  (sessionId) => {
    if (!sessionId) {
      return
    }

    void app.ensureSessionWorktreeInfo(sessionId)
  },
  { immediate: true }
)
</script>

<template>
  <ChatPane
    :title="app.activeSession?.title || '对话详情'"
    :project-name="app.activeSession?.directory || '未绑定项目'"
    :messages="app.visibleMessages"
    :connected="app.streamReady"
    :busy="app.sessionStatus === 'busy' || app.isSending"
    :is-loading="app.isLoadingSession"
    :last-error="app.lastError"
    :has-truncated-messages="app.hasTruncatedMessages"
    :history-limit="app.historyMessageLimit"
    :loading-older="app.isLoadingOlderMessages"
    :working-info="workingInfo"
  >
    <template v-if="activeWorktreeInfo" #trailing>
      <WorktreeSessionBanner
        :session-id="activeWorktreeInfo.sessionId"
        :project-name="activeWorktreeInfo.projectName"
        :root-directory="activeWorktreeInfo.rootDirectory"
        :worktree-directory="activeWorktreeInfo.worktreeDirectory"
        :root-branch="activeWorktreeInfo.rootBranch"
        :root-branch-loading="activeWorktreeInfo.rootBranchLoading"
        :root-branch-error="activeWorktreeInfo.rootBranchError"
        :branch="activeWorktreeInfo.branch"
        :branch-loading="activeWorktreeInfo.branchLoading"
        :branch-error="activeWorktreeInfo.branchError"
        @removed="goBack"
      />
    </template>

    <template #leading>
      <button class="btn-back" type="button" @click="goBack">
        <ArrowLeft class="h-4 w-4" />
      </button>
    </template>

    <template #history-action>
      <Button
        variant="outline"
        size="sm"
        :disabled="app.isLoadingOlderMessages"
        @click="loadOlderMessages"
      >
        <LoaderCircle v-if="app.isLoadingOlderMessages" class="h-3.5 w-3.5 animate-spin" />
        <template v-else>加载更早</template>
      </Button>
    </template>

    <template #composer>
      <ChatComposer />
    </template>
  </ChatPane>
</template>

<style scoped>
.btn-back {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--background);
  color: var(--foreground);
  transition: background 0.15s, color 0.15s;
  cursor: pointer;
}

.btn-back:hover {
  background: var(--accent);
}
</style>
