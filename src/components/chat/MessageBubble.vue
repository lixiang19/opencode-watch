<script setup lang="ts">
import { computed } from 'vue'

import { formatClockTime } from '@/lib/format'
import type { ChatMessageRecord } from '@/types/opencode'

const props = defineProps<{
  message: ChatMessageRecord
}>()

const isUser = computed(() => props.message.role === 'user')
const time = computed(() => formatClockTime(props.message.updatedAt))
</script>

<template>
  <div :class="['msg-row', isUser ? 'msg-row-user' : 'msg-row-assistant']">
    <div :class="['msg-bubble', isUser ? 'msg-bubble-user' : 'msg-bubble-assistant']">
      <p class="msg-text">{{ message.content || '…' }}</p>
      <span class="msg-time">{{ time }}</span>
    </div>
  </div>
</template>
