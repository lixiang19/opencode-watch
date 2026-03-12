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

<style scoped>
.msg-row {
  display: flex;
}

.msg-row-user {
  justify-content: flex-end;
}

.msg-row-assistant {
  justify-content: flex-start;
}

.msg-bubble {
  max-width: min(86%, 34rem);
  padding: 0.875rem 1rem;
  border-radius: 1.5rem;
}

.msg-bubble-user {
  background: var(--primary);
  color: var(--primary-foreground);
  border-bottom-right-radius: 0.625rem;
}

.msg-bubble-assistant {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--card-foreground);
  border-bottom-left-radius: 0.625rem;
}

.msg-text {
  margin: 0;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-time {
  display: block;
  margin-top: 0.5rem;
  color: inherit;
  font-size: 0.6875rem;
  opacity: 0.7;
  text-align: right;
}

@media (max-width: 640px) {
  .msg-bubble {
    max-width: 92%;
  }
}
</style>
