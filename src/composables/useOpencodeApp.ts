import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  createOpencodeClient,
  type Command as OpencodeCommand,
  type Event as OpencodeEvent,
  type GlobalEvent as OpencodeGlobalEvent,
  type GlobalSession,
  type Project
} from '@opencode-ai/sdk/v2/client'

import {
  buildAgentCatalog,
  buildCommandCatalog,
  buildModelCatalog,
  mapGlobalSession,
  mapProjectCatalogEntry,
  resolveChatSelections,
  resolveDefaultModelKey
} from '@/composables/useOpencodeApp/catalog'
import {
  CHAT_OPTIONS_PRELOAD_SESSION_LIMIT,
  GLOBAL_CHAT_OPTIONS_KEY,
  INITIAL_HISTORY_LIMIT,
  MOBILE_SESSION_CACHE_LIMIT,
  PROJECT_SESSION_PAGE_SIZE,
  RECENT_PROJECT_WINDOW,
  SESSION_LIST_LIMIT,
  STORAGE_KEYS
} from '@/composables/useOpencodeApp/constants'
import {
  buildAuthHeader,
  getProjectIdentityKey,
  getDirectoryName,
  isUnauthorizedError,
  makeModelKey,
  normalizeDirectory,
  normalizeModelKey,
  parseError
} from '@/composables/useOpencodeApp/helpers'
import {
  applyEventToMessageCollection,
  getEventSessionId,
  isRenderableMessage,
  pruneEmptyAssistantMessages
} from '@/composables/useOpencodeApp/messages'
import { createPwaManager } from '@/composables/useOpencodeApp/pwa'
import { createSessionActions } from '@/composables/useOpencodeApp/sessionActions'
import { createSessionStateManager } from '@/composables/useOpencodeApp/sessionState'
import {
  getGitDirectoryStatus,
  getAdminSessionStatus,
  getLocalRuntimeStatus,
  loginAdminSession,
  logoutAdminSession,
  restartManagedOpencode,
  setLocalBackendCsrfToken,
  type AdminSessionStatus,
  type GitDirectoryStatus,
  type LocalRuntimeStatus
} from '@/lib/localBackend'
import {
  readSessionStorage,
  readStorage,
  writeSessionStorage,
  writeStorage
} from '@/lib/storage'
import type {
  ChatAgentRecord,
  ChatCommandRecord,
  DesktopSessionState,
  ChatMessageRecord,
  ChatModelRecord,
  ComposerMode,
  ProjectIconRecord,
  ProjectRecord,
  SessionRecord,
  SessionWorktreeInfo
} from '@/types/opencode'

import type {
  AgentInfo,
  CachedSessionState,
  ChatOptionsSnapshot,
  ConfigProvidersResponse,
  ProjectCatalogEntry,
  SessionHistorySelection,
  SessionListUiState,
  SkillInfo
} from '@/composables/useOpencodeApp/types'

type OpencodeClient = ReturnType<typeof createOpencodeClient>

interface SessionProjectGrouping {
  key: string
  directory: string
  name: string
  projectId?: string
  icon?: ProjectIconRecord
  isWorktree: boolean
  rootDirectory: string
  worktreeDirectory: string
}

const LOCAL_OPENCODE_PROXY_PATH = '/oc'
const LEGACY_LOCAL_OPENCODE_URLS = new Set(['http://127.0.0.1:4096', 'http://localhost:4096'])
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//

function resolveInitialServerUrl() {
  const storedValue = readStorage(STORAGE_KEYS.serverUrl, LOCAL_OPENCODE_PROXY_PATH).trim()
  if (!storedValue) {
    return LOCAL_OPENCODE_PROXY_PATH
  }

  return LEGACY_LOCAL_OPENCODE_URLS.has(storedValue) ? LOCAL_OPENCODE_PROXY_PATH : storedValue
}

function resolveInitialChatSelections() {
  const migrationVersion = readStorage(STORAGE_KEYS.selectionMigration, '')
  const storedAgentId = readStorage(STORAGE_KEYS.selectedAgent, '')
  const storedModelKey = readStorage(STORAGE_KEYS.selectedModel, '')
  const storedVariant = readStorage(STORAGE_KEYS.selectedVariant, '')

  if (migrationVersion || storedAgentId !== 'build') {
    return {
      selectedAgentId: storedAgentId,
      selectedModelKey: storedModelKey,
      selectedVariant: storedVariant
    }
  }

  writeStorage(STORAGE_KEYS.selectedAgent, '')
  writeStorage(STORAGE_KEYS.selectedModel, '')
  writeStorage(STORAGE_KEYS.selectedVariant, '')
  writeStorage(STORAGE_KEYS.selectionMigration, 'v1')

  return {
    selectedAgentId: '',
    selectedModelKey: '',
    selectedVariant: ''
  }
}

function resolveServerBaseUrl(value: string) {
  const trimmed = value.trim() || LOCAL_OPENCODE_PROXY_PATH
  if (ABSOLUTE_URL_PATTERN.test(trimmed)) {
    return trimmed
  }

  const currentOrigin = typeof window === 'undefined' ? 'http://127.0.0.1:9001' : window.location.origin
  return new URL(trimmed, currentOrigin).toString()
}

export function useOpencodeApp() {
  const initialChatSelections = resolveInitialChatSelections()
  const serverUrl = ref(resolveInitialServerUrl())
  const adminPassword = ref('')
  const username = ref(readStorage(STORAGE_KEYS.username, 'opencode'))
  const password = ref(readSessionStorage(STORAGE_KEYS.password, ''))
  const selectedSessionId = ref(readStorage(STORAGE_KEYS.selectedSession, ''))
  const draftDirectory = ref(readStorage(STORAGE_KEYS.draftDirectory, ''))
  const composerMode = ref<ComposerMode>(
    readStorage(STORAGE_KEYS.composerMode, 'prompt') === 'command' ? 'command' : 'prompt'
  )
  const selectedAgentId = ref(initialChatSelections.selectedAgentId)
  const selectedModelKey = ref(normalizeModelKey(initialChatSelections.selectedModelKey))
  const selectedVariant = ref(initialChatSelections.selectedVariant)
  const defaultModelKey = ref('')
  const composerText = ref('')
  const selectedCommandName = ref('')
  const singleDraftSession = ref(false)
  const availableAgents = ref<ChatAgentRecord[]>([])
  const availableCommands = ref<ChatCommandRecord[]>([])
  const availableModels = ref<ChatModelRecord[]>([])
  const sessions = ref<SessionRecord[]>([])
  const projectCatalog = ref<ProjectCatalogEntry[]>([])
  const messages = ref<ChatMessageRecord[]>([])
  const sessionPreviewMessages = ref<Record<string, ChatMessageRecord[]>>({})
  const desktopSessions = ref<Record<string, DesktopSessionState>>({})
  const isConnecting = ref(false)
  const isLoadingSession = ref(false)
  const isSending = ref(false)
  const isRefreshing = ref(false)
  const isLoadingOlderMessages = ref(false)
  const isAdminAuthenticating = ref(false)
  const isRestartingOpencode = ref(false)
  const sessionStatus = ref<'idle' | 'busy'>('idle')
  const lastError = ref('')
  const adminAuthError = ref('')
  const adminSessionReady = ref(false)
  const adminAuthenticated = ref(false)
  const streamReady = ref(false)
  const authValidated = ref(false)
  const historyMessageLimit = ref(INITIAL_HISTORY_LIMIT)
  const hasMoreHistory = ref(false)
  const sessionListUiState = ref<Record<string, SessionListUiState>>({})
  const localRuntimeStatus = ref<LocalRuntimeStatus | null>(null)
  const adminSessionExpiresAt = ref('')
  const opencodeAuthRequested = ref(false)

  const clientCache = new Map<string, OpencodeClient>()
  const mobileSessionCache = new Map<string, CachedSessionState>()
  const mobileSessionCacheOrder: string[] = []
  let closeStream: (() => void) | null = null
  let preloadHomeDataRequest: Promise<void> | null = null
  let suppressedChatOptionLoadKey = ''
  let activeChatOptionsRequestId = 0
  const chatOptionsCache = new Map<string, ChatOptionsSnapshot>()
  const chatOptionsRequests = new Map<string, Promise<ChatOptionsSnapshot>>()
  let globalCommandsCache: OpencodeCommand[] | null = null
  let globalCommandsRequest: Promise<OpencodeCommand[]> | null = null
  const worktreeBranchState = ref<Record<string, { branch: string; loading: boolean; error: string }>>({})
  const worktreeBranchRequests = new Map<string, Promise<string>>()
  const gitDirectoryState = ref<Record<string, { status: GitDirectoryStatus | null; loading: boolean; error: string }>>({})
  const gitDirectoryRequests = new Map<string, Promise<GitDirectoryStatus>>()

  const hasAuthCredentials = computed(() => Boolean(username.value.trim()) && Boolean(password.value.trim()))
  const authGateMode = computed<'admin' | 'opencode' | null>(() => {
    if (!adminSessionReady.value || !adminAuthenticated.value) {
      return 'admin'
    }

    return !authValidated.value && opencodeAuthRequested.value ? 'opencode' : null
  })
  const authGateVisible = computed(() => authGateMode.value !== null)
  const authGateMessage = computed(() => {
    if (authGateMode.value === 'admin') {
      return adminAuthError.value || '请输入管理密码，先建立本地控制面的安全会话。'
    }

    if (!hasAuthCredentials.value) {
      return '当前 OpenCode 服务开启了 Basic Auth，请填写账号和密码。'
    }

    return lastError.value || '请输入可用的认证信息并完成连接验证。'
  })

  const activeSession = computed(() =>
    sessions.value.find((session) => session.id === selectedSessionId.value) ?? null
  )
  const sessionDirectory = computed(() => normalizeDirectory(activeSession.value?.directory))

  const selectedAgent = computed(() =>
    availableAgents.value.find((agent) => agent.id === selectedAgentId.value) ?? null
  )

  const selectedCommand = computed(() =>
    availableCommands.value.find((command) => command.name === selectedCommandName.value) ?? null
  )

  const selectedModel = computed(() =>
    availableModels.value.find((model) => model.key === normalizeModelKey(selectedModelKey.value)) ?? null
  )

  const visibleMessages = computed(() => {
    return messages.value
      .filter((message) => isRenderableMessage(message) || message.parts.some((p) => p.type === 'patch' || p.type === 'tool' || p.type === 'reasoning'))
      .slice(-historyMessageLimit.value)
  })
  const hiddenMessageCount = computed(() => {
    return Math.max(messages.value.filter((message) => isRenderableMessage(message)).length - visibleMessages.value.length, 0)
  })
  const hasTruncatedMessages = computed(() => hasMoreHistory.value || hiddenMessageCount.value > 0)

  function touchMobileSessionCache(sessionId: string) {
    const currentIndex = mobileSessionCacheOrder.indexOf(sessionId)
    if (currentIndex >= 0) {
      mobileSessionCacheOrder.splice(currentIndex, 1)
    }

    mobileSessionCacheOrder.push(sessionId)
  }

  function trimMobileSessionCache() {
    while (mobileSessionCacheOrder.length > MOBILE_SESSION_CACHE_LIMIT) {
      let evictedSessionId = ''

      for (let index = 0; index < mobileSessionCacheOrder.length; index += 1) {
        const candidate = mobileSessionCacheOrder[index]
        if (candidate === selectedSessionId.value || desktopSessions.value[candidate]) {
          continue
        }

        evictedSessionId = candidate
        mobileSessionCacheOrder.splice(index, 1)
        break
      }

      if (!evictedSessionId) {
        return
      }

      mobileSessionCache.delete(evictedSessionId)
    }
  }

  function getCachedSessionState(sessionId: string) {
    const cached = mobileSessionCache.get(sessionId) ?? null
    if (cached) {
      touchMobileSessionCache(sessionId)
    }
    return cached
  }

  function setCachedSessionState(sessionId: string, state: CachedSessionState) {
    mobileSessionCache.set(sessionId, state)
    touchMobileSessionCache(sessionId)
    trimMobileSessionCache()
  }

  function removeCachedSessionState(sessionId: string) {
    if (!mobileSessionCache.delete(sessionId)) {
      return
    }

    const currentIndex = mobileSessionCacheOrder.indexOf(sessionId)
    if (currentIndex >= 0) {
      mobileSessionCacheOrder.splice(currentIndex, 1)
    }
  }

  function syncCachedSessionStates(sessionIds: string[]) {
    const validIds = new Set(sessionIds)
    for (const sessionId of [...mobileSessionCache.keys()]) {
      if (!validIds.has(sessionId)) {
        removeCachedSessionState(sessionId)
      }
    }
  }

  function suppressNextChatOptionLoad(directory?: string) {
    suppressedChatOptionLoadKey = getChatOptionsCacheKey(directory)
  }

  function getProjectCatalogEntry(projectId?: string | null) {
    const normalizedProjectId = projectId?.trim() || ''
    if (!normalizedProjectId) {
      return null
    }

    return projectCatalog.value.find((project) => project.projectId === normalizedProjectId) ?? null
  }

  function getSessionProjectRootCandidate(session?: SessionRecord | null) {
    if (!session) {
      return ''
    }

    const projectId = session.projectId || session.project?.id || ''
    const projectMatch = getProjectCatalogEntry(projectId)
    return normalizeDirectory(session.project?.worktree || projectMatch?.directory || session.directory)
  }

  function getCachedGitDirectoryStatus(directory?: string | null) {
    const normalizedDirectory = normalizeDirectory(directory)
    if (!normalizedDirectory) {
      return null
    }

    return gitDirectoryState.value[normalizedDirectory]?.status ?? null
  }

  function isLinkedWorktreeRoot(status?: GitDirectoryStatus | null) {
    return Boolean(status?.isLinkedWorktree && status?.isWorktreeRoot && normalizeDirectory(status.mainWorktreeRoot))
  }

  function getSessionProjectGrouping(session?: SessionRecord | null): SessionProjectGrouping | null {
    if (!session) {
      return null
    }

    const sessionDirectory = normalizeDirectory(session.directory)
    if (!sessionDirectory) {
      return null
    }

    const projectId = session.projectId || session.project?.id || ''
    const rootCandidate = getSessionProjectRootCandidate(session)
    const status = getCachedGitDirectoryStatus(sessionDirectory)
    const linkedWorktree = isLinkedWorktreeRoot(status)
    const sessionMatchesProjectRoot = Boolean(rootCandidate && sessionDirectory === rootCandidate)
    const rootDirectory = linkedWorktree
      ? normalizeDirectory(status?.mainWorktreeRoot || rootCandidate || sessionDirectory)
      : sessionMatchesProjectRoot
        ? rootCandidate
        : ''
    const groupDirectory = rootDirectory || sessionDirectory
    const key = linkedWorktree
      ? getProjectIdentityKey(projectId, groupDirectory)
      : sessionMatchesProjectRoot
        ? getProjectIdentityKey(projectId, groupDirectory)
        : getProjectIdentityKey('', sessionDirectory)
    const useProjectMeta = linkedWorktree || sessionMatchesProjectRoot

    return {
      key,
      directory: groupDirectory,
      name: useProjectMeta ? session.project?.name || getDirectoryName(groupDirectory) : getDirectoryName(sessionDirectory),
      projectId: useProjectMeta ? projectId : '',
      icon: useProjectMeta ? session.project?.icon : undefined,
      isWorktree: linkedWorktree,
      rootDirectory: linkedWorktree ? groupDirectory : '',
      worktreeDirectory: linkedWorktree ? sessionDirectory : ''
    }
  }

  const projects = computed<ProjectRecord[]>(() => {
    const cutoff = Date.now() - RECENT_PROJECT_WINDOW
    const groups = new Map<string, ProjectRecord>()

    for (const project of projectCatalog.value) {
      groups.set(getProjectIdentityKey(project.projectId, project.directory), {
        projectId: project.projectId,
        directory: project.directory,
        name: project.name,
        icon: project.icon,
        lastUpdated: project.lastUpdated,
        sessionCount: 0,
        source: 'server'
      })
    }

    for (const session of sessions.value) {
      const grouping = getSessionProjectGrouping(session)
      if (!grouping) {
        continue
      }

      const existing = groups.get(grouping.key)
      const updated = session.time?.updated ?? session.time?.created ?? 0
      if (existing) {
        existing.projectId = existing.projectId || grouping.projectId
        existing.icon = existing.icon || grouping.icon
        existing.sessionCount += 1
        existing.lastUpdated = Math.max(existing.lastUpdated, updated)
        if (existing.source !== 'manual') {
          existing.source = 'session'
        }
      } else {
        groups.set(grouping.key, {
          projectId: grouping.projectId,
          directory: grouping.directory,
          name: grouping.name,
          icon: grouping.icon,
          lastUpdated: updated,
          sessionCount: 1,
          source: 'session'
        })
      }
    }

    const manualDirectory = normalizeDirectory(draftDirectory.value)
    const manualKey = getProjectIdentityKey('', manualDirectory)
    const hasSameDirectory = manualDirectory
      ? Array.from(groups.values()).some((project) => normalizeDirectory(project.directory) === manualDirectory)
      : false

    if (manualDirectory && !groups.has(manualKey) && !hasSameDirectory) {
      groups.set(manualKey, {
        directory: manualDirectory,
        name: getDirectoryName(manualDirectory),
        lastUpdated: Date.now(),
        sessionCount: 0,
        source: 'manual',
        manual: true
      })
    }

    return Array.from(groups.values())
      .filter((project) => project.manual || project.lastUpdated >= cutoff)
      .sort((left, right) => right.lastUpdated - left.lastUpdated)
  })

  const connectionStateLabel = computed(() => {
    if (isConnecting.value) {
      return '连接中'
    }

    return streamReady.value ? '已连接' : '未连接'
  })

  const chatOptionDirectory = computed(() => sessionDirectory.value || normalizeDirectory(draftDirectory.value))
  const canCreateSession = computed(() => Boolean(normalizeDirectory(draftDirectory.value)) && streamReady.value)

  function cacheWorktreeBranch(directory: string, branch: string) {
    const normalizedDirectory = normalizeDirectory(directory)
    if (!normalizedDirectory) {
      return
    }

    worktreeBranchState.value = {
      ...worktreeBranchState.value,
      [normalizedDirectory]: {
        branch: branch.trim(),
        loading: false,
        error: ''
      }
    }
  }

  async function ensureGitDirectoryStatus(directory?: string | null) {
    const normalizedDirectory = normalizeDirectory(directory)
    if (!normalizedDirectory) {
      return null
    }

    const cached = gitDirectoryState.value[normalizedDirectory]
    if (cached?.status) {
      return cached.status
    }

    const pending = gitDirectoryRequests.get(normalizedDirectory)
    if (pending) {
      return pending
    }

    gitDirectoryState.value = {
      ...gitDirectoryState.value,
      [normalizedDirectory]: {
        status: cached?.status ?? null,
        loading: true,
        error: ''
      }
    }

    const request = getGitDirectoryStatus(normalizedDirectory)
      .then((status) => {
        gitDirectoryState.value = {
          ...gitDirectoryState.value,
          [normalizedDirectory]: {
            status,
            loading: false,
            error: ''
          }
        }
        return status
      })
      .catch((error) => {
        gitDirectoryState.value = {
          ...gitDirectoryState.value,
          [normalizedDirectory]: {
            status: null,
            loading: false,
            error: parseError(error)
          }
        }
        throw error
      })
      .finally(() => {
        gitDirectoryRequests.delete(normalizedDirectory)
      })

    gitDirectoryRequests.set(normalizedDirectory, request)
    return request
  }

  async function preloadSessionGitStatuses(sessionList: SessionRecord[]) {
    const directories = Array.from(new Set(sessionList
      .map((session) => {
        const sessionDirectory = normalizeDirectory(session.directory)
        if (!sessionDirectory) {
          return ''
        }

        const rootCandidate = getSessionProjectRootCandidate(session)
        return sessionDirectory !== rootCandidate ? sessionDirectory : ''
      })
      .filter(Boolean)))

    if (!directories.length) {
      return
    }

    await Promise.allSettled(directories.map((directory) => ensureGitDirectoryStatus(directory)))
  }

  async function ensureWorktreeBranch(directory?: string | null) {
    const normalizedDirectory = normalizeDirectory(directory)
    if (!normalizedDirectory) {
      return ''
    }

    const cached = worktreeBranchState.value[normalizedDirectory]
    if (cached?.branch) {
      return cached.branch
    }

    const pending = worktreeBranchRequests.get(normalizedDirectory)
    if (pending) {
      return pending
    }

    worktreeBranchState.value = {
      ...worktreeBranchState.value,
      [normalizedDirectory]: {
        branch: cached?.branch || '',
        loading: true,
        error: ''
      }
    }

    const request = getClient(normalizedDirectory)
      .vcs.get({ directory: normalizedDirectory })
      .then(({ data }) => {
        const branch = data?.branch?.trim() || ''
        worktreeBranchState.value = {
          ...worktreeBranchState.value,
          [normalizedDirectory]: {
            branch,
            loading: false,
            error: branch ? '' : '当前 worktree 没有可用分支信息。'
          }
        }
        return branch
      })
      .catch((error) => {
        const message = parseError(error)
        worktreeBranchState.value = {
          ...worktreeBranchState.value,
          [normalizedDirectory]: {
            branch: '',
            loading: false,
            error: message
          }
        }
        throw error
      })
      .finally(() => {
        worktreeBranchRequests.delete(normalizedDirectory)
      })

    worktreeBranchRequests.set(normalizedDirectory, request)
    return request
  }

  function getSessionWorktreeInfo(sessionId: string): SessionWorktreeInfo | null {
    const session = sessions.value.find((item) => item.id === sessionId) ?? null
    const grouping = getSessionProjectGrouping(session)
    if (!grouping?.isWorktree) {
      return null
    }

    const worktreeDirectory = grouping.worktreeDirectory
    const rootDirectory = grouping.rootDirectory
    if (!session || !worktreeDirectory || !rootDirectory) {
      return null
    }

    const branchState = worktreeBranchState.value[worktreeDirectory]
    const rootBranchState = worktreeBranchState.value[rootDirectory]
    return {
      sessionId,
      projectName: session.project?.name || getDirectoryName(rootDirectory),
      rootDirectory,
      worktreeDirectory,
      rootBranch: rootBranchState?.branch || '',
      rootBranchLoading: rootBranchState?.loading ?? false,
      rootBranchError: rootBranchState?.error || '',
      branch: branchState?.branch || '',
      branchLoading: branchState?.loading ?? false,
      branchError: branchState?.error || ''
    }
  }

  function isWorktreeSession(session?: SessionRecord | null) {
    return Boolean(getSessionProjectGrouping(session)?.isWorktree)
  }

  async function ensureSessionWorktreeInfo(sessionId: string) {
    const session = sessions.value.find((item) => item.id === sessionId) ?? null
    if (!session) {
      return null
    }

    try {
      await ensureGitDirectoryStatus(session.directory)
    } catch {
      return null
    }

    const info = getSessionWorktreeInfo(sessionId)
    if (!info) {
      return null
    }

    if (!info.branch && !info.branchLoading) {
      try {
        await ensureWorktreeBranch(info.worktreeDirectory)
      } catch {
        return getSessionWorktreeInfo(sessionId)
      }
    }

    if (!info.rootBranch && !info.rootBranchLoading) {
      try {
        await ensureWorktreeBranch(info.rootDirectory)
      } catch {
        return getSessionWorktreeInfo(sessionId)
      }
    }

    return getSessionWorktreeInfo(sessionId)
  }

  const pwaManager = createPwaManager({
    activeSession,
    sessions
  })
  const sessionStateManager = createSessionStateManager({
    desktopSessions,
    sessionListUiState,
    sessionPreviewMessages,
    refreshSessions: (options) => refreshSessions(options)
  })

  const {
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
  } = pwaManager
  let disposePwa = () => {}
  const {
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
  } = sessionStateManager
  const sessionActions = createSessionActions({
    availableAgents,
    composerMode,
    composerText,
    desktopSessions,
    draftDirectory,
    hasMoreHistory,
    hasTruncatedMessages,
    historyMessageLimit,
    isLoadingOlderMessages,
    isLoadingSession,
    isSending,
    lastError,
    messages,
    mergeSessions,
    sessions,
    selectedAgent,
    selectedAgentId,
    selectedCommand,
    selectedCommandName,
    selectedModel,
    selectedModelKey,
    selectedVariant,
    selectedSessionId,
    singleDraftSession,
    sessionPreviewMessages,
    sessionStatus,
    armCompletionNotice,
    cacheWorktreeBranch,
    clearPendingCompletionNotice,
    ensureChatOptionsSnapshot,
    ensureDesktopSessionState,
    getClient,
    getCachedSessionState,
    handleRequestError,
    invalidateAuth,
    loadChatOptions,
    refreshSessions: (options) => refreshSessions(options),
    removeDesktopSessionState,
    setCachedSessionState,
    setDesktopSessionChatOptions,
    suppressNextChatOptionLoad,
    syncSessionPreviewFromMessages
  })
  const {
    closeDesktopSession,
    createDesktopSession,
    createDesktopWorktreeSession,
    createSession,
    createWorktreeSession,
    loadOlderDesktopMessages,
    loadOlderMessages,
    loadSessionPreview,
    openDesktopSession,
    openSession,
    preloadSessionPreviews,
    prepareDraftSession,
    rejectQuestion,
    replyPermission,
    replyQuestion,
    stopCurrentSession,
    stopDesktopSession,
    sendCurrentMessage,
    sendDesktopMessage,
    sendPromptToSession
  } = sessionActions

  function invalidateAuth() {
    authValidated.value = false
    streamReady.value = false
    clientCache.clear()
    mobileSessionCache.clear()
    mobileSessionCacheOrder.splice(0, mobileSessionCacheOrder.length)
    chatOptionsCache.clear()
    chatOptionsRequests.clear()
    globalCommandsCache = null
    globalCommandsRequest = null
    preloadHomeDataRequest = null
    suppressedChatOptionLoadKey = ''
    activeChatOptionsRequestId = 0
    worktreeBranchRequests.clear()
    worktreeBranchState.value = {}
    gitDirectoryRequests.clear()
    gitDirectoryState.value = {}
    availableAgents.value = []
    availableCommands.value = []
    availableModels.value = []
    defaultModelKey.value = ''
    desktopSessions.value = {}
    closeStream?.()
    closeStream = null
  }

  function handleRequestError(error: unknown) {
    lastError.value = parseError(error)

    if (isUnauthorizedError(error)) {
      void refreshAdminSession().then((session) => {
        if (!session?.authenticated) {
          adminAuthError.value = '管理登录已失效，请重新登录。'
          adminAuthenticated.value = false
          localRuntimeStatus.value = null
          setLocalBackendCsrfToken('')
          invalidateAuth()
          return
        }

        opencodeAuthRequested.value = true
        invalidateAuth()
      })
    }
  }

  function getRequestHeaders() {
    const authorization = buildAuthHeader(username.value, password.value)

    return authorization
      ? {
          Authorization: authorization
        }
      : undefined
  }

  function getChatOptionsCacheKey(directory?: string) {
    return normalizeDirectory(directory) || GLOBAL_CHAT_OPTIONS_KEY
  }

  function getDefaultVariant(variants: string[]) {
    if (!variants.length) {
      return ''
    }

    if (variants.includes('medium')) {
      return 'medium'
    }

    return variants[0] || ''
  }

  function resolveVariantForModel(modelKey: string, models: ChatModelRecord[], candidate?: string) {
    const model = models.find((item) => item.key === normalizeModelKey(modelKey)) ?? null
    const variants = model?.variants ?? []
    if (!variants.length) {
      return ''
    }

    return candidate && variants.includes(candidate) ? candidate : getDefaultVariant(variants)
  }

  function setAvailableChatOptions(
    snapshot: ChatOptionsSnapshot,
    options: { preferredAgentId?: string; preferredModelKey?: string; preferredVariant?: string } = {}
  ) {
    availableModels.value = snapshot.models
    availableAgents.value = snapshot.agents
    availableCommands.value = snapshot.commands
    defaultModelKey.value = snapshot.defaultModelKey

    if (!availableCommands.value.some((command) => command.name === selectedCommandName.value)) {
      selectedCommandName.value = ''
    }

    applyChatSelections(options)

    const agentVariant = availableAgents.value.find((agent) => agent.id === selectedAgentId.value)?.variant
    selectedVariant.value = resolveVariantForModel(
      selectedModelKey.value,
      availableModels.value,
      options.preferredVariant || selectedVariant.value || agentVariant
    )
  }

  function setDesktopSessionChatOptions(
    sessionState: DesktopSessionState,
    snapshot: ChatOptionsSnapshot,
    options: { preferredAgentId?: string; preferredModelKey?: string; preferredVariant?: string } = {}
  ) {
    sessionState.availableModels = snapshot.models
    sessionState.availableAgents = snapshot.agents
    sessionState.availableCommands = snapshot.commands

    if (!sessionState.availableCommands.some((command) => command.name === sessionState.selectedCommandName)) {
      sessionState.selectedCommandName = ''
    }

    const nextSelections = resolveChatSelections(snapshot, {
      currentAgentId: sessionState.selectedAgentId,
      currentModelKey: sessionState.selectedModelKey,
      preferredAgentId: options.preferredAgentId,
      preferredModelKey: options.preferredModelKey
    })

    sessionState.selectedAgentId = nextSelections.selectedAgentId
    sessionState.selectedModelKey = nextSelections.selectedModelKey

    const agentVariant = sessionState.availableAgents.find((agent) => agent.id === sessionState.selectedAgentId)?.variant
    sessionState.selectedVariant = resolveVariantForModel(
      sessionState.selectedModelKey,
      sessionState.availableModels,
      options.preferredVariant || sessionState.selectedVariant || agentVariant
    )
  }

  async function fetchChatOptionsSnapshot(directory?: string) {
    const normalizedDirectory = normalizeDirectory(directory)
    const currentClient = getClient(normalizedDirectory)
    const params = normalizedDirectory ? { directory: normalizedDirectory } : undefined
    const [{ data: providerData }, { data: agentData }, globalCommandData, { data: skillData }] = await Promise.all([
      currentClient.config.providers(params),
      currentClient.app.agents(params),
      ensureGlobalCommands(),
      currentClient.app.skills(params)
    ])

    return {
      models: buildModelCatalog((providerData ?? {}) as ConfigProvidersResponse),
      defaultModelKey: resolveDefaultModelKey((providerData ?? {}) as ConfigProvidersResponse),
      agents: buildAgentCatalog((agentData ?? []) as AgentInfo[]),
      commands: buildCommandCatalog(
        [],
        globalCommandData,
        (skillData ?? []) as SkillInfo[]
      )
    } satisfies ChatOptionsSnapshot
  }

  async function ensureGlobalCommands() {
    if (globalCommandsCache) {
      return globalCommandsCache
    }

    if (globalCommandsRequest) {
      return globalCommandsRequest
    }

    globalCommandsRequest = getClient()
      .command.list()
      .then(({ data }) => {
        globalCommandsCache = (data ?? []) as OpencodeCommand[]
        return globalCommandsCache
      })
      .finally(() => {
        globalCommandsRequest = null
      })

    return globalCommandsRequest
  }

  async function ensureChatOptionsSnapshot(directory?: string) {
    const cacheKey = getChatOptionsCacheKey(directory)
    const cached = chatOptionsCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const pendingRequest = chatOptionsRequests.get(cacheKey)
    if (pendingRequest) {
      return pendingRequest
    }

    const request = fetchChatOptionsSnapshot(directory)
      .then((snapshot) => {
        chatOptionsCache.set(cacheKey, snapshot)
        return snapshot
      })
      .finally(() => {
        chatOptionsRequests.delete(cacheKey)
      })

    chatOptionsRequests.set(cacheKey, request)
    return request
  }

  function preloadChatOptions(directories: string[]) {
    const uniqueDirectories = Array.from(new Set(directories.map((directory) => normalizeDirectory(directory)).filter(Boolean)))
      .slice(0, CHAT_OPTIONS_PRELOAD_SESSION_LIMIT)

    void Promise.allSettled([
      ensureChatOptionsSnapshot(),
      ...uniqueDirectories.map((directory) => ensureChatOptionsSnapshot(directory))
    ])
  }

  async function preloadHomeData() {
    if (!authValidated.value) {
      return
    }

    if (preloadHomeDataRequest) {
      return preloadHomeDataRequest
    }

    const directories = [
      sessionDirectory.value,
      draftDirectory.value,
      ...sessions.value.slice(0, CHAT_OPTIONS_PRELOAD_SESSION_LIMIT).map((session) => session.directory ?? '')
    ]

    preloadHomeDataRequest = Promise.allSettled([
      ensureChatOptionsSnapshot(),
      ...Array.from(new Set(directories.map((directory) => normalizeDirectory(directory)).filter(Boolean)))
        .slice(0, CHAT_OPTIONS_PRELOAD_SESSION_LIMIT)
        .map((directory) => ensureChatOptionsSnapshot(directory))
    ]).then(() => undefined).finally(() => {
      preloadHomeDataRequest = null
    })

    return preloadHomeDataRequest
  }

  function applyChatSelections(options: { preferredAgentId?: string; preferredModelKey?: string } = {}) {
    const nextSelections = resolveChatSelections(
      {
        agents: availableAgents.value,
        commands: availableCommands.value,
        models: availableModels.value,
        defaultModelKey: defaultModelKey.value
      },
      {
        currentAgentId: selectedAgentId.value,
        currentModelKey: selectedModelKey.value,
        preferredAgentId: options.preferredAgentId,
        preferredModelKey: options.preferredModelKey
      }
    )

    selectedAgentId.value = nextSelections.selectedAgentId
    selectedModelKey.value = nextSelections.selectedModelKey
  }

  function rememberChatSelections(agentId: string, modelKey: string, variant: string) {
    selectedAgentId.value = agentId
    selectedModelKey.value = normalizeModelKey(modelKey)
    selectedVariant.value = variant.trim()
  }

  async function loadChatOptions(options: {
    directory?: string
    preferredAgentId?: string
    preferredModelKey?: string
    preferredVariant?: string
  } = {}) {
    const directory = normalizeDirectory(options.directory ?? chatOptionDirectory.value)
    const requestId = ++activeChatOptionsRequestId
    const snapshot = await ensureChatOptionsSnapshot(directory)

    if (requestId !== activeChatOptionsRequestId) {
      return
    }

    setAvailableChatOptions(snapshot, options)
  }

  function selectModel(modelKey: string) {
    selectedModelKey.value = normalizeModelKey(modelKey)
    selectedVariant.value = resolveVariantForModel(selectedModelKey.value, availableModels.value, selectedVariant.value)
    rememberChatSelections(selectedAgentId.value, selectedModelKey.value, selectedVariant.value)
  }

  function selectAgent(agentId: string) {
    selectedAgentId.value = agentId
    const agentVariant = availableAgents.value.find((agent) => agent.id === agentId)?.variant

    const agentModel = availableAgents.value.find((agent) => agent.id === agentId)?.model
    if (!agentModel) {
      selectedVariant.value = resolveVariantForModel(selectedModelKey.value, availableModels.value, agentVariant || selectedVariant.value)
      rememberChatSelections(selectedAgentId.value, selectedModelKey.value, selectedVariant.value)
      return
    }

    const nextModelKey = makeModelKey(agentModel.providerId, agentModel.modelId)
    if (availableModels.value.some((model) => model.key === nextModelKey)) {
      selectedModelKey.value = nextModelKey
    }

    selectedVariant.value = resolveVariantForModel(selectedModelKey.value, availableModels.value, agentVariant || selectedVariant.value)
    rememberChatSelections(selectedAgentId.value, selectedModelKey.value, selectedVariant.value)
  }

  function selectDesktopModel(sessionId: string, modelKey: string) {
    const sessionState = ensureDesktopSessionState(sessionId)
    sessionState.selectedModelKey = normalizeModelKey(modelKey)
    sessionState.selectedVariant = resolveVariantForModel(
      sessionState.selectedModelKey,
      sessionState.availableModels,
      sessionState.selectedVariant
    )
    rememberChatSelections(sessionState.selectedAgentId, sessionState.selectedModelKey, sessionState.selectedVariant)
  }

  function selectDesktopAgent(sessionId: string, agentId: string) {
    const sessionState = ensureDesktopSessionState(sessionId)
    sessionState.selectedAgentId = agentId
    const agentVariant = sessionState.availableAgents.find((agent) => agent.id === agentId)?.variant

    const agentModel = sessionState.availableAgents.find((agent) => agent.id === agentId)?.model
    if (!agentModel) {
      sessionState.selectedVariant = resolveVariantForModel(
        sessionState.selectedModelKey,
        sessionState.availableModels,
        agentVariant || sessionState.selectedVariant
      )
      rememberChatSelections(sessionState.selectedAgentId, sessionState.selectedModelKey, sessionState.selectedVariant)
      return
    }

    const nextModelKey = makeModelKey(agentModel.providerId, agentModel.modelId)
    if (sessionState.availableModels.some((model) => model.key === nextModelKey)) {
      sessionState.selectedModelKey = nextModelKey
    }

    sessionState.selectedVariant = resolveVariantForModel(
      sessionState.selectedModelKey,
      sessionState.availableModels,
      agentVariant || sessionState.selectedVariant
    )
    rememberChatSelections(sessionState.selectedAgentId, sessionState.selectedModelKey, sessionState.selectedVariant)
  }

  function selectVariant(variant: string) {
    selectedVariant.value = resolveVariantForModel(selectedModelKey.value, availableModels.value, variant.trim())
    rememberChatSelections(selectedAgentId.value, selectedModelKey.value, selectedVariant.value)
  }

  function selectDesktopVariant(sessionId: string, variant: string) {
    const sessionState = ensureDesktopSessionState(sessionId)
    sessionState.selectedVariant = resolveVariantForModel(
      sessionState.selectedModelKey,
      sessionState.availableModels,
      variant.trim()
    )
    rememberChatSelections(sessionState.selectedAgentId, sessionState.selectedModelKey, sessionState.selectedVariant)
  }

  function selectDesktopCommand(sessionId: string, commandName: string) {
    const sessionState = ensureDesktopSessionState(sessionId)
    const nextCommandName = commandName.trim()

    sessionState.selectedCommandName = sessionState.availableCommands.some((command) => command.name === nextCommandName)
      ? nextCommandName
      : ''
  }

  function selectCommand(commandName: string) {
    const nextCommandName = commandName.trim()
    const nextCommand = availableCommands.value.find((command) => command.name === nextCommandName) ?? null

    selectedCommandName.value = nextCommandName
    if (!nextCommand) {
      composerMode.value = 'prompt'
      return
    }

    if (nextCommand.category === 'skill') {
      composerText.value = `务必使用skill：${nextCommand.name}。`
      selectedCommandName.value = ''
      composerMode.value = 'prompt'
      return
    }

    composerText.value = ''
    composerMode.value = 'command'
    void sendCurrentMessage()
  }

  function getSessionUpdatedAt(session: Pick<SessionRecord, 'time'>) {
    return session.time?.updated ?? session.time?.created ?? 0
  }

  function sortSessionsByUpdated<T extends SessionRecord>(items: T[]) {
    return [...items].sort((left, right) => getSessionUpdatedAt(right) - getSessionUpdatedAt(left))
  }

  function syncSessionCollections(nextSessions: SessionRecord[]) {
    sessions.value = nextSessions
    syncSessionListUiState(nextSessions.map((session) => session.id))
    syncSessionPreviewCache(nextSessions.map((session) => session.id))
    syncCachedSessionStates(nextSessions.map((session) => session.id))
    syncDesktopSessionStates(nextSessions.map((session) => session.id))
  }

  function mergeSessions(nextSessions: SessionRecord[]) {
    if (!nextSessions.length) {
      return sessions.value
    }

    const merged = new Map(sessions.value.map((session) => [session.id, session] as const))
    for (const session of nextSessions) {
      merged.set(session.id, session)
    }

    const ordered = sortSessionsByUpdated(Array.from(merged.values()))
    syncSessionCollections(ordered)
    return ordered
  }

  async function fetchExperimentalSessions(options: { directory?: string; cursor?: number; limit: number }) {
    const baseUrl = resolveServerBaseUrl(serverUrl.value)
    const url = new URL('experimental/session', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    url.searchParams.set('roots', 'true')
    url.searchParams.set('limit', String(options.limit))

    const directory = normalizeDirectory(options.directory)
    if (directory) {
      url.searchParams.set('directory', directory)
    }

    if (options.cursor && Number.isFinite(options.cursor)) {
      url.searchParams.set('cursor', String(options.cursor))
    }

    const response = await fetch(url.toString(), {
      headers: getRequestHeaders()
    })

    if (!response.ok) {
      throw new Error(`拉取会话列表失败：${response.status} ${response.statusText}`)
    }

    return ((await response.json()) as GlobalSession[]).map((session) => mapGlobalSession(session))
  }

  async function listGlobalSessions() {
    const sessions = await fetchExperimentalSessions({ limit: SESSION_LIST_LIMIT })
    return sortSessionsByUpdated(sessions.filter((session) => !session.parentID))
  }

  async function loadMoreProjectSessions(directory: string) {
    const normalizedDirectory = normalizeDirectory(directory)
    if (!normalizedDirectory) {
      return []
    }

    const loadedProjectSessions = sessions.value.filter((session) => normalizeDirectory(session.directory) === normalizedDirectory)
    const oldestLoadedAt = loadedProjectSessions.reduce<number>(
      (oldest, session) => {
        const updatedAt = getSessionUpdatedAt(session)
        if (!updatedAt) {
          return oldest
        }

        return oldest ? Math.min(oldest, updatedAt) : updatedAt
      },
      0
    )

    lastError.value = ''

    try {
      const nextSessions = (await fetchExperimentalSessions({
        directory: normalizedDirectory,
        cursor: oldestLoadedAt || undefined,
        limit: PROJECT_SESSION_PAGE_SIZE
      })).filter((session) => !session.parentID)

      await preloadSessionGitStatuses(nextSessions)
      mergeSessions(nextSessions)
      preloadChatOptions([normalizedDirectory, ...nextSessions.slice(0, CHAT_OPTIONS_PRELOAD_SESSION_LIMIT).map((session) => session.directory ?? '')])
      return nextSessions
    } catch (error) {
      handleRequestError(error)
      throw error
    }
  }

  function getClient(directory?: string) {
    const normalizedDirectory = normalizeDirectory(directory)
    const cacheKey = normalizedDirectory || '__global__'
    const cachedClient = clientCache.get(cacheKey)
    if (cachedClient) {
      return cachedClient
    }

    const nextClient = createOpencodeClient({
      baseUrl: serverUrl.value,
      headers: getRequestHeaders(),
      directory: normalizedDirectory || undefined
    })

    clientCache.set(cacheKey, nextClient)
    return nextClient
  }

  async function startEventStream() {
    closeStream?.()
    closeStream = null

    const currentClient = getClient()
    const events = await currentClient.global.event()
    const maybeClose = (events as { close?: () => void }).close

    console.log('[opencode:sse] subscribed to global stream')

    closeStream = () => {
      console.log('[opencode:sse] closing stream')
      if (typeof maybeClose === 'function') {
        maybeClose.call(events)
      }
      streamReady.value = false
    }

    streamReady.value = true

    void (async () => {
      try {
        for await (const event of events.stream) {
          const typedGlobalEvent = event as OpencodeGlobalEvent
          const typedEvent = typedGlobalEvent.payload
          console.log('[opencode:sse] event', {
            directory: typedGlobalEvent.directory,
            type: typedEvent.type,
            sessionId: getEventSessionId(typedEvent),
            properties: typedEvent.properties
          })
          handleEvent(typedEvent, typedGlobalEvent.directory)
        }
      } catch (error) {
        console.error('[opencode:sse] stream error', error)
        handleRequestError(error)
        streamReady.value = false
      }
    })()
  }

  async function refreshSessions(options: { reopen?: boolean; refreshProjects?: boolean } = {}) {
    isRefreshing.value = true
    try {
      const currentClient = getClient()
      const [globalSessions, projectResult] = await Promise.all([
        listGlobalSessions(),
        options.refreshProjects ? currentClient.project.list() : Promise.resolve({ data: null })
      ])
      const nextSessions = globalSessions
        .filter((session) => !session.parentID)
        .sort((left, right) => getSessionUpdatedAt(right) - getSessionUpdatedAt(left))

      if (projectResult.data) {
        projectCatalog.value = ((projectResult.data ?? []) as Project[])
          .map((project) => mapProjectCatalogEntry(project))
          .filter((project) => Boolean(project.directory))
      }

      await preloadSessionGitStatuses(nextSessions)
      syncSessionCollections(nextSessions)

      const currentSessionExists = nextSessions.some((session) => session.id === selectedSessionId.value)
      if (!currentSessionExists) {
        selectedSessionId.value = ''
      }

      if (!selectedSessionId.value && !singleDraftSession.value) {
        selectedSessionId.value = nextSessions[0]?.id || nextSessions.find((session) => session.directory)?.id || ''
      }

      if (options.reopen !== false && selectedSessionId.value) {
        await openSession(selectedSessionId.value)
      }

      preloadChatOptions([
        draftDirectory.value,
        ...nextSessions.slice(0, CHAT_OPTIONS_PRELOAD_SESSION_LIMIT).map((session) => session.directory ?? '')
      ])
    } finally {
      isRefreshing.value = false
    }
  }

  async function updateProject(projectId: string, input: { name?: string; icon?: ProjectIconRecord }) {
    const normalizedProjectId = projectId.trim()
    if (!normalizedProjectId) {
      throw new Error('缺少项目 ID，无法更新项目配置。')
    }

    const currentClient = getClient()
    const { data } = await currentClient.project.update({
      projectID: normalizedProjectId,
      name: input.name,
      icon: input.icon
        ? {
            url: input.icon.url,
            override: input.icon.override,
            color: input.icon.color
          }
        : undefined
    })

    if (data) {
      const nextProject = mapProjectCatalogEntry(data as Project)
      projectCatalog.value = [
        nextProject,
        ...projectCatalog.value.filter((project) => project.projectId !== nextProject.projectId)
      ]
    }

    return data as Project | undefined
  }

  async function archiveSession(sessionId: string, directory?: string | null) {
    const normalizedSessionId = sessionId.trim()
    const normalizedDirectory = normalizeDirectory(directory)
    if (!normalizedSessionId) {
      throw new Error('缺少会话 ID，无法归档对话。')
    }

    await getClient(normalizedDirectory).session.update({
      sessionID: normalizedSessionId,
      directory: normalizedDirectory || undefined,
      time: {
        archived: Date.now()
      }
    })
  }

  async function refreshAdminSession() {
    try {
      const session = await getAdminSessionStatus()
      adminSessionReady.value = true
      adminAuthenticated.value = session.authenticated
      adminSessionExpiresAt.value = session.expiresAt || ''
      if (!session.authenticated) {
        localRuntimeStatus.value = null
        return session
      }

      adminAuthError.value = ''
      return session
    } catch (error) {
      adminSessionReady.value = true
      adminAuthenticated.value = false
      adminSessionExpiresAt.value = ''
      adminAuthError.value = parseError(error)
      localRuntimeStatus.value = null
      setLocalBackendCsrfToken('')
      return null
    }
  }

  async function loginAdmin() {
    if (!adminPassword.value.trim() || isAdminAuthenticating.value) {
      return false
    }

    isAdminAuthenticating.value = true
    adminAuthError.value = ''

    try {
      const session = await loginAdminSession(adminPassword.value.trim())
      adminAuthenticated.value = true
      adminSessionReady.value = true
      adminSessionExpiresAt.value = session.expiresAt
      adminPassword.value = ''
      await refreshLocalRuntime()
      await connect()
      return true
    } catch (error) {
      adminAuthenticated.value = false
      adminAuthError.value = parseError(error)
      return false
    } finally {
      isAdminAuthenticating.value = false
    }
  }

  async function logoutAdmin() {
    try {
      await logoutAdminSession()
    } catch {
      // 即使后端会话已失效，也要在本地清空状态。
    }

    adminAuthenticated.value = false
    adminSessionReady.value = true
    adminSessionExpiresAt.value = ''
    adminAuthError.value = ''
    adminPassword.value = ''
    localRuntimeStatus.value = null
    setLocalBackendCsrfToken('')
    opencodeAuthRequested.value = false
    invalidateAuth()
  }

  async function bootstrap() {
    const session = await refreshAdminSession()
    if (!session?.authenticated) {
      return false
    }

    await refreshLocalRuntime()
    await connect()
    return true
  }

  async function connect() {
    if (!adminAuthenticated.value) {
      adminAuthError.value = '请先完成管理端登录。'
      return false
    }

    if (isConnecting.value) {
      return false
    }

    isConnecting.value = true
    lastError.value = ''
    clientCache.clear()

    try {
      const currentClient = getClient()
      await currentClient.global.health()
      await startEventStream()
      authValidated.value = true
      opencodeAuthRequested.value = false
      void refreshLocalRuntime()

      void Promise.allSettled([
        loadChatOptions(),
        refreshSessions({ reopen: false, refreshProjects: true })
      ]).then((results) => {
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        )

        if (rejected) {
          handleRequestError(rejected.reason)
        }
      })

      return true
    } catch (error) {
      if (isUnauthorizedError(error)) {
        opencodeAuthRequested.value = true
      }
      handleRequestError(error)
      streamReady.value = false
      return false
    } finally {
      isConnecting.value = false
    }
  }

  async function refreshLocalRuntime() {
    try {
      localRuntimeStatus.value = await getLocalRuntimeStatus()
      return localRuntimeStatus.value
    } catch {
      localRuntimeStatus.value = null
      return null
    }
  }

  async function restartLocalOpencode() {
    if (isRestartingOpencode.value) {
      return false
    }

    isRestartingOpencode.value = true
    streamReady.value = false
    authValidated.value = false
    clientCache.clear()
    closeStream?.()
    closeStream = null

    try {
      await restartManagedOpencode()
      await refreshLocalRuntime()

      const connected = await connect()
      if (!connected) {
        throw new Error(lastError.value || '本地 OpenCode 已重启，但重新连接失败。')
      }

      return true
    } catch (error) {
      lastError.value = parseError(error)
      return false
    } finally {
      isRestartingOpencode.value = false
    }
  }

  function updateMessageCollection(currentMessages: ChatMessageRecord[], event: OpencodeEvent) {
    return applyEventToMessageCollection(currentMessages, event)
  }

  function updateCachedSessionMessages(sessionId: string, nextMessages: ChatMessageRecord[]) {
    const cached = mobileSessionCache.get(sessionId)
    if (!cached) {
      return
    }

    cached.messages = nextMessages
    setCachedSessionState(sessionId, cached)
  }

  function updateCachedSessionStatus(sessionId: string, nextStatus: 'idle' | 'busy') {
    const cached = mobileSessionCache.get(sessionId)
    if (!cached) {
      return
    }

    cached.sessionStatus = nextStatus
    setCachedSessionState(sessionId, cached)
  }

  function syncSelectedSessionPreview() {
    if (!selectedSessionId.value) {
      return
    }

    syncSessionPreviewFromMessages(selectedSessionId.value, messages.value)
    updateCachedSessionMessages(selectedSessionId.value, messages.value)
  }


  function handleEvent(event: OpencodeEvent, eventDirectory?: string) {
    const eventSessionId = getEventSessionId(event)

    if (event.type === 'session.created') {
      scheduleSessionListRefresh({ newSessionId: eventSessionId })
    }

    if (event.type === 'session.idle') {
      markSessionListFlag(eventSessionId, 'justCompleted')
      void maybeNotifySessionCompletion(eventSessionId)
    }

    if (event.type === 'project.updated') {
      const project = event.properties as Project
      const nextProject = mapProjectCatalogEntry(project)
      projectCatalog.value = [
        nextProject,
        ...projectCatalog.value.filter((item) => item.projectId !== nextProject.projectId)
      ]
    }

    if (event.type === 'vcs.branch.updated' && eventDirectory) {
      cacheWorktreeBranch(eventDirectory, (event.properties as { branch?: string }).branch || '')
    }

    if (event.type === 'session.error') {
      clearPendingCompletionNotice(eventSessionId)
    }

    if (eventSessionId) {
      const desktopSessionState = desktopSessions.value[eventSessionId]
      const cachedSessionState = mobileSessionCache.get(eventSessionId)

      if (selectedSessionId.value === eventSessionId) {
        const nextMessages = updateMessageCollection(messages.value, event)
        if (nextMessages !== messages.value) {
          messages.value = nextMessages
        }
        syncSelectedSessionPreview()
      }

      if (desktopSessionState) {
        const nextMessages = updateMessageCollection(desktopSessionState.messages, event)
        if (nextMessages !== desktopSessionState.messages) {
          desktopSessionState.messages = nextMessages
        }
        syncSessionPreviewFromMessages(eventSessionId, desktopSessionState.messages)
      } else if (cachedSessionState) {
        const nextMessages = updateMessageCollection(cachedSessionState.messages, event)
        if (nextMessages !== cachedSessionState.messages) {
          cachedSessionState.messages = nextMessages
        }
        setCachedSessionState(eventSessionId, cachedSessionState)
        syncSessionPreviewFromMessages(eventSessionId, cachedSessionState.messages)
      } else if (selectedSessionId.value !== eventSessionId && sessionPreviewMessages.value[eventSessionId]) {
        const nextPreviewMessages = updateMessageCollection(sessionPreviewMessages.value[eventSessionId], event)
        if (nextPreviewMessages !== sessionPreviewMessages.value[eventSessionId]) {
          sessionPreviewMessages.value[eventSessionId] = nextPreviewMessages
        }
      }

      if (desktopSessionState) {
        switch (event.type) {
          case 'session.status': {
            const { status } = event.properties as { status: { type: 'idle' | 'busy' | 'retry' } }
            desktopSessionState.sessionStatus = status.type === 'busy' ? 'busy' : 'idle'
            break
          }
          case 'session.idle': {
            desktopSessionState.messages = pruneEmptyAssistantMessages(desktopSessionState.messages)
            desktopSessionState.sessionStatus = 'idle'
            desktopSessionState.isSending = false
            syncSessionPreviewFromMessages(eventSessionId, desktopSessionState.messages)
            break
          }
          case 'session.error': {
            desktopSessionState.messages = pruneEmptyAssistantMessages(desktopSessionState.messages)
            desktopSessionState.lastError = JSON.stringify(event.properties)
            desktopSessionState.sessionStatus = 'idle'
            desktopSessionState.isSending = false
            syncSessionPreviewFromMessages(eventSessionId, desktopSessionState.messages)
            break
          }
        }
      }

      if (cachedSessionState) {
        switch (event.type) {
          case 'session.status': {
            const { status } = event.properties as { status: { type: 'idle' | 'busy' | 'retry' } }
            updateCachedSessionStatus(eventSessionId, status.type === 'busy' ? 'busy' : 'idle')
            break
          }
          case 'session.idle':
          case 'session.error': {
            updateCachedSessionStatus(eventSessionId, 'idle')
            break
          }
        }
      }
    }

    if (!selectedSessionId.value || eventSessionId !== selectedSessionId.value) {
      return
    }

    switch (event.type) {
      case 'session.status': {
        const { status } = event.properties as { status: { type: 'idle' | 'busy' | 'retry' } }
        sessionStatus.value = status.type === 'busy' ? 'busy' : 'idle'
        updateCachedSessionStatus(eventSessionId, sessionStatus.value)
        break
      }
      case 'session.idle': {
        messages.value = pruneEmptyAssistantMessages(messages.value)
        sessionStatus.value = 'idle'
        isSending.value = false
        syncSelectedSessionPreview()
        break
      }
      case 'session.error': {
        messages.value = pruneEmptyAssistantMessages(messages.value)
        clearPendingCompletionNotice(eventSessionId)
        lastError.value = JSON.stringify(event.properties)
        sessionStatus.value = 'idle'
        isSending.value = false
        syncSelectedSessionPreview()
        break
      }
    }
  }

  watch(serverUrl, (value) => writeStorage(STORAGE_KEYS.serverUrl, value))
  watch([username, password], ([nextUsername, nextPassword], [prevUsername, prevPassword]) => {
    if (nextUsername === prevUsername && nextPassword === prevPassword) {
      return
    }

    opencodeAuthRequested.value = true
    invalidateAuth()
    lastError.value = ''
    writeStorage(STORAGE_KEYS.username, nextUsername)
    writeSessionStorage(STORAGE_KEYS.password, nextPassword)
  })
  watch(selectedSessionId, (value) => writeStorage(STORAGE_KEYS.selectedSession, value))
  watch(draftDirectory, (value) => writeStorage(STORAGE_KEYS.draftDirectory, value))
  watch(composerMode, (value) => writeStorage(STORAGE_KEYS.composerMode, value))
  watch(selectedAgentId, (value) => writeStorage(STORAGE_KEYS.selectedAgent, value))
  watch(selectedModelKey, (value) => writeStorage(STORAGE_KEYS.selectedModel, value))
  watch(selectedVariant, (value) => writeStorage(STORAGE_KEYS.selectedVariant, value))
  watch(chatOptionDirectory, (directory, previousDirectory) => {
    const cacheKey = getChatOptionsCacheKey(directory)
    if (!authValidated.value || directory === previousDirectory) {
      return
    }

    if (suppressedChatOptionLoadKey === cacheKey) {
      suppressedChatOptionLoadKey = ''
      return
    }

    void loadChatOptions({ directory })
  })

  onMounted(() => {
    disposePwa = mountPwa()
    void bootstrap()
  })

  onBeforeUnmount(() => {
    disposePwa()
    disposeSessionStateManager()

    closeStream?.()
  })

  return {
    serverUrl,
    adminPassword,
    username,
    password,
    adminAuthenticated,
    adminSessionReady,
    adminSessionExpiresAt,
    isAdminAuthenticating,
    hasAuthCredentials,
    notificationSupported,
    notificationPermission,
    notificationsEnabled,
    isRequestingNotificationPermission,
    installAvailable,
    isPwaInstalled,
    authGateVisible,
    authGateMode,
    authGateMessage,
    adminAuthError,
    selectedSessionId,
    draftDirectory,
    composerMode,
    selectedAgentId,
    selectedModelKey,
    selectedVariant,
    composerText,
    selectedCommandName,
    availableAgents,
    availableCommands,
    availableModels,
    projects,
    sessions,
    messages,
    sessionPreviewMessages,
    desktopSessions,
    visibleMessages,
    activeSession,
    selectedAgent,
    selectedCommand,
    selectedModel,
    isConnecting,
    isLoadingSession,
    isRefreshing,
    isLoadingOlderMessages,
    isRestartingOpencode,
    isSending,
    sessionStatus,
    lastError,
    streamReady,
    authValidated,
    localRuntimeStatus,
    connectionStateLabel,
    canCreateSession,
    ensureSessionWorktreeInfo,
    getSessionProjectGrouping,
    getSessionWorktreeInfo,
    isWorktreeSession,
    historyMessageLimit,
    hiddenMessageCount,
    hasMoreHistory,
    hasTruncatedMessages,
    getSessionListBadges,
    clearSessionListBadges,
    archiveSession,
    loginAdmin,
    logoutAdmin,
    bootstrap,
    connect,
    restartLocalOpencode,
    refreshAdminSession,
    refreshLocalRuntime,
    refreshSessions,
    loadMoreProjectSessions,
    openSession,
    openDesktopSession,
    createSession,
    prepareDraftSession,
    createWorktreeSession,
    createDesktopSession,
    createDesktopWorktreeSession,
    closeDesktopSession,
    stopCurrentSession,
    stopDesktopSession,
    sendPromptToSession,
    sendDesktopMessage,
    loadSessionPreview,
    preloadSessionPreviews,
    loadOlderMessages,
    loadOlderDesktopMessages,
    requestNotificationPermission,
    promptInstall,
    preloadHomeData,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    selectAgent,
    selectCommand,
    selectModel,
    selectDesktopAgent,
    selectDesktopCommand,
    selectDesktopModel,
    selectDesktopVariant,
    selectVariant,
    updateProject,
    sendCurrentMessage
  }
}
