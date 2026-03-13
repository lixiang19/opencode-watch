import type { Ref } from 'vue'

import { createDesktopSessionState } from './catalog'
import { SESSION_LIST_REFRESH_DELAY } from './constants'
import type { SessionListFlag, SessionListUiState } from './types'
import type { ChatMessageRecord, DesktopSessionState } from '@/types/opencode'

type Badge = { key: 'new' | 'completed'; label: string; tone: 'accent' | 'success' }

export function createSessionStateManager(args: {
  desktopSessions: Ref<Record<string, DesktopSessionState>>
  sessionListUiState: Ref<Record<string, SessionListUiState>>
  sessionPreviewMessages: Ref<Record<string, ChatMessageRecord[]>>
  refreshSessions: (options?: { reopen?: boolean }) => Promise<void>
}) {
  let sessionListRefreshTimer: ReturnType<typeof window.setTimeout> | null = null
  let sessionListRefreshPending = false
  let sessionListRefreshRunning = false
  const pendingNewSessionIds = new Set<string>()

  function setSessionListUiState(sessionId: string, nextState: SessionListUiState | null) {
    const nextEntries = { ...args.sessionListUiState.value }

    if (nextState && (nextState.isNew || nextState.justCompleted)) {
      nextEntries[sessionId] = nextState
    } else {
      delete nextEntries[sessionId]
    }

    args.sessionListUiState.value = nextEntries
  }

  function clearSessionListBadges(sessionId: string) {
    if (!sessionId) {
      return
    }

    setSessionListUiState(sessionId, null)
  }

  function markSessionListFlag(sessionId: string, flag: SessionListFlag) {
    if (!sessionId) {
      return
    }

    const currentState = args.sessionListUiState.value[sessionId] ?? {}
    setSessionListUiState(sessionId, {
      ...currentState,
      [flag]: true
    })
  }

  function syncSessionListUiState(sessionIds: string[]) {
    const validSessionIds = new Set(sessionIds)
    const nextEntries = Object.fromEntries(
      Object.entries(args.sessionListUiState.value).filter(([sessionId, state]) => {
        return validSessionIds.has(sessionId) && (state.isNew || state.justCompleted)
      })
    )

    args.sessionListUiState.value = nextEntries
  }

  function getSessionListBadges(sessionId: string): Badge[] {
    const state = args.sessionListUiState.value[sessionId]
    if (!state) {
      return []
    }

    return [
      state.isNew
        ? {
            key: 'new',
            label: '新',
            tone: 'accent' as const
          }
        : null,
      state.justCompleted
        ? {
            key: 'completed',
            label: '刚完成',
            tone: 'success' as const
          }
        : null
    ].filter((badge): badge is Badge => Boolean(badge))
  }

  function syncSessionPreviewCache(sessionIds: string[]) {
    const validIds = new Set(sessionIds)
    args.sessionPreviewMessages.value = Object.fromEntries(
      Object.entries(args.sessionPreviewMessages.value).filter(([sessionId]) => validIds.has(sessionId))
    )
  }

  function ensureDesktopSessionState(sessionId: string) {
    const existing = args.desktopSessions.value[sessionId]
    if (existing) {
      return existing
    }

    const nextState = createDesktopSessionState(sessionId)
    args.desktopSessions.value = {
      ...args.desktopSessions.value,
      [sessionId]: nextState
    }
    return nextState
  }

  function removeDesktopSessionState(sessionId: string) {
    if (!args.desktopSessions.value[sessionId]) {
      return
    }

    const nextEntries = { ...args.desktopSessions.value }
    delete nextEntries[sessionId]
    args.desktopSessions.value = nextEntries
  }

  function syncDesktopSessionStates(sessionIds: string[]) {
    const validSessionIds = new Set(sessionIds)
    args.desktopSessions.value = Object.fromEntries(
      Object.entries(args.desktopSessions.value).filter(([sessionId]) => validSessionIds.has(sessionId))
    )
  }

  function syncSessionPreviewFromMessages(sessionId: string, nextMessages: ChatMessageRecord[]) {
    if (!sessionId) {
      return
    }

    args.sessionPreviewMessages.value = {
      ...args.sessionPreviewMessages.value,
      [sessionId]: nextMessages.slice()
    }
  }

  function scheduleSessionListRefresh(options: { newSessionId?: string } = {}) {
    if (options.newSessionId) {
      pendingNewSessionIds.add(options.newSessionId)
    }

    sessionListRefreshPending = true

    if (sessionListRefreshTimer || sessionListRefreshRunning) {
      return
    }

    sessionListRefreshTimer = window.setTimeout(() => {
      sessionListRefreshTimer = null
      void flushSessionListRefresh()
    }, SESSION_LIST_REFRESH_DELAY)
  }

  async function flushSessionListRefresh() {
    if (!sessionListRefreshPending || sessionListRefreshRunning) {
      return
    }

    sessionListRefreshRunning = true
    sessionListRefreshPending = false
    const newSessionIds = Array.from(pendingNewSessionIds)
    pendingNewSessionIds.clear()

    try {
      await args.refreshSessions({ reopen: false })

      for (const sessionId of newSessionIds) {
        markSessionListFlag(sessionId, 'isNew')
      }
    } finally {
      sessionListRefreshRunning = false

      if (sessionListRefreshPending) {
        scheduleSessionListRefresh()
      }
    }
  }

  function disposeSessionStateManager() {
    if (sessionListRefreshTimer) {
      window.clearTimeout(sessionListRefreshTimer)
    }
  }

  return {
    clearSessionListBadges,
    disposeSessionStateManager,
    ensureDesktopSessionState,
    getSessionListBadges,
    markSessionListFlag,
    removeDesktopSessionState,
    scheduleSessionListRefresh,
    syncDesktopSessionStates,
    syncSessionListUiState,
    syncSessionPreviewCache,
    syncSessionPreviewFromMessages
  }
}
