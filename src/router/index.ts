import { createRouter, createWebHistory } from 'vue-router'

import AppLayout from '@/components/layout/AppLayout.vue'
import ChatView from '@/pages/ChatView.vue'
import ConversationListView from '@/pages/ConversationListView.vue'
import DesktopWarRoomView from '@/pages/DesktopWarRoomView.vue'
import ProjectsView from '@/pages/ProjectsView.vue'
import SettingsView from '@/pages/SettingsView.vue'

function prefersDesktopWarRoom() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1100px)').matches
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: AppLayout,
      redirect: () => (prefersDesktopWarRoom() ? { name: 'desktop-war-room' } : { name: 'conversations' }),
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
      path: '/conversations/new',
      name: 'session-draft',
      component: ChatView
    },
    {
      path: '/conversations/:sessionId',
      name: 'session',
      component: ChatView
    },
    {
      path: '/desktop-war-room',
      name: 'desktop-war-room',
      component: DesktopWarRoomView
    }
  ]
})
