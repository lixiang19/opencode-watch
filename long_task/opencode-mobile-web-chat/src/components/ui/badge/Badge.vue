<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    tone?: 'default' | 'muted' | 'accent' | 'success' | 'danger'
    class?: string
  }>(),
  {
    tone: 'default',
    class: ''
  }
)

const classes = computed(() => {
  const toneMap = {
    default: 'bg-foreground text-background',
    muted: 'bg-secondary text-secondary-foreground',
    accent: 'bg-accent/15 text-foreground',
    success: 'bg-emerald-100 text-emerald-800',
    danger: 'bg-red-100 text-red-800'
  }

  return cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]', toneMap[props.tone], props.class)
})
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>
