<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    class?: string
  }>(),
  {
    class: ''
  }
)

const classes = computed(() =>
  cn('rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-[var(--shadow-lg)]', props.class)
)
</script>

<template>
  <section :class="classes">
    <slot />
  </section>
</template>
