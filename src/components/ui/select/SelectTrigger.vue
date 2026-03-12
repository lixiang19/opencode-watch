<script setup lang="ts">
import type { SelectTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ChevronDown } from 'lucide-vue-next'
import { SelectIcon, SelectTrigger, useForwardProps } from 'reka-ui'

import { cn } from '@/lib/utils'

const props = defineProps<SelectTriggerProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectTrigger
    v-bind="forwardedProps"
    :class="cn(
      'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-xl border border-[var(--input)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] shadow-[var(--shadow-sm)] ring-offset-background data-[placeholder]:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ring)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate text-start',
      props.class
    )"
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
    </SelectIcon>
  </SelectTrigger>
</template>
