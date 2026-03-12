import { createRouter, createWebHistory } from 'vue-router'

import MobileShell from '@/components/layout/MobileShell.vue'
import ChatView from '@/pages/ChatView.vue'
import HomeView from '@/pages/HomeView.vue'
import SettingsView from '@/pages/SettingsView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: MobileShell,
      children: [
        {
          path: '',
          name: 'home',
          component: HomeView
        },
        {
          path: 'chat/:sessionId?',
          name: 'chat',
          component: ChatView
        },
        {
          path: 'settings',
          name: 'settings',
          component: SettingsView
        }
      ]
    }
  ]
})
