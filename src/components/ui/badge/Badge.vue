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
    default: 'bg-[var(--foreground)] text-[var(--background)]',
    muted: 'bg-[var(--secondary)] text-[var(--secondary-foreground)]',
    accent: 'bg-[var(--accent)] text-[var(--accent-foreground)]',
    success: 'bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-[var(--primary)]',
    danger: 'bg-[color-mix(in_srgb,var(--destructive)_16%,transparent)] text-[var(--destructive)]'
  }

  return cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]', toneMap[props.tone], props.class)
})
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>
