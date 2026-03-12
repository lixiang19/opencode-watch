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
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--primary) 14%, transparent), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--background) 92%, white), var(--background));
}

.shell-main {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  padding: 0 0.875rem;
}

.shell-content {
  width: min(100%, 62rem);
  min-height: 100%;
  padding-bottom: calc(5.5rem + env(safe-area-inset-bottom));
}

.tabbar {
  position: fixed;
  left: 50%;
  bottom: max(0.875rem, env(safe-area-inset-bottom));
  z-index: 40;
  display: grid;
  width: min(62rem, calc(100vw - 1.5rem));
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 0.5rem;
  transform: translateX(-50%);
  border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
  border-radius: 1.5rem;
  background: color-mix(in srgb, var(--card) 88%, transparent);
  box-shadow: var(--shadow-xl);
  backdrop-filter: blur(18px);
}

.tabbar-item {
  display: flex;
  min-height: 3.5rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  border-radius: 1.125rem;
  color: var(--muted-foreground);
  text-decoration: none;
  transition: background-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.tabbar-item:hover {
  transform: translateY(-1px);
}

.tabbar-item-active {
  background: color-mix(in srgb, var(--accent) 70%, transparent);
  color: var(--foreground);
}

@media (min-width: 768px) {
  .shell-main {
    padding: 1.25rem 1.5rem 1.75rem;
  }

  .tabbar {
    width: min(54rem, calc(100vw - 2.5rem));
  }
}
</style>
