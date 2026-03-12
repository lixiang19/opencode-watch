import { createRouter, createWebHistory } from 'vue-router'

import AppLayout from '@/components/layout/AppLayout.vue'
import ChatView from '@/pages/ChatView.vue'
import ConversationListView from '@/pages/ConversationListView.vue'
import ProjectsView from '@/pages/ProjectsView.vue'
import SettingsView from '@/pages/SettingsView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: AppLayout,
      redirect: { name: 'conversations' },
      children: [
        {
          path: 'conversations',
          name: 'conversations',
          component: ConversationListView
        },
        {
          path: 'projects',
          name: 'projects',
          component: ProjectsView
        },
        {
          path: 'settings',
          name: 'settings',
          component: SettingsView
        }
      ]
    },
    {
      path: '/conversations/:sessionId',
      name: 'session',
      component: ChatView
    }
  ]
})
