import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { BeforeInstallPromptEvent } from '@/lib/pwa'
import { getNotificationPermission, isNotificationSupported, isStandaloneDisplay, trimNotificationBody } from '@/lib/pwa'
import type { PendingCompletionNotice } from './types'
import { getDirectoryName, getNotificationTargetUrl } from './helpers'
import type { SessionRecord } from '@/types/opencode'

export function createPwaManager(args: {
  activeSession: ComputedRef<SessionRecord | null>
  sessions: Ref<SessionRecord[]>
}) {
  const notificationPermission = ref<NotificationPermission>(getNotificationPermission())
  const isRequestingNotificationPermission = ref(false)
  const installPromptEvent = ref<BeforeInstallPromptEvent | null>(null)
  const isPwaInstalled = ref(isStandaloneDisplay())
  const serviceWorkerRegistration = ref<ServiceWorkerRegistration | null>(null)

  let pendingCompletionNotice: PendingCompletionNotice | null = null
  let displayModeQuery: MediaQueryList | null = null

  const notificationSupported = computed(() => isNotificationSupported())
  const notificationsEnabled = computed(
    () => notificationSupported.value && notificationPermission.value === 'granted'
  )
  const installAvailable = computed(() => Boolean(installPromptEvent.value))

  function clearPendingCompletionNotice(sessionId?: string) {
    if (!sessionId || pendingCompletionNotice?.sessionId === sessionId) {
      pendingCompletionNotice = null
    }
  }

  function armCompletionNotice(sessionId: string, prompt: string) {
    pendingCompletionNotice = {
      sessionId,
      prompt: trimNotificationBody(prompt)
    }
  }

  function syncInstalledState() {
    isPwaInstalled.value = isStandaloneDisplay()
  }

  async function ensureServiceWorkerRegistration() {
    if (!notificationSupported.value) {
      return null
    }

    if (serviceWorkerRegistration.value) {
      return serviceWorkerRegistration.value
    }

    const registration = await navigator.serviceWorker.register('/service-worker.js')
    serviceWorkerRegistration.value = await navigator.serviceWorker.ready
    return serviceWorkerRegistration.value ?? registration
  }

  async function requestNotificationPermission() {
    if (!notificationSupported.value || isRequestingNotificationPermission.value) {
      return notificationPermission.value
    }

    isRequestingNotificationPermission.value = true
    try {
      await ensureServiceWorkerRegistration()
      notificationPermission.value = await Notification.requestPermission()
      return notificationPermission.value
    } finally {
      isRequestingNotificationPermission.value = false
    }
  }

  async function maybeNotifySessionCompletion(sessionId: string) {
    if (!notificationsEnabled.value) {
      return
    }

    const pending = pendingCompletionNotice?.sessionId === sessionId ? pendingCompletionNotice : null
    if (pending) {
      pendingCompletionNotice = null
    }

    const registration = await ensureServiceWorkerRegistration()
    if (!registration) {
      return
    }

    const session = args.sessions.value.find((item) => item.id === sessionId) ?? args.activeSession.value
    const sessionLabel = session?.title?.trim() || getDirectoryName(session?.directory || '')
    const body = pending?.prompt
      ? `${sessionLabel} 已完成：${pending.prompt}`
      : `${sessionLabel} 已回到空闲状态。`

    await registration.showNotification('AI 已完成', {
      body,
      icon: '/icons/pwa-192.png',
      badge: '/icons/pwa-badge.png',
      tag: `session-complete-${sessionId}`,
      data: {
        sessionId,
        url: getNotificationTargetUrl(sessionId)
      }
    })
  }

  function handleBeforeInstallPrompt(event: Event) {
    event.preventDefault()
    installPromptEvent.value = event as BeforeInstallPromptEvent
  }

  function handleAppInstalled() {
    installPromptEvent.value = null
    syncInstalledState()
  }

  async function promptInstall() {
    if (!installPromptEvent.value) {
      return false
    }

    const currentPrompt = installPromptEvent.value
    installPromptEvent.value = null
    await currentPrompt.prompt()
    const choice = await currentPrompt.userChoice
    syncInstalledState()
    return choice.outcome === 'accepted'
  }

  function mountPwa() {
    notificationPermission.value = getNotificationPermission()
    syncInstalledState()

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
    window.addEventListener('appinstalled', handleAppInstalled)

    const handleDisplayModeChange = () => syncInstalledState()
    displayModeQuery = window.matchMedia('(display-mode: standalone)')

    if (typeof displayModeQuery.addEventListener === 'function') {
      displayModeQuery.addEventListener('change', handleDisplayModeChange)
    } else {
      displayModeQuery.addListener?.(handleDisplayModeChange)
    }

    void ensureServiceWorkerRegistration().catch(() => undefined)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
      window.removeEventListener('appinstalled', handleAppInstalled)

      if (displayModeQuery) {
        if (typeof displayModeQuery.removeEventListener === 'function') {
          displayModeQuery.removeEventListener('change', handleDisplayModeChange)
        } else {
          displayModeQuery.removeListener?.(handleDisplayModeChange)
        }
      }
    }
  }

  return {
    armCompletionNotice,
    clearPendingCompletionNotice,
    installAvailable,
    isPwaInstalled,
    isRequestingNotificationPermission,
    maybeNotifySessionCompletion,
    mountPwa,
    notificationPermission,
    notificationSupported,
    notificationsEnabled,
    promptInstall,
    requestNotificationPermission
  }
}
