import type { ComputedRef, Ref } from 'vue'
import type { QuestionAnswer, QuestionRequest } from '@opencode-ai/sdk/v2/client'

import { getHistorySelection } from './catalog'
import { HISTORY_LIMIT_STEP, INITIAL_HISTORY_LIMIT } from './constants'
import { isUnauthorizedError, makeModelKey, normalizeDirectory, normalizeModelKey, parseError } from './helpers'
import { applyQuestionAsked, convertHistoryMessage, pruneEmptyAssistantMessages } from './messages'
import type { MessageHistoryItem } from './types'
import type {
  ChatAgentRecord,
  ChatCommandRecord,
  ChatMessageRecord,
  ChatModelRecord,
  ComposerMode,
  DesktopSessionState
} from '@/types/opencode'

type ClientFactory = () => ReturnType<typeof import('@opencode-ai/sdk/v2/client').createOpencodeClient>

export function createSessionActions(args: {
  availableAgents: Ref<ChatAgentRecord[]>
  composerMode: Ref<ComposerMode>
  composerText: Ref<string>
  desktopSessions: Ref<Record<string, DesktopSessionState>>
  draftDirectory: Ref<string>
  hasMoreHistory: Ref<boolean>
  hasTruncatedMessages: ComputedRef<boolean>
  historyMessageLimit: Ref<number>
  isLoadingOlderMessages: Ref<boolean>
  isLoadingSession: Ref<boolean>
  isSending: Ref<boolean>
  lastError: Ref<string>
  messages: Ref<ChatMessageRecord[]>
  selectedAgent: ComputedRef<ChatAgentRecord | null>
  selectedCommand: ComputedRef<ChatCommandRecord | null>
  selectedCommandName: Ref<string>
  selectedModel: ComputedRef<ChatModelRecord | null>
  selectedSessionId: Ref<string>
  sessionPreviewMessages: Ref<Record<string, ChatMessageRecord[]>>
  sessionStatus: Ref<'idle' | 'busy'>
  clearPendingCompletionNotice: (sessionId?: string) => void
  armCompletionNotice: (sessionId: string, prompt: string) => void
  ensureChatOptionsSnapshot: (directory?: string) => Promise<{ agents: ChatAgentRecord[]; commands: ChatCommandRecord[]; models: ChatModelRecord[] }>
  ensureDesktopSessionState: (sessionId: string) => DesktopSessionState
  getClient: ClientFactory
  handleRequestError: (error: unknown) => void
  invalidateAuth: () => void
  loadChatOptions: (options?: { directory?: string; preferredAgentId?: string; preferredModelKey?: string }) => Promise<void>
  refreshSessions: (options?: { reopen?: boolean }) => Promise<void>
  removeDesktopSessionState: (sessionId: string) => void
  setDesktopSessionChatOptions: (
    sessionState: DesktopSessionState,
    snapshot: { agents: ChatAgentRecord[]; commands: ChatCommandRecord[]; models: ChatModelRecord[] },
    options?: { preferredAgentId?: string; preferredModelKey?: string }
  ) => void
  syncSessionPreviewFromMessages: (sessionId: string, nextMessages: ChatMessageRecord[]) => void
}) {
  async function fetchSessionRuntimeData(sessionId: string, messageLimit: number) {
    const currentClient = args.getClient()
    const [{ data: session }, { data: history }, { data: questions }] = await Promise.all([
      currentClient.session.get({ sessionID: sessionId }),
      currentClient.session.messages({
        sessionID: sessionId,
        limit: messageLimit
      }),
      currentClient.question.list()
    ])

    const historyItems = (history ?? []) as MessageHistoryItem[]
    const nextMessages = pruneEmptyAssistantMessages(historyItems.map(convertHistoryMessage))
    const pendingQuestions = ((questions ?? []) as QuestionRequest[]).filter((item) => item.sessionID === sessionId)

    for (const request of pendingQuestions) {
      applyQuestionAsked(nextMessages, request)
    }

    return {
      normalizedDirectory: normalizeDirectory(session?.directory),
      historyItems,
      messages: nextMessages,
      historySelection: getHistorySelection(historyItems)
    }
  }

  async function openSession(sessionId: string, options: { messageLimit?: number } = {}) {
    if (!sessionId) {
      return
    }

    const requestedLimit = Math.max(
      options.messageLimit ?? (args.selectedSessionId.value === sessionId ? args.historyMessageLimit.value : INITIAL_HISTORY_LIMIT),
      INITIAL_HISTORY_LIMIT
    )

    args.isLoadingSession.value = true
    args.lastError.value = ''

    try {
      const sessionData = await fetchSessionRuntimeData(sessionId, requestedLimit)

      args.historyMessageLimit.value = requestedLimit
      args.hasMoreHistory.value = sessionData.historyItems.length >= requestedLimit
      args.selectedSessionId.value = sessionId

      await args.loadChatOptions({
        directory: sessionData.normalizedDirectory,
        preferredAgentId: sessionData.historySelection.agentId,
        preferredModelKey: sessionData.historySelection.modelKey
      })

      args.messages.value = sessionData.messages
      args.syncSessionPreviewFromMessages(sessionId, args.messages.value)
      args.sessionStatus.value = 'idle'
    } catch (error) {
      args.handleRequestError(error)
    } finally {
      args.isLoadingSession.value = false
    }
  }

  async function loadOlderMessages() {
    if (args.isLoadingOlderMessages.value || args.isLoadingSession.value || !args.hasTruncatedMessages.value) {
      return
    }

    const nextLimit = args.historyMessageLimit.value + HISTORY_LIMIT_STEP
    args.isLoadingOlderMessages.value = true

    try {
      args.historyMessageLimit.value = nextLimit

      if (!args.selectedSessionId.value || !args.hasMoreHistory.value || args.messages.value.length >= nextLimit) {
        return
      }

      await openSession(args.selectedSessionId.value, {
        messageLimit: nextLimit
      })
    } finally {
      args.isLoadingOlderMessages.value = false
    }
  }

  async function openDesktopSession(sessionId: string, options: { messageLimit?: number; force?: boolean } = {}) {
    if (!sessionId) {
      return null
    }

    const sessionState = args.ensureDesktopSessionState(sessionId)
    const requestedLimit = Math.max(options.messageLimit ?? sessionState.historyMessageLimit, INITIAL_HISTORY_LIMIT)

    if (!options.force && sessionState.isLoadingSession) {
      return sessionState
    }

    if (
      !options.force &&
      sessionState.messages.length > 0 &&
      requestedLimit <= sessionState.historyMessageLimit &&
      !sessionState.lastError
    ) {
      return sessionState
    }

    sessionState.isLoadingSession = true
    sessionState.lastError = ''

    try {
      const sessionData = await fetchSessionRuntimeData(sessionId, requestedLimit)
      const snapshot = await args.ensureChatOptionsSnapshot(sessionData.normalizedDirectory)

      sessionState.historyMessageLimit = requestedLimit
      sessionState.hasMoreHistory = sessionData.historyItems.length >= requestedLimit
      sessionState.messages = sessionData.messages
      sessionState.sessionStatus = 'idle'
      args.setDesktopSessionChatOptions(sessionState, snapshot, {
        preferredAgentId: sessionData.historySelection.agentId,
        preferredModelKey: sessionData.historySelection.modelKey
      })
      args.syncSessionPreviewFromMessages(sessionId, sessionState.messages)

      return sessionState
    } catch (error) {
      sessionState.lastError = parseError(error)
      if (isUnauthorizedError(error)) {
        args.invalidateAuth()
      }
      return sessionState
    } finally {
      sessionState.isLoadingSession = false
    }
  }

  async function loadOlderDesktopMessages(sessionId: string) {
    const sessionState = args.desktopSessions.value[sessionId]
    if (!sessionState || sessionState.isLoadingOlderMessages || sessionState.isLoadingSession || !sessionState.hasMoreHistory) {
      return
    }

    sessionState.isLoadingOlderMessages = true

    try {
      await openDesktopSession(sessionId, {
        messageLimit: sessionState.historyMessageLimit + HISTORY_LIMIT_STEP,
        force: true
      })
    } finally {
      sessionState.isLoadingOlderMessages = false
    }
  }

  async function createSession(directoryOverride?: string, options: { openInSingleChat?: boolean } = {}) {
    const directory = normalizeDirectory(directoryOverride || args.draftDirectory.value)
    if (!directory) {
      args.lastError.value = '请先输入项目目录，或选择一个已有项目。'
      return ''
    }

    args.lastError.value = ''
    args.draftDirectory.value = directory

    try {
      const currentClient = args.getClient()
      const { data: session } = await currentClient.session.create({ directory })
      if (!session) {
        throw new Error('创建会话失败。')
      }

      await args.refreshSessions({ reopen: false })

      if (options.openInSingleChat !== false) {
        await openSession(session.id)
      }

      return session.id
    } catch (error) {
      args.handleRequestError(error)
      return ''
    }
  }

  async function loadSessionPreview(sessionId: string, options: { limit?: number; force?: boolean } = {}) {
    if (!sessionId) {
      return [] as ChatMessageRecord[]
    }

    if (!options.force && args.sessionPreviewMessages.value[sessionId]?.length) {
      return args.sessionPreviewMessages.value[sessionId]
    }

    try {
      const currentClient = args.getClient()
      const { data: history } = await currentClient.session.messages({
        sessionID: sessionId,
        limit: Math.max(options.limit ?? 24, 12)
      })
      const preview = pruneEmptyAssistantMessages(((history ?? []) as MessageHistoryItem[]).map(convertHistoryMessage))
      args.syncSessionPreviewFromMessages(sessionId, preview)
      return preview
    } catch (error) {
      if (args.selectedSessionId.value === sessionId) {
        args.handleRequestError(error)
      }
      return args.sessionPreviewMessages.value[sessionId] ?? []
    }
  }

  async function preloadSessionPreviews(sessionIds: string[], options: { limit?: number; force?: boolean } = {}) {
    const targets = [...new Set(sessionIds)].filter(Boolean)
    await Promise.all(targets.map((sessionId) => loadSessionPreview(sessionId, options)))
  }

  async function sendCurrentMessage() {
    const trimmedPrompt = args.composerText.value.trim()
    const selectedCommandEntry = args.selectedCommand.value
    const manualCommand = !selectedCommandEntry && trimmedPrompt.startsWith('/') ? trimmedPrompt.slice(1).trim() : ''
    const [manualCommandName, ...manualCommandArgs] = manualCommand ? manualCommand.split(/\s+/) : []
    const commandName = selectedCommandEntry?.name || manualCommandName || ''
    const commandArgs = manualCommandArgs.join(' ')
    const hasCommand = Boolean(commandName)

    if ((!trimmedPrompt && !hasCommand) || args.isSending.value) {
      return
    }

    if (!args.selectedSessionId.value) {
      await createSession()
    }

    if (!args.selectedSessionId.value) {
      return
    }

    const currentClient = args.getClient()
    const model = args.selectedModel.value
      ? {
          providerID: args.selectedModel.value.providerId,
          modelID: args.selectedModel.value.modelId
        }
      : undefined
    const agent = args.selectedAgent.value?.id || undefined
    args.isSending.value = true
    args.sessionStatus.value = 'busy'
    args.lastError.value = ''

    try {
      const currentSessionId = args.selectedSessionId.value
      if (hasCommand) {
        await currentClient.session.command({
          sessionID: args.selectedSessionId.value,
          command: commandName,
          arguments: commandArgs || undefined,
          agent,
          model: model ? makeModelKey(model.providerID, model.modelID) : undefined
        })
      } else {
        await currentClient.session.prompt({
          sessionID: args.selectedSessionId.value,
          agent,
          model,
          parts: [{ type: 'text', text: trimmedPrompt }]
        })
      }

      args.armCompletionNotice(
        currentSessionId,
        hasCommand ? `/${commandName}${commandArgs ? ` ${commandArgs}` : ''}` : trimmedPrompt
      )
      args.composerText.value = ''
      args.selectedCommandName.value = ''
      args.composerMode.value = 'prompt'
    } catch (error) {
      args.clearPendingCompletionNotice(args.selectedSessionId.value)
      args.handleRequestError(error)
      args.isSending.value = false
      args.sessionStatus.value = 'idle'
    }
  }

  async function sendDesktopMessage(sessionId: string, prompt: string) {
    const sessionState = args.desktopSessions.value[sessionId] ?? args.ensureDesktopSessionState(sessionId)
    const trimmedPrompt = prompt.trim()
    const selectedCommandEntry = sessionState.availableCommands.find((command) => command.name === sessionState.selectedCommandName) ?? null
    const manualCommand = !selectedCommandEntry && trimmedPrompt.startsWith('/') ? trimmedPrompt.slice(1).trim() : ''
    const [manualCommandName, ...manualCommandArgs] = manualCommand ? manualCommand.split(/\s+/) : []
    const commandName = selectedCommandEntry?.name || manualCommandName || ''
    const commandArgs = selectedCommandEntry ? trimmedPrompt : manualCommandArgs.join(' ')
    const hasCommand = Boolean(commandName)

    if ((!trimmedPrompt && !hasCommand) || sessionState.isSending) {
      return false
    }

    if (!sessionState.messages.length) {
      await openDesktopSession(sessionId)
    }

    const selectedModelEntry = sessionState.availableModels.find((model) => model.key === normalizeModelKey(sessionState.selectedModelKey))
    const model = selectedModelEntry
      ? {
          providerID: selectedModelEntry.providerId,
          modelID: selectedModelEntry.modelId
        }
      : undefined
    const agent = sessionState.availableAgents.find((item) => item.id === sessionState.selectedAgentId)?.id || undefined
    const currentClient = args.getClient()

    sessionState.isSending = true
    sessionState.sessionStatus = 'busy'
    sessionState.lastError = ''

    try {
      if (hasCommand) {
        await currentClient.session.command({
          sessionID: sessionId,
          command: commandName,
          arguments: commandArgs || undefined,
          agent,
          model: model ? makeModelKey(model.providerID, model.modelID) : undefined
        })
      } else {
        await currentClient.session.prompt({
          sessionID: sessionId,
          agent,
          model,
          parts: [{ type: 'text', text: trimmedPrompt }]
        })
      }

      args.armCompletionNotice(sessionId, hasCommand ? `/${commandName}${commandArgs ? ` ${commandArgs}` : ''}` : trimmedPrompt)
      sessionState.selectedCommandName = ''
      return true
    } catch (error) {
      args.clearPendingCompletionNotice(sessionId)
      sessionState.lastError = parseError(error)
      sessionState.isSending = false
      sessionState.sessionStatus = 'idle'

      if (isUnauthorizedError(error)) {
        args.invalidateAuth()
      }

      return false
    }
  }

  async function sendPromptToSession(sessionId: string, prompt: string) {
    const trimmedPrompt = prompt.trim()
    if (!sessionId || !trimmedPrompt || args.isSending.value) {
      return
    }

    if (args.selectedSessionId.value !== sessionId || !args.messages.value.length) {
      await openSession(sessionId)
    }

    args.composerText.value = trimmedPrompt
    args.selectedCommandName.value = ''
    args.composerMode.value = 'prompt'
    await sendCurrentMessage()
  }

  async function createDesktopSession(directoryOverride?: string) {
    const sessionId = await createSession(directoryOverride, { openInSingleChat: false })
    if (!sessionId) {
      return ''
    }

    await openDesktopSession(sessionId, { force: true })
    return sessionId
  }

  function closeDesktopSession(sessionId: string) {
    args.removeDesktopSessionState(sessionId)
  }

  async function replyPermission(requestId: string, reply: 'once' | 'always' | 'reject') {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    args.lastError.value = ''

    try {
      const currentClient = args.getClient()
      await currentClient.permission.reply({
        requestID: normalizedRequestId,
        reply
      })
    } catch (error) {
      args.handleRequestError(error)
    }
  }

  async function replyQuestion(requestId: string, answers: QuestionAnswer[]) {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    args.lastError.value = ''

    try {
      const currentClient = args.getClient()
      await currentClient.question.reply({
        requestID: normalizedRequestId,
        answers
      })
    } catch (error) {
      args.handleRequestError(error)
    }
  }

  async function rejectQuestion(requestId: string) {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    args.lastError.value = ''

    try {
      const currentClient = args.getClient()
      await currentClient.question.reject({
        requestID: normalizedRequestId
      })
    } catch (error) {
      args.handleRequestError(error)
    }
  }

  return {
    closeDesktopSession,
    createDesktopSession,
    createSession,
    fetchSessionRuntimeData,
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
  }
}
