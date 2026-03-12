import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  createOpencodeClient,
  type Event as OpencodeEvent,
  type Message,
  type Part,
  type Project
} from '@opencode-ai/sdk/v2/client'

import {
  readSessionStorage,
  readStorage,
  writeSessionStorage,
  writeStorage
} from '@/lib/storage'
import {
  type BeforeInstallPromptEvent,
  getNotificationPermission,
  isNotificationSupported,
  isStandaloneDisplay,
  trimNotificationBody
} from '@/lib/pwa'
import type {
  ChatAgentRecord,
  ChatMessageRecord,
  ChatModelRecord,
  ComposerMode,
  ProjectRecord,
  SessionRecord
} from '@/types/opencode'

const STORAGE_KEYS = {
  serverUrl: 'opencode-mobile-web-chat.server-url',
  username: 'opencode-mobile-web-chat.username',
  password: 'opencode-mobile-web-chat.password',
  selectedSession: 'opencode-mobile-web-chat.selected-session',
  draftDirectory: 'opencode-mobile-web-chat.draft-directory',
  composerMode: 'opencode-mobile-web-chat.composer-mode',
  selectedAgent: 'opencode-mobile-web-chat.selected-agent',
  selectedModel: 'opencode-mobile-web-chat.selected-model'
}

const RECENT_PROJECT_WINDOW = 14 * 24 * 60 * 60 * 1000
const SESSION_LIST_LIMIT = 20
const INITIAL_HISTORY_LIMIT = 120
const HISTORY_LIMIT_STEP = 120
const SESSION_LIST_REFRESH_DELAY = 240

type PendingCompletionNotice = {
  sessionId: string
  prompt: string
}

type SessionListFlag = 'isNew' | 'justCompleted'
type SessionListUiState = Partial<Record<SessionListFlag, boolean>>

type OpencodeClient = ReturnType<typeof createOpencodeClient>
type MessageHistoryItem = { info: Message; parts: Part[] }
type ProviderModelInfo = {
  id: string
  name?: string
  status?: string
}
type ProviderInfo = {
  id: string
  name?: string
  models?: Record<string, ProviderModelInfo>
}
type ProviderListResponse = {
  all?: ProviderInfo[]
  connected?: string[]
}
type AgentInfo = {
  name: string
  description?: string
  mode?: 'primary' | 'subagent' | 'all'
  hidden?: boolean
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
}

function normalizeDirectory(input?: string | null) {
  if (!input) {
    return ''
  }

  return input.replace(/\\/g, '/').replace(/\/+$/, '')
}

function getDirectoryName(directory: string) {
  const normalized = normalizeDirectory(directory)
  if (!normalized) {
    return '未命名项目'
  }

  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function makeModelKey(providerId: string, modelId: string) {
  return `${providerId}/${modelId}`
}

function normalizeModelKey(input?: string | null) {
  if (!input) {
    return ''
  }

  const trimmed = input.trim()
  if (!trimmed) {
    return ''
  }

  const splitIndex = trimmed.indexOf('/')
  if (splitIndex <= 0 || splitIndex === trimmed.length - 1) {
    return ''
  }

  return makeModelKey(trimmed.slice(0, splitIndex), trimmed.slice(splitIndex + 1))
}

function buildModelCatalog(response?: ProviderListResponse) {
  const connectedProviders = new Set(response?.connected ?? [])

  return (response?.all ?? [])
    .flatMap((provider) => {
      return Object.values(provider.models ?? {})
        .filter((model) => model.status !== 'deprecated')
        .map<ChatModelRecord>((model) => ({
          key: makeModelKey(provider.id, model.id),
          providerId: provider.id,
          providerName: provider.name || provider.id,
          modelId: model.id,
          label: model.name || model.id,
          status: model.status
        }))
    })
    .sort((left, right) => {
      const leftConnected = connectedProviders.has(left.providerId) ? 0 : 1
      const rightConnected = connectedProviders.has(right.providerId) ? 0 : 1
      if (leftConnected !== rightConnected) {
        return leftConnected - rightConnected
      }

      const providerCompare = left.providerName.localeCompare(right.providerName)
      if (providerCompare !== 0) {
        return providerCompare
      }

      return left.modelId.localeCompare(right.modelId)
    })
}

function buildAgentCatalog(input?: AgentInfo[]) {
  return (input ?? [])
    .filter((agent) => !agent.hidden)
    .map<ChatAgentRecord>((agent) => ({
      id: agent.name,
      description: agent.description || '',
      mode: agent.mode,
      hidden: agent.hidden,
      model: agent.model
        ? {
            providerId: agent.model.providerID,
            modelId: agent.model.modelID
          }
        : undefined,
      variant: agent.variant
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function getHistorySelection(history: MessageHistoryItem[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const info = history[index]?.info as Message & {
      agent?: string
      model?: {
        providerID?: string
        modelID?: string
      }
    }

    if (info.role !== 'user') {
      continue
    }

    return {
      agentId: info.agent || '',
      modelKey:
        info.model?.providerID && info.model?.modelID
          ? makeModelKey(info.model.providerID, info.model.modelID)
          : ''
    }
  }

  return {
    agentId: '',
    modelKey: ''
  }
}

function ensureTextMessage(messages: ChatMessageRecord[], info: Partial<Message> & { id: string; role?: string }) {
  let current = messages.find((item) => item.id === info.id)
  if (!current) {
    current = {
      id: info.id,
      role: info.role === 'user' ? 'user' : 'assistant',
      content: '',
      updatedAt: Date.now()
    }
    messages.push(current)
  }

  return current
}

function extractTextContent(parts: Part[]) {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as Part & { text?: string }).text ?? '')
    .join('')
}

function pruneEmptyAssistantMessages(messages: ChatMessageRecord[]) {
  return messages.filter((message) => message.role === 'user' || message.content.trim())
}

function convertHistoryMessage(item: MessageHistoryItem): ChatMessageRecord {
  const content = extractTextContent(item.parts)

  return {
    id: item.info.id,
    role: item.info.role === 'user' ? 'user' : 'assistant',
    content,
    updatedAt: item.info.time?.created ?? Date.now()
  }
}

function getEventSessionId(event: OpencodeEvent) {
  const properties = event.properties as Record<string, any>
  return properties.sessionID || properties.info?.sessionID || properties.part?.sessionID || ''
}

function isUnauthorizedError(error: unknown) {
  return error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('401'))
}

function parseError(error: unknown) {
  if (error instanceof Error && error.message) {
    if (isUnauthorizedError(error)) {
      return '连接被拒绝：这个 opencode server 开启了 Basic Auth，请填写用户名和密码。'
    }

    return error.message
  }

  return '连接 opencode 失败'
}

function buildAuthHeader(username: string, password: string) {
  if (!password) {
    return undefined
  }

  return `Basic ${window.btoa(`${username}:${password}`)}`
}

function getNotificationTargetUrl(sessionId: string) {
  return sessionId ? `/conversations/${encodeURIComponent(sessionId)}` : '/'
}

type MediaQueryWithLegacyListeners = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

export function useOpencodeApp() {
  const serverUrl = ref(readStorage(STORAGE_KEYS.serverUrl, 'http://127.0.0.1:4096'))
  const username = ref(readStorage(STORAGE_KEYS.username, 'opencode'))
  const password = ref(readSessionStorage(STORAGE_KEYS.password, ''))
  const selectedSessionId = ref(readStorage(STORAGE_KEYS.selectedSession, ''))
  const draftDirectory = ref(readStorage(STORAGE_KEYS.draftDirectory, ''))
  const composerMode = ref<ComposerMode>(
    readStorage(STORAGE_KEYS.composerMode, 'prompt') === 'command' ? 'command' : 'prompt'
  )
  const selectedAgentId = ref(readStorage(STORAGE_KEYS.selectedAgent, ''))
  const selectedModelKey = ref(normalizeModelKey(readStorage(STORAGE_KEYS.selectedModel, '')))
  const composerText = ref('')
  const availableAgents = ref<ChatAgentRecord[]>([])
  const availableModels = ref<ChatModelRecord[]>([])
  const sessions = ref<SessionRecord[]>([])
  const projectCatalog = ref<Array<{ directory: string; name: string; lastUpdated: number }>>([])
  const messages = ref<ChatMessageRecord[]>([])
  const isConnecting = ref(false)
  const isLoadingSession = ref(false)
  const isSending = ref(false)
  const isRefreshing = ref(false)
  const isLoadingOlderMessages = ref(false)
  const sessionStatus = ref<'idle' | 'busy'>('idle')
  const lastError = ref('')
  const streamReady = ref(false)
  const authValidated = ref(false)
  const historyMessageLimit = ref(INITIAL_HISTORY_LIMIT)
  const hasMoreHistory = ref(false)
  const notificationPermission = ref<NotificationPermission>(getNotificationPermission())
  const isRequestingNotificationPermission = ref(false)
  const installPromptEvent = ref<BeforeInstallPromptEvent | null>(null)
  const isPwaInstalled = ref(isStandaloneDisplay())
  const serviceWorkerRegistration = ref<ServiceWorkerRegistration | null>(null)
  const sessionListUiState = ref<Record<string, SessionListUiState>>({})

  let client: OpencodeClient | null = null
  let closeStream: (() => void) | null = null
  let pendingCompletionNotice: PendingCompletionNotice | null = null
  let displayModeQuery: MediaQueryList | null = null
  let sessionListRefreshTimer: ReturnType<typeof window.setTimeout> | null = null
  let sessionListRefreshPending = false
  let sessionListRefreshRunning = false
  const handleDisplayModeChange = () => syncInstalledState()
  const pendingNewSessionIds = new Set<string>()

  const hasAuthCredentials = computed(() => Boolean(username.value.trim()) && Boolean(password.value.trim()))
  const notificationSupported = computed(() => isNotificationSupported())
  const notificationsEnabled = computed(
    () => notificationSupported.value && notificationPermission.value === 'granted'
  )
  const installAvailable = computed(() => Boolean(installPromptEvent.value))
  const authGateVisible = computed(() => !authValidated.value)
  const authGateMessage = computed(() => {
    if (!hasAuthCredentials.value) {
      return '当前服务已开启认证，必须先填写账号和密码。'
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

  const selectedModel = computed(() =>
    availableModels.value.find((model) => model.key === normalizeModelKey(selectedModelKey.value)) ?? null
  )

  const visibleMessages = computed(() => messages.value.slice(-historyMessageLimit.value))
  const hiddenMessageCount = computed(() => Math.max(messages.value.length - visibleMessages.value.length, 0))
  const hasTruncatedMessages = computed(() => hasMoreHistory.value || hiddenMessageCount.value > 0)

  const projects = computed<ProjectRecord[]>(() => {
    const cutoff = Date.now() - RECENT_PROJECT_WINDOW
    const groups = new Map<string, ProjectRecord>()

    for (const project of projectCatalog.value) {
      groups.set(project.directory, {
        directory: project.directory,
        name: project.name,
        lastUpdated: project.lastUpdated,
        sessionCount: 0,
        source: 'server'
      })
    }

    for (const session of sessions.value) {
      const directory = normalizeDirectory(session.directory)
      if (!directory) {
        continue
      }

      const existing = groups.get(directory)
      const updated = session.time?.updated ?? session.time?.created ?? 0
      if (existing) {
        existing.sessionCount += 1
        existing.lastUpdated = Math.max(existing.lastUpdated, updated)
        if (existing.source !== 'manual') {
          existing.source = 'session'
        }
      } else {
        groups.set(directory, {
          directory,
          name: getDirectoryName(directory),
          lastUpdated: updated,
          sessionCount: 1,
          source: 'session'
        })
      }
    }

    const manualDirectory = normalizeDirectory(draftDirectory.value)
    if (manualDirectory && !groups.has(manualDirectory)) {
      groups.set(manualDirectory, {
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

  function setSessionListUiState(sessionId: string, nextState: SessionListUiState | null) {
    const nextEntries = { ...sessionListUiState.value }

    if (nextState && (nextState.isNew || nextState.justCompleted)) {
      nextEntries[sessionId] = nextState
    } else {
      delete nextEntries[sessionId]
    }

    sessionListUiState.value = nextEntries
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

    const currentState = sessionListUiState.value[sessionId] ?? {}
    setSessionListUiState(sessionId, {
      ...currentState,
      [flag]: true
    })
  }

  function syncSessionListUiState(sessionIds: string[]) {
    const validSessionIds = new Set(sessionIds)
    const nextEntries = Object.fromEntries(
      Object.entries(sessionListUiState.value).filter(([sessionId, state]) => {
        return validSessionIds.has(sessionId) && (state.isNew || state.justCompleted)
      })
    )

    sessionListUiState.value = nextEntries
  }

  function getSessionListBadges(sessionId: string) {
    const state = sessionListUiState.value[sessionId]
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
    ].filter((badge): badge is { key: 'new' | 'completed'; label: string; tone: 'accent' | 'success' } => Boolean(badge))
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
      await refreshSessions({ reopen: false })

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

    const session = sessions.value.find((item) => item.id === sessionId) ?? activeSession.value
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

  function invalidateAuth() {
    authValidated.value = false
    streamReady.value = false
    closeStream?.()
    closeStream = null
    client = null
  }

  function handleRequestError(error: unknown) {
    lastError.value = parseError(error)

    if (isUnauthorizedError(error)) {
      invalidateAuth()
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

  function applyChatSelections(options: { preferredAgentId?: string; preferredModelKey?: string } = {}) {
    const agentIds = new Set(availableAgents.value.map((agent) => agent.id))
    const nextAgentId = [
      options.preferredAgentId,
      selectedAgentId.value,
      availableAgents.value.find((agent) => agent.id === 'build')?.id,
      availableAgents.value[0]?.id
    ].find((candidate) => Boolean(candidate) && agentIds.has(candidate as string)) || ''

    selectedAgentId.value = nextAgentId

    const modelKeys = new Set(availableModels.value.map((model) => model.key))
    const agentModel = availableAgents.value.find((agent) => agent.id === nextAgentId)?.model
    const agentModelKey = agentModel ? makeModelKey(agentModel.providerId, agentModel.modelId) : ''
    const nextModelKey = [
      options.preferredModelKey,
      selectedModelKey.value,
      agentModelKey,
      availableModels.value[0]?.key
    ]
      .map((candidate) => normalizeModelKey(candidate))
      .find((candidate) => Boolean(candidate) && modelKeys.has(candidate)) || ''

    selectedModelKey.value = nextModelKey
  }

  async function loadChatOptions(options: {
    directory?: string
    preferredAgentId?: string
    preferredModelKey?: string
  } = {}) {
    const currentClient = getClient()
    const directory = normalizeDirectory(options.directory ?? chatOptionDirectory.value)
    const params = directory ? { directory } : undefined
    const [{ data: providerData }, { data: agentData }] = await Promise.all([
      currentClient.provider.list(params),
      currentClient.app.agents(params)
    ])

    availableModels.value = buildModelCatalog((providerData ?? {}) as ProviderListResponse)
    availableAgents.value = buildAgentCatalog((agentData ?? []) as AgentInfo[])
    applyChatSelections(options)
  }

  function selectModel(modelKey: string) {
    selectedModelKey.value = normalizeModelKey(modelKey)
  }

  function selectAgent(agentId: string) {
    selectedAgentId.value = agentId

    const agentModel = availableAgents.value.find((agent) => agent.id === agentId)?.model
    if (!agentModel) {
      return
    }

    const nextModelKey = makeModelKey(agentModel.providerId, agentModel.modelId)
    if (availableModels.value.some((model) => model.key === nextModelKey)) {
      selectedModelKey.value = nextModelKey
    }
  }

  async function listGlobalSessions() {
    const url = new URL('/experimental/session', serverUrl.value)
    url.searchParams.set('roots', 'true')
    url.searchParams.set('limit', String(SESSION_LIST_LIMIT))

    const response = await fetch(url.toString(), {
      headers: getRequestHeaders()
    })

    if (!response.ok) {
      throw new Error(`拉取全局会话失败：${response.status} ${response.statusText}`)
    }

    return (await response.json()) as SessionRecord[]
  }

  function getClient() {
    if (!client) {
      const headers = getRequestHeaders()

      client = createOpencodeClient({
        baseUrl: serverUrl.value,
        headers
      })
    }

    return client
  }

  async function startEventStream() {
    closeStream?.()
    closeStream = null

    const currentClient = getClient()
    const events = await currentClient.event.subscribe()
    const maybeClose = (events as { close?: () => void }).close

    closeStream = () => {
      if (typeof maybeClose === 'function') {
        maybeClose.call(events)
      }
      streamReady.value = false
    }

    streamReady.value = true

    void (async () => {
      try {
        for await (const event of events.stream) {
          handleEvent(event as OpencodeEvent)
        }
      } catch (error) {
        handleRequestError(error)
        streamReady.value = false
      }
    })()
  }

  async function refreshSessions(options: { reopen?: boolean } = {}) {
    isRefreshing.value = true
    try {
      const currentClient = getClient()
      const [globalSessions, { data: projectData }] = await Promise.all([
        listGlobalSessions(),
        currentClient.project.list()
      ])
      const nextSessions = globalSessions
        .filter((session) => !session.parentID)
        .sort((left, right) => (right.time?.updated ?? 0) - (left.time?.updated ?? 0))

      projectCatalog.value = ((projectData ?? []) as Project[])
        .map((project) => ({
          directory: normalizeDirectory(project.worktree),
          name: project.name || getDirectoryName(project.worktree),
          lastUpdated: project.time.updated
        }))
        .filter((project) => Boolean(project.directory))

      sessions.value = nextSessions
      syncSessionListUiState(nextSessions.map((session) => session.id))

      const currentSessionExists = nextSessions.some((session) => session.id === selectedSessionId.value)
      if (!currentSessionExists) {
        selectedSessionId.value = ''
      }

      if (!selectedSessionId.value) {
        selectedSessionId.value = nextSessions[0]?.id || nextSessions.find((session) => session.directory)?.id || ''
      }

      if (options.reopen !== false && selectedSessionId.value) {
        await openSession(selectedSessionId.value)
      }
    } finally {
      isRefreshing.value = false
    }
  }

  async function connect() {
    if (!hasAuthCredentials.value) {
      lastError.value = '请先填写认证账号和密码。'
      invalidateAuth()
      return false
    }

    isConnecting.value = true
    lastError.value = ''
    client = null

    try {
      const currentClient = getClient()
      await currentClient.global.health()
      await startEventStream()
      await loadChatOptions()
      await refreshSessions()
      authValidated.value = true
      return true
    } catch (error) {
      handleRequestError(error)
      streamReady.value = false
      return false
    } finally {
      isConnecting.value = false
    }
  }

  async function openSession(sessionId: string, options: { messageLimit?: number } = {}) {
    if (!sessionId) {
      return
    }

    const requestedLimit = Math.max(
      options.messageLimit ?? (selectedSessionId.value === sessionId ? historyMessageLimit.value : INITIAL_HISTORY_LIMIT),
      INITIAL_HISTORY_LIMIT
    )

    isLoadingSession.value = true
    lastError.value = ''

    try {
      const currentClient = getClient()
      const { data: session } = await currentClient.session.get({ sessionID: sessionId })
      const { data: history } = await currentClient.session.messages({
        sessionID: sessionId,
        limit: requestedLimit
      })
      const normalizedDirectory = normalizeDirectory(session?.directory)
      const historyItems = (history ?? []) as MessageHistoryItem[]
      const historySelection = getHistorySelection(historyItems)

      historyMessageLimit.value = requestedLimit
      hasMoreHistory.value = historyItems.length >= requestedLimit
      selectedSessionId.value = sessionId

      await loadChatOptions({
        directory: normalizedDirectory,
        preferredAgentId: historySelection.agentId,
        preferredModelKey: historySelection.modelKey
      })

      messages.value = pruneEmptyAssistantMessages(historyItems.map(convertHistoryMessage))
      sessionStatus.value = 'idle'
    } catch (error) {
      handleRequestError(error)
    } finally {
      isLoadingSession.value = false
    }
  }

  async function loadOlderMessages() {
    if (isLoadingOlderMessages.value || isLoadingSession.value || !hasTruncatedMessages.value) {
      return
    }

    const nextLimit = historyMessageLimit.value + HISTORY_LIMIT_STEP
    isLoadingOlderMessages.value = true

    try {
      historyMessageLimit.value = nextLimit

      if (!selectedSessionId.value || !hasMoreHistory.value || messages.value.length >= nextLimit) {
        return
      }

      await openSession(selectedSessionId.value, {
        messageLimit: nextLimit
      })
    } finally {
      isLoadingOlderMessages.value = false
    }
  }

  async function createSession(directoryOverride?: string) {
    const directory = normalizeDirectory(directoryOverride || draftDirectory.value)
    if (!directory) {
      lastError.value = '请先输入项目目录，或选择一个已有项目。'
      return
    }

    lastError.value = ''
    draftDirectory.value = directory

    try {
      const currentClient = getClient()
      const { data: session } = await currentClient.session.create({ directory })
      if (!session) {
        throw new Error('创建会话失败。')
      }

      await refreshSessions({ reopen: false })
      await openSession(session.id)
    } catch (error) {
      handleRequestError(error)
    }
  }

  async function sendCurrentMessage() {
    const trimmed = composerText.value.trim()
    if (!trimmed || isSending.value) {
      return
    }

    if (!selectedSessionId.value) {
      await createSession()
    }

    if (!selectedSessionId.value) {
      return
    }

    const currentClient = getClient()
    const model = selectedModel.value
      ? {
          providerID: selectedModel.value.providerId,
          modelID: selectedModel.value.modelId
        }
      : undefined
    const agent = selectedAgent.value?.id || undefined
    isSending.value = true
    sessionStatus.value = 'busy'
    lastError.value = ''

    try {
      const currentSessionId = selectedSessionId.value
      const isCommand = trimmed.startsWith('/')
      if (isCommand) {
        const normalized = trimmed.slice(1)
        const [command, ...rest] = normalized.split(/\s+/)
        if (!command) {
          throw new Error('命令不能为空。')
        }

        await currentClient.session.command({
          sessionID: selectedSessionId.value,
          command,
          arguments: rest.join(' '),
          agent,
          model: model ? makeModelKey(model.providerID, model.modelID) : undefined
        })
      } else {
        await currentClient.session.prompt({
          sessionID: selectedSessionId.value,
          agent,
          model,
          parts: [{ type: 'text', text: trimmed }]
        })
      }

      armCompletionNotice(currentSessionId, trimmed)
      composerText.value = ''
    } catch (error) {
      clearPendingCompletionNotice(selectedSessionId.value)
      handleRequestError(error)
      isSending.value = false
      sessionStatus.value = 'idle'
    }
  }

  function handleEvent(event: OpencodeEvent) {
    const eventSessionId = getEventSessionId(event)

    if (event.type === 'session.created') {
      scheduleSessionListRefresh({ newSessionId: eventSessionId })
    }

    if (event.type === 'session.updated') {
      scheduleSessionListRefresh()
    }

    if (event.type === 'session.idle') {
      markSessionListFlag(eventSessionId, 'justCompleted')
      void maybeNotifySessionCompletion(eventSessionId)
    }

    if (event.type === 'session.error' && pendingCompletionNotice?.sessionId === eventSessionId) {
      clearPendingCompletionNotice(eventSessionId)
    }

    if (!selectedSessionId.value || eventSessionId !== selectedSessionId.value) {
      return
    }

    switch (event.type) {
      case 'message.updated': {
        const info = (event.properties as { info: Partial<Message> & { id: string; role?: string } }).info
        if (info.role === 'user') {
          ensureTextMessage(messages.value, info)
        }
        break
      }
      case 'message.part.updated': {
        const { part } = event.properties as { part: Part & { text?: string } }
        if (part.type !== 'text') {
          return
        }

        const current = ensureTextMessage(messages.value, {
          id: part.messageID,
          role: messages.value.find((item) => item.id === part.messageID)?.role ?? 'assistant'
        })
        current.content = part.text ?? current.content
        current.updatedAt = Date.now()
        break
      }
      case 'session.status': {
        const { status } = event.properties as { status: { type: 'idle' | 'busy' | 'retry' } }
        sessionStatus.value = status.type === 'busy' ? 'busy' : 'idle'
        break
      }
      case 'session.idle': {
        messages.value = pruneEmptyAssistantMessages(messages.value)
        sessionStatus.value = 'idle'
        isSending.value = false
        break
      }
      case 'session.error': {
        messages.value = pruneEmptyAssistantMessages(messages.value)
        clearPendingCompletionNotice(eventSessionId)
        lastError.value = JSON.stringify(event.properties)
        sessionStatus.value = 'idle'
        isSending.value = false
        break
      }
    }
  }

  watch(serverUrl, (value) => writeStorage(STORAGE_KEYS.serverUrl, value))
  watch([username, password], ([nextUsername, nextPassword], [prevUsername, prevPassword]) => {
    if (nextUsername === prevUsername && nextPassword === prevPassword) {
      return
    }

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
  watch(chatOptionDirectory, (directory, previousDirectory) => {
    if (!authValidated.value || directory === previousDirectory) {
      return
    }

    void loadChatOptions({ directory })
  })

  onMounted(() => {
    notificationPermission.value = getNotificationPermission()
    syncInstalledState()

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
    window.addEventListener('appinstalled', handleAppInstalled)

    displayModeQuery = window.matchMedia('(display-mode: standalone)')

    if (typeof displayModeQuery.addEventListener === 'function') {
      displayModeQuery.addEventListener('change', handleDisplayModeChange)
    } else {
      ;(displayModeQuery as MediaQueryWithLegacyListeners).addListener?.(handleDisplayModeChange)
    }

    void ensureServiceWorkerRegistration().catch(() => undefined)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
    window.removeEventListener('appinstalled', handleAppInstalled)

    if (displayModeQuery) {
      if (typeof displayModeQuery.removeEventListener === 'function') {
        displayModeQuery.removeEventListener('change', handleDisplayModeChange)
      } else {
        ;(displayModeQuery as MediaQueryWithLegacyListeners).removeListener?.(handleDisplayModeChange)
      }
    }

    if (sessionListRefreshTimer) {
      window.clearTimeout(sessionListRefreshTimer)
    }

    closeStream?.()
  })

  return {
    serverUrl,
    username,
    password,
    hasAuthCredentials,
    notificationSupported,
    notificationPermission,
    notificationsEnabled,
    isRequestingNotificationPermission,
    installAvailable,
    isPwaInstalled,
    authGateVisible,
    authGateMessage,
    selectedSessionId,
    draftDirectory,
    composerMode,
    selectedAgentId,
    selectedModelKey,
    composerText,
    availableAgents,
    availableModels,
    projects,
    sessions,
    messages,
    visibleMessages,
    activeSession,
    selectedAgent,
    selectedModel,
    isConnecting,
    isLoadingSession,
    isRefreshing,
    isLoadingOlderMessages,
    isSending,
    sessionStatus,
    lastError,
    streamReady,
    authValidated,
    connectionStateLabel,
    canCreateSession,
    historyMessageLimit,
    hiddenMessageCount,
    hasMoreHistory,
    hasTruncatedMessages,
    getSessionListBadges,
    clearSessionListBadges,
    connect,
    refreshSessions,
    openSession,
    createSession,
    loadOlderMessages,
    requestNotificationPermission,
    promptInstall,
    selectAgent,
    selectModel,
    sendCurrentMessage
  }
}
