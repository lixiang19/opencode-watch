<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { FolderKanban, MessageCircleMore, Settings2 } from 'lucide-vue-next'

const route = useRoute()

const tabs = [
  { name: 'conversations', label: '微信', icon: MessageCircleMore, to: { name: 'conversations' } },
  { name: 'projects', label: '项目', icon: FolderKanban, to: { name: 'projects' } },
  { name: 'settings', label: '设置', icon: Settings2, to: { name: 'settings' } }
]

const activeTab = computed(() => {
  if (route.name === 'projects') {
    return 'projects'
  }

  if (route.name === 'settings') {
    return 'settings'
  }

  return 'conversations'
})
</script>

<template>
  <div class="shell-root">
    <main class="shell-main">
      <div class="shell-content">
        <RouterView />
      </div>
    </main>

    <nav class="tabbar">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.name"
        :to="tab.to"
        class="tabbar-item"
        :class="{ 'tabbar-item-active': activeTab === tab.name }"
      >
        <component :is="tab.icon" class="h-5 w-5" />
        <span>{{ tab.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
