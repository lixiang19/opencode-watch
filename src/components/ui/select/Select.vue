<script setup lang="ts">
import { computed, useAttrs } from 'vue'

import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    class?: string
  }>(),
  {
    modelValue: '',
    class: ''
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [event: Event]
}>()

const attrs = useAttrs()
const classes = computed(() =>
  cn(
    'flex h-9 w-full min-w-0 cursor-pointer appearance-none rounded-xl border border-[var(--input)] bg-[var(--background)] pl-3 pr-8 text-sm text-[var(--foreground)] shadow-[var(--shadow-sm)] transition focus-visible:border-[var(--ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--ring)_20%,transparent)]',
    attrs.disabled ? 'cursor-not-allowed opacity-50' : '',
    props.class
  )
)
</script>

<template>
  <div class="select-wrap">
    <select
      v-bind="attrs"
      :value="modelValue"
      :class="classes"
      @change="emit('change', $event); emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
    <svg
      class="select-chevron"
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </div>
</template>

<style scoped>
.select-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.select-chevron {
  position: absolute;
  right: 0.625rem;
  color: var(--muted-foreground);
  pointer-events: none;
  flex-shrink: 0;
}
</style>
