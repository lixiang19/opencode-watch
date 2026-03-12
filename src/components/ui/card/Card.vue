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
  cn('rounded-[1.75rem] border border-white/70 bg-white/82 text-card-foreground shadow-[0_18px_40px_rgba(148,163,184,0.18)] backdrop-blur-xl', props.class)
)
</script>

<template>
  <section :class="classes">
    <slot />
  </section>
</template>
