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
}>()

const attrs = useAttrs()
const classes = computed(() =>
  cn(
    'flex min-h-28 w-full rounded-[1.5rem] border border-[var(--input)] bg-[var(--background)] px-4 py-4 text-[15px] text-[var(--foreground)] shadow-[var(--shadow-sm)] transition placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--ring)_20%,transparent)]',
    props.class,
    attrs.disabled ? 'cursor-not-allowed opacity-50' : ''
  )
)
</script>

<template>
  <textarea
    v-bind="attrs"
    :value="modelValue"
    :class="classes"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
