import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  createOpencodeClient,
  type Command as OpencodeCommand,
  type Event as OpencodeEvent,
  type GlobalSession,
  type Message,
  type Part,
  type PermissionRequest,
  type QuestionAnswer,
  type QuestionRequest,
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
  ChatCommandRecord,
  ChatMessageRecord,
  ChatModelRecord,
  ComposerMode,
  ProjectIconRecord,
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
const GLOBAL_CHAT_OPTIONS_KEY = '__global__'

type PendingCompletionNotice = {
  sessionId: string
  prompt: string
}

type ChatOptionsSnapshot = {
  agents: ChatAgentRecord[]
  commands: ChatCommandRecord[]
  models: ChatModelRecord[]
}

type SessionListFlag = 'isNew' | 'justCompleted'
type SessionListUiState = Partial<Record<SessionListFlag, boolean>>

type OpencodeClient = ReturnType<typeof createOpencodeClient>
type MessageHistoryItem = { info: Message; parts: Part[] }
type ChatToolStatus = NonNullable<ChatMessageRecord['tools']>[number]['status']
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

type SkillInfo = {
  name: string
  description: string
  location: string
  content: string
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

function buildCommandCatalog(
  scopedCommands: OpencodeCommand[] = [],
  globalCommands: OpencodeCommand[] = [],
  skills: SkillInfo[] = []
) {
  const globalNames = new Set(globalCommands.map((command) => command.name))
  const skillNames = new Set(skills.map((skill) => skill.name))

  return scopedCommands
    .map<ChatCommandRecord>((command) => {
      const isSkill = command.source === 'skill' || skillNames.has(command.name)
      const category = isSkill ? 'skill' : globalNames.has(command.name) ? 'system' : 'custom'

      return {
        name: command.name,
        description: command.description || '',
        template: command.template,
        hints: command.hints ?? [],
        source: command.source,
        category
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
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

function ensureChatMessage(messages: ChatMessageRecord[], info: Partial<Message> & { id: string; role?: string }) {
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

function ensureAssistantMessage(messages: ChatMessageRecord[], messageId: string) {
  return ensureChatMessage(messages, {
    id: messageId,
    role: 'assistant'
  })
}

function extractTextContent(parts: Part[]) {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as Part & { text?: string }).text ?? '')
    .join('')
}

function pruneEmptyAssistantMessages(messages: ChatMessageRecord[]) {
  return messages.filter((message) => isRenderableMessage(message))
}

function isRenderableMessage(message: ChatMessageRecord) {
  return Boolean(message.role === 'user' || message.content.trim() || message.confirmation || message.question)
}

function getToolStatus(status: 'pending' | 'running' | 'completed' | 'error'): ChatToolStatus {
  return status === 'error' ? 'failed' : status
}

function convertHistoryMessage(item: MessageHistoryItem): ChatMessageRecord {
  const content = extractTextContent(item.parts)
  const tools = item.parts
    .filter((part): part is Extract<Part, { type: 'tool' }> => part.type === 'tool')
    .map((part) => ({
      id: part.id,
      callId: part.callID,
      name: part.tool,
      status: getToolStatus(part.state.status),
      title: 'title' in part.state ? part.state.title : undefined,
      input: part.state.input
    }))

  return {
    id: item.info.id,
    role: item.info.role === 'user' ? 'user' : 'assistant',
    content,
    updatedAt: item.info.time?.created ?? Date.now(),
    tools
  }
}

function applyPermissionAsked(messages: ChatMessageRecord[], permission: PermissionRequest) {
  const current = ensureAssistantMessage(messages, permission.tool?.messageID || permission.id)
  current.confirmation = {
    id: permission.id,
    sessionId: permission.sessionID,
    type: permission.permission,
    patterns: permission.patterns || [],
    metadata: permission.metadata || {},
    callId: permission.tool?.callID
  }
  current.updatedAt = Date.now()
}

function applyPermissionReplied(
  messages: ChatMessageRecord[],
  payload: { sessionID: string; requestID: string; reply: 'once' | 'always' | 'reject' }
) {
  const current = messages.find((message) => message.confirmation?.id === payload.requestID)
  if (!current?.confirmation) {
    return
  }

  current.confirmation = {
    ...current.confirmation,
    response: payload.reply
  }

  if (payload.reply !== 'reject') {
    current.confirmation = undefined
  }

  current.updatedAt = Date.now()
}

function applyQuestionAsked(messages: ChatMessageRecord[], request: QuestionRequest) {
  const current = ensureAssistantMessage(messages, request.tool?.messageID || request.id)
  current.question = {
    id: request.id,
    sessionId: request.sessionID,
    callId: request.tool?.callID,
    status: 'pending',
    questions: request.questions.map((item) => ({
      header: item.header,
      question: item.question,
      options: item.options.map((option) => ({
        label: option.label,
        description: option.description
      })),
      multiple: item.multiple,
      custom: item.custom
    }))
  }
  current.updatedAt = Date.now()
}

function applyQuestionAnswered(messages: ChatMessageRecord[], requestId: string, answers: QuestionAnswer[]) {
  const current = messages.find((message) => message.question?.id === requestId)
  if (!current?.question) {
    return
  }

  current.question = {
    ...current.question,
    status: 'answered',
    answers: answers.map((item) => [...item])
  }
  current.updatedAt = Date.now()
}

function applyQuestionRejected(messages: ChatMessageRecord[], requestId: string) {
  const current = messages.find((message) => message.question?.id === requestId)
  if (!current?.question) {
    return
  }

  current.question = {
    ...current.question,
    status: 'rejected'
  }
  current.updatedAt = Date.now()
}

function applyEventToMessageCollection(messages: ChatMessageRecord[], event: OpencodeEvent) {
  switch (event.type) {
    case 'message.updated': {
      const info = (event.properties as { info: Partial<Message> & { id: string; role?: string } }).info
      if (info.role === 'user') {
        ensureChatMessage(messages, info)
      }
      break
    }
    case 'message.part.updated': {
      const { part } = event.properties as { part: Part & { text?: string } }
      if (part.type === 'text') {
        const current = ensureChatMessage(messages, {
          id: part.messageID,
          role: messages.find((item) => item.id === part.messageID)?.role ?? 'assistant'
        })
        current.content = part.text ?? current.content
        current.updatedAt = Date.now()
        break
      }

      if (part.type === 'tool') {
        const current = ensureAssistantMessage(messages, part.messageID)
        const tools = current.tools ?? []
        const existing = tools.find((item) => item.id === part.id)
        const nextTool = {
          id: part.id,
          callId: part.callID,
          name: part.tool,
          status: getToolStatus(part.state.status),
          title: 'title' in part.state ? part.state.title : undefined,
          input: part.state.input
        }

        if (existing) {
          Object.assign(existing, nextTool)
        } else {
          tools.push(nextTool)
        }

        current.tools = tools
        current.updatedAt = Date.now()
      }
      break
    }
    case 'permission.asked': {
      applyPermissionAsked(messages, event.properties as PermissionRequest)
      break
    }
    case 'permission.replied': {
      applyPermissionReplied(messages, event.properties as { sessionID: string; requestID: string; reply: 'once' | 'always' | 'reject' })
      break
    }
    case 'question.asked': {
      applyQuestionAsked(messages, event.properties as QuestionRequest)
      break
    }
    case 'question.replied': {
      const { requestID, answers } = event.properties as { requestID: string; answers: QuestionAnswer[] }
      applyQuestionAnswered(messages, requestID, answers)
      break
    }
    case 'question.rejected': {
      applyQuestionRejected(messages, (event.properties as { requestID: string }).requestID)
      break
    }
    case 'session.idle':
    case 'session.error': {
      return pruneEmptyAssistantMessages(messages)
    }
  }

  return messages
}

function getEventSessionId(event: OpencodeEvent) {
  const properties = event.properties as Record<string, any>
  return properties.sessionID || properties.info?.sessionID || properties.info?.id || properties.part?.sessionID || ''
}

function shouldRefreshSessionList(event: OpencodeEvent) {
  switch (event.type) {
    case 'session.created':
    case 'session.updated':
    case 'session.deleted':
    case 'session.idle':
    case 'message.updated':
    case 'message.removed':
      return true
    default:
      return false
  }
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

type ProjectCatalogEntry = {
  projectId: string
  directory: string
  name: string
  lastUpdated: number
  icon?: ProjectIconRecord
}

function mapProjectCatalogEntry(project: Project): ProjectCatalogEntry {
  return {
    projectId: project.id,
    directory: normalizeDirectory(project.worktree),
    name: project.name || getDirectoryName(project.worktree),
    lastUpdated: project.time.updated,
    icon: project.icon
      ? {
          url: project.icon.url,
          override: project.icon.override,
          color: project.icon.color
        }
      : undefined
  }
}

function mapGlobalSession(session: GlobalSession): SessionRecord {
  return {
    id: session.id,
    projectId: session.projectID,
    title: session.title,
    directory: normalizeDirectory(session.directory),
    parentID: session.parentID,
    project: session.project
      ? {
          id: session.project.id,
          name: session.project.name,
          worktree: normalizeDirectory(session.project.worktree)
        }
      : null,
    time: {
      created: session.time.created,
      updated: session.time.updated
    }
  }
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
  const selectedCommandName = ref('')
  const availableAgents = ref<ChatAgentRecord[]>([])
  const availableCommands = ref<ChatCommandRecord[]>([])
  const availableModels = ref<ChatModelRecord[]>([])
  const sessions = ref<SessionRecord[]>([])
  const projectCatalog = ref<ProjectCatalogEntry[]>([])
  const messages = ref<ChatMessageRecord[]>([])
  const sessionPreviewMessages = ref<Record<string, ChatMessageRecord[]>>({})
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
  const chatOptionsCache = new Map<string, ChatOptionsSnapshot>()
  const chatOptionsRequests = new Map<string, Promise<ChatOptionsSnapshot>>()
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

  const selectedCommand = computed(() =>
    availableCommands.value.find((command) => command.name === selectedCommandName.value) ?? null
  )

  const selectedModel = computed(() =>
    availableModels.value.find((model) => model.key === normalizeModelKey(selectedModelKey.value)) ?? null
  )

  const visibleMessages = computed(() => {
    return messages.value.filter((message) => isRenderableMessage(message)).slice(-historyMessageLimit.value)
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

  function syncSessionPreviewCache(sessionIds: string[]) {
    const validIds = new Set(sessionIds)
    sessionPreviewMessages.value = Object.fromEntries(
      Object.entries(sessionPreviewMessages.value).filter(([sessionId]) => validIds.has(sessionId))
    )
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
    chatOptionsCache.clear()
    chatOptionsRequests.clear()
    availableAgents.value = []
    availableCommands.value = []
    availableModels.value = []
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

  async function fetchChatOptionsSnapshot(directory?: string) {
    const currentClient = getClient()
    const normalizedDirectory = normalizeDirectory(directory)
    const params = normalizedDirectory ? { directory: normalizedDirectory } : undefined
    const [{ data: providerData }, { data: agentData }, { data: scopedCommandData }, { data: globalCommandData }, { data: skillData }] =
      await Promise.all([
        currentClient.provider.list(params),
        currentClient.app.agents(params),
        currentClient.command.list(params),
        currentClient.command.list(),
        currentClient.app.skills(params)
      ])

    return {
      models: buildModelCatalog((providerData ?? {}) as ProviderListResponse),
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
        .map((project) => mapProjectCatalogEntry(project))
        .filter((project) => Boolean(project.directory))

      sessions.value = nextSessions
      syncSessionListUiState(nextSessions.map((session) => session.id))
      syncSessionPreviewCache(nextSessions.map((session) => session.id))

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
      const { data: questions } = await currentClient.question.list()
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
      sessionPreviewMessages.value = {
        ...sessionPreviewMessages.value,
        [sessionId]: messages.value.slice()
      }
      for (const request of ((questions ?? []) as QuestionRequest[]).filter((item) => item.sessionID === sessionId)) {
        applyQuestionAsked(messages.value, request)
      }
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

  async function loadSessionPreview(sessionId: string, options: { limit?: number; force?: boolean } = {}) {
    if (!sessionId) {
      return [] as ChatMessageRecord[]
    }

    if (!options.force && sessionPreviewMessages.value[sessionId]?.length) {
      return sessionPreviewMessages.value[sessionId]
    }

    try {
      const currentClient = getClient()
      const { data: history } = await currentClient.session.messages({
        sessionID: sessionId,
        limit: Math.max(options.limit ?? 24, 12)
      })
      const preview = pruneEmptyAssistantMessages(((history ?? []) as MessageHistoryItem[]).map(convertHistoryMessage))
      sessionPreviewMessages.value = {
        ...sessionPreviewMessages.value,
        [sessionId]: preview
      }
      return preview
    } catch (error) {
      if (selectedSessionId.value === sessionId) {
        handleRequestError(error)
      }
      return sessionPreviewMessages.value[sessionId] ?? []
    }
  }

  async function preloadSessionPreviews(sessionIds: string[], options: { limit?: number; force?: boolean } = {}) {
    const targets = [...new Set(sessionIds)].filter(Boolean)
    await Promise.all(targets.map((sessionId) => loadSessionPreview(sessionId, options)))
  }

  async function sendCurrentMessage() {
    const trimmedPrompt = composerText.value.trim()
    const selectedCommandEntry = selectedCommand.value
    const manualCommand = !selectedCommandEntry && trimmedPrompt.startsWith('/') ? trimmedPrompt.slice(1).trim() : ''
    const [manualCommandName, ...manualCommandArgs] = manualCommand ? manualCommand.split(/\s+/) : []
    const commandName = selectedCommandEntry?.name || manualCommandName || ''
    const commandArgs = manualCommandArgs.join(' ')
    const hasCommand = Boolean(commandName)

    if ((!trimmedPrompt && !hasCommand) || isSending.value) {
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
      if (hasCommand) {
        await currentClient.session.command({
          sessionID: selectedSessionId.value,
          command: commandName,
          arguments: commandArgs || undefined,
          agent,
          model: model ? makeModelKey(model.providerID, model.modelID) : undefined
        })
      } else {
        await currentClient.session.prompt({
          sessionID: selectedSessionId.value,
          agent,
          model,
          parts: [{ type: 'text', text: trimmedPrompt }]
        })
      }

      armCompletionNotice(
        currentSessionId,
        hasCommand ? `/${commandName}${commandArgs ? ` ${commandArgs}` : ''}` : trimmedPrompt
      )
      composerText.value = ''
      selectedCommandName.value = ''
      composerMode.value = 'prompt'
    } catch (error) {
      clearPendingCompletionNotice(selectedSessionId.value)
      handleRequestError(error)
      isSending.value = false
      sessionStatus.value = 'idle'
    }
  }

  async function sendPromptToSession(sessionId: string, prompt: string) {
    const trimmedPrompt = prompt.trim()
    if (!sessionId || !trimmedPrompt || isSending.value) {
      return
    }

    if (selectedSessionId.value !== sessionId || !messages.value.length) {
      await openSession(sessionId)
    }

    composerText.value = trimmedPrompt
    selectedCommandName.value = ''
    composerMode.value = 'prompt'
    await sendCurrentMessage()
  }

  async function replyPermission(requestId: string, reply: 'once' | 'always' | 'reject') {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    lastError.value = ''

    try {
      const currentClient = getClient()
      await currentClient.permission.reply({
        requestID: normalizedRequestId,
        reply
      })
    } catch (error) {
      handleRequestError(error)
    }
  }

  async function replyQuestion(requestId: string, answers: QuestionAnswer[]) {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    lastError.value = ''

    try {
      const currentClient = getClient()
      await currentClient.question.reply({
        requestID: normalizedRequestId,
        answers
      })
    } catch (error) {
      handleRequestError(error)
    }
  }

  async function rejectQuestion(requestId: string) {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    lastError.value = ''

    try {
      const currentClient = getClient()
      await currentClient.question.reject({
        requestID: normalizedRequestId
      })
    } catch (error) {
      handleRequestError(error)
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

    if (event.type === 'session.error' && pendingCompletionNotice?.sessionId === eventSessionId) {
      clearPendingCompletionNotice(eventSessionId)
    }

    if (eventSessionId) {
      if (selectedSessionId.value === eventSessionId) {
        messages.value = applyEventToMessageCollection(messages.value.slice(), event)
      } else if (sessionPreviewMessages.value[eventSessionId]) {
        sessionPreviewMessages.value = {
          ...sessionPreviewMessages.value,
          [eventSessionId]: applyEventToMessageCollection(sessionPreviewMessages.value[eventSessionId].slice(), event)
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

      sessionPreviewMessages.value = {
        ...sessionPreviewMessages.value,
        [sessionId]: nextMessages.slice()
      }
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
    selectedCommandName,
    availableAgents,
    availableCommands,
    availableModels,
    projects,
    sessions,
    messages,
    sessionPreviewMessages,
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
    createSession,
    sendPromptToSession,
    loadSessionPreview,
    preloadSessionPreviews,
    loadOlderMessages,
    requestNotificationPermission,
    promptInstall,
    preloadHomeData,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    selectAgent,
    selectCommand,
    selectModel,
    updateProject,
    sendCurrentMessage
  }
}
