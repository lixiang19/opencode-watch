<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'

import { provideOpencodeState } from '@/lib/app-context'
import { useOpencodeApp } from '@/composables/useOpencodeApp'

const app = useOpencodeApp()

provideOpencodeState(app)

onMounted(() => {
  void app.connect()
})
</script>

<template>
  <RouterView />
</template>
