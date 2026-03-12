<script setup lang="ts">
import { FolderKanban, MessageSquareMore, Settings2 } from 'lucide-vue-next'
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()

const tabs = [
  {
    to: '/',
    icon: MessageSquareMore,
    label: '会话',
    matches: (path: string) => path === '/'
  },
  {
    to: '/chat',
    icon: FolderKanban,
    label: '聊天',
    matches: (path: string) => path.startsWith('/chat')
  },
  {
    to: '/settings',
    icon: Settings2,
    label: '设置',
    matches: (path: string) => path.startsWith('/settings')
  }
]
</script>

<template>
  <div class="mobile-frame">
    <div class="mobile-screen">
      <main class="mobile-content">
        <RouterView />
      </main>

      <nav class="mobile-tabbar">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="mobile-tab"
          :class="tab.matches(route.path) ? 'mobile-tab-active' : ''"
        >
          <component :is="tab.icon" class="h-5 w-5" />
          <span>{{ tab.label }}</span>
        </RouterLink>
      </nav>
    </div>
  </div>
</template>
