<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'

import AuthGateDialog from '@/components/auth/AuthGateDialog.vue'
import { useOpencodeStore } from '@/stores/opencode'

const app = useOpencodeStore()

onMounted(() => {
  if (app.hasAuthCredentials) {
    void app.connect()
  }
})
</script>

<template>
  <RouterView />
  <AuthGateDialog />
</template>

<style>
:global(html) {
  min-height: 100%;
  font-family: var(--font-sans);
  -webkit-text-size-adjust: 100%;
}

:global(body) {
  min-height: 100vh;
  margin: 0;
  background: var(--background);
  color: var(--foreground);
}

:global(#app) {
  min-height: 100vh;
}

:global(button),
:global(input),
:global(textarea) {
  font: inherit;
}

:global(a) {
  color: inherit;
}

:global(*) {
  box-sizing: border-box;
  border-color: var(--border);
}
</style>
