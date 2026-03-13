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
  resolveChatSelections
} from '@/composables/useOpencodeApp/catalog'
import {
  GLOBAL_CHAT_OPTIONS_KEY,
  INITIAL_HISTORY_LIMIT,
  RECENT_PROJECT_WINDOW,
  SESSION_LIST_LIMIT,
  STORAGE_KEYS
} from '@/composables/useOpencodeApp/constants'
import {
  buildAuthHeader,
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
  pruneEmptyAssistantMessages,
  shouldRefreshSessionList
} from '@/composables/useOpencodeApp/messages'
import { createPwaManager } from '@/composables/useOpencodeApp/pwa'
import { createSessionActions } from '@/composables/useOpencodeApp/sessionActions'
import { createSessionStateManager } from '@/composables/useOpencodeApp/sessionState'
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
  SessionRecord
} from '@/types/opencode'

import type {
  AgentInfo,
  ChatOptionsSnapshot,
  ConfigProvidersResponse,
  ProjectCatalogEntry,
  SessionListUiState,
  SkillInfo
} from '@/composables/useOpencodeApp/types'

type OpencodeClient = ReturnType<typeof createOpencodeClient>

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
  const selectedCommandName = ref('')
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
  const sessionStatus = ref<'idle' | 'busy'>('idle')
  const lastError = ref('')
  const streamReady = ref(false)
  const authValidated = ref(false)
  const historyMessageLimit = ref(INITIAL_HISTORY_LIMIT)
  const hasMoreHistory = ref(false)
  const sessionListUiState = ref<Record<string, SessionListUiState>>({})

  const clientCache = new Map<string, OpencodeClient>()
  let closeStream: (() => void) | null = null
  const chatOptionsCache = new Map<string, ChatOptionsSnapshot>()
  const chatOptionsRequests = new Map<string, Promise<ChatOptionsSnapshot>>()

  const hasAuthCredentials = computed(() => Boolean(username.value.trim()) && Boolean(password.value.trim()))
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

  const projects = computed<ProjectRecord[]>(() => {
    const cutoff = Date.now() - RECENT_PROJECT_WINDOW
    const groups = new Map<string, ProjectRecord>()

    for (const project of projectCatalog.value) {
      groups.set(project.directory, {
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
      const directory = normalizeDirectory(session.directory)
      if (!directory) {
        continue
      }

      const existing = groups.get(directory)
      const updated = session.time?.updated ?? session.time?.created ?? 0
      if (existing) {
        existing.projectId = existing.projectId || session.projectId || session.project?.id
        existing.icon = existing.icon || session.project?.icon
        existing.sessionCount += 1
        existing.lastUpdated = Math.max(existing.lastUpdated, updated)
        if (existing.source !== 'manual') {
          existing.source = 'session'
        }
      } else {
        groups.set(directory, {
          projectId: session.projectId || session.project?.id,
          directory,
          name: session.project?.name || getDirectoryName(directory),
          icon: session.project?.icon,
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
    sessions,
    selectedAgent,
    selectedCommand,
    selectedCommandName,
    selectedModel,
    selectedSessionId,
    sessionPreviewMessages,
    sessionStatus,
    armCompletionNotice,
    clearPendingCompletionNotice,
    ensureChatOptionsSnapshot,
    ensureDesktopSessionState,
    getClient,
    handleRequestError,
    invalidateAuth,
    loadChatOptions,
    refreshSessions: (options) => refreshSessions(options),
    removeDesktopSessionState,
    setDesktopSessionChatOptions,
    syncSessionPreviewFromMessages
  })
  const {
    closeDesktopSession,
    createDesktopSession,
    createSession,
    loadOlderDesktopMessages,
    loadOlderMessages,
    loadSessionPreview,
    openDesktopSession,
    openSession,
    preloadSessionPreviews,
    rejectQuestion,
    replyPermission,
    replyQuestion,
    sendCurrentMessage,
    sendDesktopMessage,
    sendPromptToSession
  } = sessionActions

  function invalidateAuth() {
    authValidated.value = false
    streamReady.value = false
    clientCache.clear()
    chatOptionsCache.clear()
    chatOptionsRequests.clear()
    availableAgents.value = []
    availableCommands.value = []
    availableModels.value = []
    desktopSessions.value = {}
    closeStream?.()
    closeStream = null
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

  function getChatOptionsCacheKey(directory?: string) {
    return normalizeDirectory(directory) || GLOBAL_CHAT_OPTIONS_KEY
  }

  function setAvailableChatOptions(snapshot: ChatOptionsSnapshot, options: { preferredAgentId?: string; preferredModelKey?: string } = {}) {
    availableModels.value = snapshot.models
    availableAgents.value = snapshot.agents
    availableCommands.value = snapshot.commands

    if (!availableCommands.value.some((command) => command.name === selectedCommandName.value)) {
      selectedCommandName.value = ''
    }

    applyChatSelections(options)
  }

  function setDesktopSessionChatOptions(
    sessionState: DesktopSessionState,
    snapshot: ChatOptionsSnapshot,
    options: { preferredAgentId?: string; preferredModelKey?: string } = {}
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
  }

  async function fetchChatOptionsSnapshot(directory?: string) {
    const normalizedDirectory = normalizeDirectory(directory)
    const currentClient = getClient(normalizedDirectory)
    const params = normalizedDirectory ? { directory: normalizedDirectory } : undefined
    const [{ data: providerData }, { data: agentData }, { data: scopedCommandData }, { data: globalCommandData }, { data: skillData }] =
      await Promise.all([
        currentClient.config.providers(params),
        currentClient.app.agents(params),
        currentClient.command.list(params),
        currentClient.command.list(),
        currentClient.app.skills(params)
      ])

    return {
      models: buildModelCatalog((providerData ?? {}) as ConfigProvidersResponse),
      agents: buildAgentCatalog((agentData ?? []) as AgentInfo[]),
      commands: buildCommandCatalog(
        (scopedCommandData ?? []) as OpencodeCommand[],
        (globalCommandData ?? []) as OpencodeCommand[],
        (skillData ?? []) as SkillInfo[]
      )
    } satisfies ChatOptionsSnapshot
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

    void Promise.allSettled([
      ensureChatOptionsSnapshot(),
      ...uniqueDirectories.map((directory) => ensureChatOptionsSnapshot(directory))
    ])
  }

  async function preloadHomeData() {
    if (!authValidated.value) {
      return
    }

    const directories = [draftDirectory.value, ...sessions.value.map((session) => session.directory ?? '')]
    await Promise.allSettled([
      ensureChatOptionsSnapshot(),
      ...Array.from(new Set(directories.map((directory) => normalizeDirectory(directory)).filter(Boolean))).map((directory) =>
        ensureChatOptionsSnapshot(directory)
      )
    ])
  }

  function applyChatSelections(options: { preferredAgentId?: string; preferredModelKey?: string } = {}) {
    const nextSelections = resolveChatSelections(
      {
        agents: availableAgents.value,
        commands: availableCommands.value,
        models: availableModels.value
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

  async function loadChatOptions(options: {
    directory?: string
    preferredAgentId?: string
    preferredModelKey?: string
  } = {}) {
    const directory = normalizeDirectory(options.directory ?? chatOptionDirectory.value)
    const snapshot = await ensureChatOptionsSnapshot(directory)
    setAvailableChatOptions(snapshot, options)
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

  function selectDesktopModel(sessionId: string, modelKey: string) {
    const sessionState = ensureDesktopSessionState(sessionId)
    sessionState.selectedModelKey = normalizeModelKey(modelKey)
  }

  function selectDesktopAgent(sessionId: string, agentId: string) {
    const sessionState = ensureDesktopSessionState(sessionId)
    sessionState.selectedAgentId = agentId

    const agentModel = sessionState.availableAgents.find((agent) => agent.id === agentId)?.model
    if (!agentModel) {
      return
    }

    const nextModelKey = makeModelKey(agentModel.providerId, agentModel.modelId)
    if (sessionState.availableModels.some((model) => model.key === nextModelKey)) {
      sessionState.selectedModelKey = nextModelKey
    }
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

    return ((await response.json()) as GlobalSession[]).map((session) => mapGlobalSession(session))
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
          handleEvent(typedEvent)
        }
      } catch (error) {
        console.error('[opencode:sse] stream error', error)
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
        .map((project) => mapProjectCatalogEntry(project))
        .filter((project) => Boolean(project.directory))

      sessions.value = nextSessions
      syncSessionListUiState(nextSessions.map((session) => session.id))
      syncSessionPreviewCache(nextSessions.map((session) => session.id))
      syncDesktopSessionStates(nextSessions.map((session) => session.id))

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

      preloadChatOptions([
        draftDirectory.value,
        ...nextSessions.map((session) => session.directory ?? '')
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

  async function connect() {
    if (!hasAuthCredentials.value) {
      lastError.value = '请先填写认证账号和密码。'
      invalidateAuth()
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

      void Promise.allSettled([
        loadChatOptions(),
        refreshSessions({ reopen: false })
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
      handleRequestError(error)
      streamReady.value = false
      return false
    } finally {
      isConnecting.value = false
    }
  }


  function handleEvent(event: OpencodeEvent) {
    const eventSessionId = getEventSessionId(event)

    if (event.type === 'session.created') {
      scheduleSessionListRefresh({ newSessionId: eventSessionId })
    } else if (shouldRefreshSessionList(event)) {
      scheduleSessionListRefresh()
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

    if (event.type === 'session.error') {
      clearPendingCompletionNotice(eventSessionId)
    }

    if (eventSessionId) {
      const desktopSessionState = desktopSessions.value[eventSessionId]

      if (selectedSessionId.value === eventSessionId) {
        messages.value = applyEventToMessageCollection(messages.value.slice(), event)
      }

      if (desktopSessionState) {
        desktopSessionState.messages = applyEventToMessageCollection(desktopSessionState.messages.slice(), event)
        syncSessionPreviewFromMessages(eventSessionId, desktopSessionState.messages)
      } else if (selectedSessionId.value !== eventSessionId && sessionPreviewMessages.value[eventSessionId]) {
        sessionPreviewMessages.value = {
          ...sessionPreviewMessages.value,
          [eventSessionId]: applyEventToMessageCollection(sessionPreviewMessages.value[eventSessionId].slice(), event)
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
    }

    if (!selectedSessionId.value || eventSessionId !== selectedSessionId.value) {
      return
    }

    switch (event.type) {
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
  watch(
    [selectedSessionId, messages],
    ([sessionId, nextMessages]) => {
      if (!sessionId) {
        return
      }

      syncSessionPreviewFromMessages(sessionId, nextMessages)
    },
    { deep: true }
  )
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
    disposePwa = mountPwa()
  })

  onBeforeUnmount(() => {
    disposePwa()
    disposeSessionStateManager()

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
    openDesktopSession,
    createSession,
    createDesktopSession,
    closeDesktopSession,
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
    updateProject,
    sendCurrentMessage
  }
}
