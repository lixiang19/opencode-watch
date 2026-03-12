<script setup lang="ts">
import { computed } from 'vue'

import Card from '@/components/ui/card/Card.vue'
import type { ChatMessageRecord } from '@/types/opencode'

const props = defineProps<{
  message: ChatMessageRecord
}>()

const isUser = computed(() => props.message.role === 'user')

const cardClass = computed(() =>
  [
    'max-w-[88%] space-y-2 px-4 py-3 sm:max-w-[78%]',
    isUser.value ? 'border-primary/30 bg-primary text-primary-foreground' : 'bg-white/90'
  ].join(' ')
)

const timeLabel = computed(() => {
  if (!props.message.updatedAt) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(props.message.updatedAt)
})
</script>

<template>
  <div :class="['flex w-full', isUser ? 'justify-end' : 'justify-start']">
    <Card
      :class="cardClass"
    >
      <div class="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em]" :class="isUser ? 'text-primary-foreground/80' : 'text-muted-foreground'">
        <span>{{ isUser ? '你' : 'Opencode' }}</span>
        <span v-if="timeLabel">{{ timeLabel }}</span>
      </div>
      <p class="whitespace-pre-wrap break-words text-sm leading-6">{{ message.content || '...' }}</p>
    </Card>
  </div>
</template>
