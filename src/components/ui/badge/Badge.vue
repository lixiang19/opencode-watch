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
    default: 'bg-slate-950 text-white',
    muted: 'bg-slate-200/70 text-slate-700',
    accent: 'bg-orange-100 text-orange-700',
    success: 'bg-emerald-100 text-emerald-700',
    danger: 'bg-red-100 text-red-700'
  }

  return cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]', toneMap[props.tone], props.class)
})
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>
