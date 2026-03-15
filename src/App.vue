<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'

import AuthGateDialog from '@/components/auth/AuthGateDialog.vue'
import { useTheme } from '@/composables/useTheme'
import { useOpencodeStore } from '@/stores/opencode'

useTheme()

const app = useOpencodeStore()
const canRenderAppShell = computed(() => app.adminSessionReady && app.adminAuthenticated)
</script>

<template>
  <RouterView v-if="canRenderAppShell" />
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
