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
  cn('panel-grain rounded-[1.4rem] border border-border/90 bg-card/85 text-card-foreground shadow-panel shadow-inset backdrop-blur', props.class)
)
</script>

<template>
  <section :class="classes">
    <slot />
  </section>
</template>
