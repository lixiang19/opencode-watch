<script setup lang="ts">
import { computed } from 'vue'

import Card from '@/components/ui/card/Card.vue'
import { formatClockTime } from '@/lib/format'
import type { ChatMessageRecord } from '@/types/opencode'

const props = defineProps<{
  message: ChatMessageRecord
}>()

const isUser = computed(() => props.message.role === 'user')

const cardClass = computed(() =>
  [
    'max-w-[88%] space-y-2 rounded-[1.5rem] px-4 py-3 shadow-none',
    isUser.value
      ? 'border-transparent bg-slate-950 text-white'
      : 'border-white/80 bg-white text-slate-900'
  ].join(' ')
)

const timeLabel = computed(() => {
  return formatClockTime(props.message.updatedAt)
})
</script>

<template>
  <div :class="['flex w-full', isUser ? 'justify-end' : 'justify-start']">
    <Card :class="cardClass">
      <div class="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em]" :class="isUser ? 'text-white/60' : 'text-slate-400'">
        <span>{{ isUser ? '你' : 'Opencode' }}</span>
        <span v-if="timeLabel">{{ timeLabel }}</span>
      </div>
      <p class="whitespace-pre-wrap break-words text-[15px] leading-7">{{ message.content || '...' }}</p>
    </Card>
  </div>
</template>
