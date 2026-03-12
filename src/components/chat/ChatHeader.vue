<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, LoaderCircle } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import Badge from '@/components/ui/badge/Badge.vue'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()
const router = useRouter()

const statusText = computed(() =>
  app.sessionStatus.value === 'busy' || app.isSending.value ? '处理中' : ''
)

function goBack() {
  void router.push({ name: 'conversations' })
}
</script>

<template>
  <header class="chat-topbar">
    <button class="btn-icon" type="button" @click="goBack">
      <ArrowLeft class="h-5 w-5" />
    </button>

    <div class="topbar-title">
      <div class="topbar-session-name">{{ app.activeSession.value?.title || '对话详情' }}</div>
      <div class="topbar-project-name">{{ app.selectedProjectMeta.value?.name || app.activeSession.value?.directory || '未绑定项目' }}</div>
    </div>

    <div class="topbar-right">
      <Badge v-if="statusText" tone="accent" class="text-[10px] px-2 py-0.5">
        <LoaderCircle class="h-3 w-3 animate-spin mr-1" />
        {{ statusText }}
      </Badge>
      <div class="connection-dot" :class="app.streamReady.value ? 'dot-connected' : 'dot-disconnected'" />
    </div>
  </header>
</template>
