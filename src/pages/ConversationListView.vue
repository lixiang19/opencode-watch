<script setup lang="ts">
import { Wifi, WifiOff } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import { formatRelativeTime } from '@/lib/format'
import { useOpencodeState } from '@/lib/app-context'

const app = useOpencodeState()
const router = useRouter()

function openConversation(sessionId: string) {
  void router.push({ name: 'session', params: { sessionId } })
}
</script>

<template>
  <section class="page conversations-page">
    <div class="list-panel">
      <div v-if="!app.sessions.value.length" class="empty-state empty-state-large">
        <div class="empty-icon">
          <Wifi v-if="app.streamReady.value" class="h-6 w-6" />
          <WifiOff v-else class="h-6 w-6" />
        </div>
        <h2>{{ app.streamReady.value ? '还没有对话' : '尚未连接服务' }}</h2>
        <p>{{ app.streamReady.value ? '去项目页选一个项目，然后点“新建对话”。' : '先到设置页填写服务地址并连接。' }}</p>
      </div>

      <button
        v-for="session in app.sessions.value"
        :key="session.id"
        type="button"
        class="wechat-row"
        @click="openConversation(session.id)"
      >
        <div class="wechat-avatar">{{ (session.title || session.directory || 'O').slice(0, 1).toUpperCase() }}</div>
        <div class="wechat-row-body">
          <div class="wechat-row-top">
            <strong>{{ session.title || '未命名对话' }}</strong>
            <span>{{ formatRelativeTime(session.time.updated || session.time.created) }}</span>
          </div>
          <div class="wechat-row-bottom">
            <span>{{ session.directory || '未绑定项目目录' }}</span>
          </div>
        </div>
      </button>
    </div>
  </section>
</template>
