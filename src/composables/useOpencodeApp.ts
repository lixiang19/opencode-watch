import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  createOpencodeClient,
  type Event,
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
import type {
  ChatMessageRecord,
  ComposerMode,
  ProjectRecord,
  SessionRecord
} from '@/types/opencode'

const STORAGE_KEYS = {
  serverUrl: 'opencode-mobile-web-chat.server-url',
  username: 'opencode-mobile-web-chat.username',
  password: 'opencode-mobile-web-chat.password',
  selectedProject: 'opencode-mobile-web-chat.selected-project',
  selectedSession: 'opencode-mobile-web-chat.selected-session',
  draftDirectory: 'opencode-mobile-web-chat.draft-directory',
  composerMode: 'opencode-mobile-web-chat.composer-mode'
}

type OpencodeClient = ReturnType<typeof createOpencodeClient>
type MessageHistoryItem = { info: Message; parts: Part[] }

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

function convertHistoryMessage(item: MessageHistoryItem): ChatMessageRecord {
  const content = item.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as Part & { text?: string }).text ?? '')
    .join('')

  return {
    id: item.info.id,
    role: item.info.role === 'user' ? 'user' : 'assistant',
    content,
    updatedAt: item.info.time?.created ?? Date.now()
  }
}

function getEventSessionId(event: Event) {
  const properties = event.properties as Record<string, any>
  return properties.sessionID || properties.info?.sessionID || properties.part?.sessionID || ''
}

function parseError(error: unknown) {
  if (error instanceof Error && error.message) {
    if (error.message.includes('Unauthorized') || error.message.includes('401')) {
      return '连接被拒绝：这个 opencode server 开启了 Basic Auth，请填写用户名和密码。'
    }

    return error.message
  }

  return '连接 opencode 失败'
}

export function useOpencodeApp() {
  const serverUrl = ref(readStorage(STORAGE_KEYS.serverUrl, 'http://127.0.0.1:4096'))
  const username = ref(readStorage(STORAGE_KEYS.username, 'opencode'))
  const password = ref(readSessionStorage(STORAGE_KEYS.password, ''))
  const selectedProject = ref(readStorage(STORAGE_KEYS.selectedProject, ''))
  const selectedSessionId = ref(readStorage(STORAGE_KEYS.selectedSession, ''))
  const draftDirectory = ref(readStorage(STORAGE_KEYS.draftDirectory, ''))
  const composerMode = ref<ComposerMode>(
    readStorage(STORAGE_KEYS.composerMode, 'prompt') === 'command' ? 'command' : 'prompt'
  )
  const composerText = ref('')
  const sessions = ref<SessionRecord[]>([])
  const projectCatalog = ref<Array<{ directory: string; name: string; lastUpdated: number }>>([])
  const messages = ref<ChatMessageRecord[]>([])
  const isConnecting = ref(false)
  const isLoadingSession = ref(false)
  const isSending = ref(false)
  const isRefreshing = ref(false)
  const sessionStatus = ref<'idle' | 'busy'>('idle')
  const lastError = ref('')
  const streamReady = ref(false)

  let client: OpencodeClient | null = null
  let closeStream: (() => void) | null = null

  const activeSession = computed(() =>
    sessions.value.find((session) => session.id === selectedSessionId.value) ?? null
  )

  const filteredSessions = computed(() => {
    if (!selectedProject.value) {
      return sessions.value
    }

    return sessions.value.filter(
      (session) => normalizeDirectory(session.directory) === normalizeDirectory(selectedProject.value)
    )
  })

  const projects = computed<ProjectRecord[]>(() => {
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

    return Array.from(groups.values()).sort((left, right) => right.lastUpdated - left.lastUpdated)
  })

  const selectedProjectMeta = computed(
    () => projects.value.find((project) => project.directory === normalizeDirectory(selectedProject.value)) ?? null
  )

  const connectionStateLabel = computed(() => {
    if (isConnecting.value) {
      return '连接中'
    }

    return streamReady.value ? '已连接' : '未连接'
  })

  const canCreateSession = computed(
    () => Boolean(normalizeDirectory(selectedProject.value || draftDirectory.value)) && streamReady.value
  )

  const activeProjectDirectory = computed(
    () => normalizeDirectory(selectedProject.value || activeSession.value?.directory || draftDirectory.value)
  )

  function getClient() {
    if (!client) {
      const authHeader = password.value
        ? `Basic ${window.btoa(`${username.value}:${password.value}`)}`
        : undefined

      client = createOpencodeClient({
        baseUrl: serverUrl.value,
        headers: authHeader
          ? {
              Authorization: authHeader
            }
          : undefined
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
          handleEvent(event as Event)
        }
      } catch (error) {
        lastError.value = parseError(error)
        streamReady.value = false
      }
    })()
  }

  async function refreshSessions(options: { reopen?: boolean } = {}) {
    isRefreshing.value = true
    try {
      const currentClient = getClient()
      const [{ data }, { data: projectData }] = await Promise.all([
        currentClient.session.list(),
        currentClient.project.list()
      ])
      const nextSessions = ((data ?? []) as SessionRecord[])
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

      if (!selectedProject.value && nextSessions[0]?.directory) {
        selectedProject.value = normalizeDirectory(nextSessions[0].directory)
      }

      const currentSessionExists = nextSessions.some((session) => session.id === selectedSessionId.value)
      if (!currentSessionExists) {
        selectedSessionId.value = ''
      }

      if (!selectedSessionId.value) {
        selectedSessionId.value =
          filteredSessions.value[0]?.id || nextSessions.find((session) => session.directory)?.id || ''
      }

      if (options.reopen !== false && selectedSessionId.value) {
        await openSession(selectedSessionId.value)
      }
    } finally {
      isRefreshing.value = false
    }
  }

  async function connect() {
    isConnecting.value = true
    lastError.value = ''
    client = null

    try {
      const currentClient = getClient()
      await currentClient.global.health()
      await startEventStream()
      await refreshSessions()
    } catch (error) {
      lastError.value = parseError(error)
      streamReady.value = false
    } finally {
      isConnecting.value = false
    }
  }

  async function openSession(sessionId: string) {
    if (!sessionId) {
      return
    }

    isLoadingSession.value = true
    lastError.value = ''

    try {
      const currentClient = getClient()
      const { data: session } = await currentClient.session.get({ sessionID: sessionId })
      const { data: history } = await currentClient.session.messages({ sessionID: sessionId })

      selectedSessionId.value = sessionId
      if (session?.directory) {
        selectedProject.value = normalizeDirectory(session.directory)
        draftDirectory.value = normalizeDirectory(session.directory)
      }

      messages.value = ((history ?? []) as MessageHistoryItem[]).map(convertHistoryMessage)
      sessionStatus.value = 'idle'
    } catch (error) {
      lastError.value = parseError(error)
    } finally {
      isLoadingSession.value = false
    }
  }

  async function createSession(directoryOverride?: string) {
    const directory = normalizeDirectory(directoryOverride || activeProjectDirectory.value)
    if (!directory) {
      lastError.value = '请先输入项目目录，或选择一个已有项目。'
      return
    }

    lastError.value = ''
    selectedProject.value = directory
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
      lastError.value = parseError(error)
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
    isSending.value = true
    sessionStatus.value = 'busy'
    lastError.value = ''

    try {
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
          arguments: rest.join(' ')
        })
      } else {
        await currentClient.session.prompt({
          sessionID: selectedSessionId.value,
          parts: [{ type: 'text', text: trimmed }]
        })
      }

      composerText.value = ''
    } catch (error) {
      lastError.value = parseError(error)
      isSending.value = false
      sessionStatus.value = 'idle'
    }
  }

  function handleEvent(event: Event) {
    const eventSessionId = getEventSessionId(event)

    if (event.type === 'session.created' || event.type === 'session.updated' || event.type === 'session.idle') {
      void refreshSessions({ reopen: false })
    }

    if (!selectedSessionId.value || eventSessionId !== selectedSessionId.value) {
      return
    }

    switch (event.type) {
      case 'message.updated': {
        const info = (event.properties as { info: Partial<Message> & { id: string; role?: string } }).info
        ensureTextMessage(messages.value, info)
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
        sessionStatus.value = 'idle'
        isSending.value = false
        break
      }
      case 'session.error': {
        lastError.value = JSON.stringify(event.properties)
        sessionStatus.value = 'idle'
        isSending.value = false
        break
      }
    }
  }

  watch(serverUrl, (value) => writeStorage(STORAGE_KEYS.serverUrl, value))
  watch(username, (value) => writeStorage(STORAGE_KEYS.username, value))
  watch(password, (value) => writeSessionStorage(STORAGE_KEYS.password, value))
  watch(selectedProject, async (value) => {
    writeStorage(STORAGE_KEYS.selectedProject, value)

    const nextSession = filteredSessions.value[0]
    const sessionMatchesProject = sessions.value.some(
      (session) =>
        session.id === selectedSessionId.value &&
        normalizeDirectory(session.directory) === normalizeDirectory(value)
    )

    if (!sessionMatchesProject) {
      selectedSessionId.value = nextSession?.id ?? ''
      messages.value = []
      if (nextSession?.id) {
        await openSession(nextSession.id)
      }
    }
  })
  watch(selectedSessionId, (value) => writeStorage(STORAGE_KEYS.selectedSession, value))
  watch(draftDirectory, (value) => writeStorage(STORAGE_KEYS.draftDirectory, value))
  watch(composerMode, (value) => writeStorage(STORAGE_KEYS.composerMode, value))

  onBeforeUnmount(() => {
    closeStream?.()
  })

  return {
    serverUrl,
    username,
    password,
    selectedProject,
    selectedProjectMeta,
    selectedSessionId,
    draftDirectory,
    composerMode,
    composerText,
    projects,
    sessions,
    filteredSessions,
    messages,
    activeSession,
    isConnecting,
    isLoadingSession,
    isRefreshing,
    isSending,
    sessionStatus,
    lastError,
    streamReady,
    connectionStateLabel,
    canCreateSession,
    connect,
    refreshSessions,
    openSession,
    createSession,
    sendCurrentMessage
  }
}
