<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { FolderKanban, MessageCircleMore, Settings2 } from 'lucide-vue-next'

const route = useRoute()

const tabs = [
  { name: 'conversations', label: '对话', icon: MessageCircleMore, to: { name: 'conversations' } },
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

<style scoped>
.shell-root {
  --tabbar-height: calc(3.5rem + env(safe-area-inset-bottom));
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--background);
}

.shell-main {
  flex: 1;
  min-height: 0;
  display: flex;
  min-height: calc(100vh - var(--tabbar-height));
}

.shell-content {
  width: 100%;
  min-height: calc(100vh - var(--tabbar-height));
  padding-bottom: var(--tabbar-height);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  -webkit-overflow-scrolling: touch;
}

.shell-content::-webkit-scrollbar {
  -webkit-appearance: none;
  width: 2px !important;
}

.shell-content::-webkit-scrollbar-track {
  background: transparent;
}

.shell-content::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 9999px;
}

.shell-content::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.tabbar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 40;
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.25rem;
  padding: 0.375rem 0.75rem calc(0.375rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  background: var(--card);
}

.tabbar-item {
  display: flex;
  min-height: 2.75rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  border-radius: var(--radius);
  color: var(--muted-foreground);
  font-size: 0.6875rem;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.1s, color 0.1s;
}

.tabbar-item:hover {
  background: var(--secondary);
  color: var(--foreground);
}

.tabbar-item-active {
  background: var(--secondary);
  color: var(--foreground);
}

@media (min-width: 768px) {
  .tabbar {
    padding-right: 1.5rem;
    padding-left: 1.5rem;
  }
}
</style>
