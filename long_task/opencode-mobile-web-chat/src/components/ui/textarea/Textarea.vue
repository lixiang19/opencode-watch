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
    'flex min-h-28 w-full rounded-xl border border-input bg-white/80 px-3 py-3 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
