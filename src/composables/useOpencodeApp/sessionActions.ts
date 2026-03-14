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
  ComposerImageAttachment,
  ChatMessageRecord,
  ChatModelRecord,
  ComposerMode,
  DesktopSessionState
} from '@/types/opencode'

type ClientFactory = (directory?: string) => ReturnType<typeof import('@opencode-ai/sdk/v2/client').createOpencodeClient>

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
  sessions: Ref<Array<{ id: string; directory?: string | null }>>
  selectedAgent: ComputedRef<ChatAgentRecord | null>
  selectedCommand: ComputedRef<ChatCommandRecord | null>
  selectedCommandName: Ref<string>
  selectedModel: ComputedRef<ChatModelRecord | null>
  selectedVariant: Ref<string>
  selectedSessionId: Ref<string>
  sessionPreviewMessages: Ref<Record<string, ChatMessageRecord[]>>
  sessionStatus: Ref<'idle' | 'busy'>
  clearPendingCompletionNotice: (sessionId?: string) => void
  armCompletionNotice: (sessionId: string, prompt: string) => void
  ensureChatOptionsSnapshot: (directory?: string) => Promise<{ agents: ChatAgentRecord[]; commands: ChatCommandRecord[]; models: ChatModelRecord[]; defaultModelKey: string }>
  ensureDesktopSessionState: (sessionId: string) => DesktopSessionState
  getClient: ClientFactory
  handleRequestError: (error: unknown) => void
  invalidateAuth: () => void
  loadChatOptions: (options?: { directory?: string; preferredAgentId?: string; preferredModelKey?: string; preferredVariant?: string }) => Promise<void>
  refreshSessions: (options?: { reopen?: boolean }) => Promise<void>
  removeDesktopSessionState: (sessionId: string) => void
  setDesktopSessionChatOptions: (
    sessionState: DesktopSessionState,
    snapshot: { agents: ChatAgentRecord[]; commands: ChatCommandRecord[]; models: ChatModelRecord[]; defaultModelKey: string },
    options?: { preferredAgentId?: string; preferredModelKey?: string; preferredVariant?: string }
  ) => void
  syncSessionPreviewFromMessages: (sessionId: string, nextMessages: ChatMessageRecord[]) => void
}) {
  function getSessionDirectory(sessionId?: string) {
    if (!sessionId) {
      return ''
    }

    return normalizeDirectory(args.sessions.value.find((item) => item.id === sessionId)?.directory)
  }

  function buildPromptParts(prompt: string, images: ComposerImageAttachment[]) {
    const trimmedPrompt = prompt.trim()

    return [
      ...images.map((image) => ({
        type: 'file' as const,
        mime: image.mime,
        filename: image.filename,
        url: image.dataUrl
      })),
      ...(trimmedPrompt ? [{ type: 'text' as const, text: trimmedPrompt }] : [])
    ]
  }

  function getPromptSummary(prompt: string, imageCount: number) {
    const trimmedPrompt = prompt.trim()
    if (trimmedPrompt) {
      return trimmedPrompt
    }

    if (imageCount <= 1) {
      return '[图片]'
    }

    return `[${imageCount} 张图片]`
  }

  async function fetchSessionRuntimeData(sessionId: string, messageLimit: number) {
    const directory = getSessionDirectory(sessionId)
    const currentClient = args.getClient(directory)
    const [{ data: session }, { data: history }, { data: questions }] = await Promise.all([
      currentClient.session.get({ sessionID: sessionId, directory: directory || undefined }),
      currentClient.session.messages({
        sessionID: sessionId,
        directory: directory || undefined,
        limit: messageLimit
      }),
      currentClient.question.list({ directory: directory || undefined })
    ])

    const historyItems = (history ?? []) as MessageHistoryItem[]
    const nextMessages = pruneEmptyAssistantMessages(historyItems.map(convertHistoryMessage))
    const pendingQuestions = ((questions ?? []) as QuestionRequest[]).filter((item) => item.sessionID === sessionId)

    for (const request of pendingQuestions) {
      applyQuestionAsked(nextMessages, request)
    }

    return {
      normalizedDirectory: normalizeDirectory(session?.directory || directory),
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
        preferredModelKey: sessionData.historySelection.modelKey,
        preferredVariant: sessionData.historySelection.variant
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
        preferredModelKey: sessionData.historySelection.modelKey,
        preferredVariant: sessionData.historySelection.variant
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
      const currentClient = args.getClient(directory)
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
      const directory = getSessionDirectory(sessionId)
      const currentClient = args.getClient(directory)
      const { data: history } = await currentClient.session.messages({
        sessionID: sessionId,
        directory: directory || undefined,
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

  async function sendCurrentMessage(images: ComposerImageAttachment[] = []) {
    const trimmedPrompt = args.composerText.value.trim()
    const selectedCommandEntry = args.selectedCommand.value
    const manualCommand = !selectedCommandEntry && trimmedPrompt.startsWith('/') ? trimmedPrompt.slice(1).trim() : ''
    const [manualCommandName, ...manualCommandArgs] = manualCommand ? manualCommand.split(/\s+/) : []
    const commandName = selectedCommandEntry?.name || manualCommandName || ''
    const commandArgs = manualCommandArgs.join(' ')
    const hasCommand = Boolean(commandName)
    const promptParts = buildPromptParts(trimmedPrompt, images)

    if ((!hasCommand && !promptParts.length) || args.isSending.value) {
      return false
    }

    if (hasCommand && images.length > 0) {
      args.lastError.value = '命令模式暂不支持附加图片，请切换为普通消息。'
      return false
    }

    if (!args.selectedSessionId.value) {
      await createSession()
    }

    if (!args.selectedSessionId.value) {
      return false
    }

    const directory = getSessionDirectory(args.selectedSessionId.value)
    const currentClient = args.getClient(directory)
    const model = args.selectedModel.value
      ? {
          providerID: args.selectedModel.value.providerId,
          modelID: args.selectedModel.value.modelId
        }
      : undefined
    const agent = args.selectedAgent.value?.id || undefined
    const variant = args.selectedVariant.value || undefined
    args.isSending.value = true
    args.sessionStatus.value = 'busy'
    args.lastError.value = ''

    try {
      const currentSessionId = args.selectedSessionId.value
      if (hasCommand) {
        await currentClient.session.command({
          sessionID: args.selectedSessionId.value,
          directory: directory || undefined,
          command: commandName,
          arguments: commandArgs || undefined,
          agent,
          model: model ? makeModelKey(model.providerID, model.modelID) : undefined,
          variant
        })
      } else {
        await currentClient.session.prompt({
          sessionID: args.selectedSessionId.value,
          directory: directory || undefined,
          agent,
          model,
          variant,
          parts: promptParts
        })
      }

      args.armCompletionNotice(
        currentSessionId,
        hasCommand ? `/${commandName}${commandArgs ? ` ${commandArgs}` : ''}` : getPromptSummary(trimmedPrompt, images.length)
      )
      args.composerText.value = ''
      args.selectedCommandName.value = ''
      args.composerMode.value = 'prompt'
      return true
    } catch (error) {
      args.clearPendingCompletionNotice(args.selectedSessionId.value)
      args.handleRequestError(error)
      args.isSending.value = false
      args.sessionStatus.value = 'idle'
      return false
    }
  }

  async function sendDesktopMessage(sessionId: string, prompt: string, images: ComposerImageAttachment[] = []) {
    const sessionState = args.desktopSessions.value[sessionId] ?? args.ensureDesktopSessionState(sessionId)
    const trimmedPrompt = prompt.trim()
    const selectedCommandEntry = sessionState.availableCommands.find((command) => command.name === sessionState.selectedCommandName) ?? null
    const manualCommand = !selectedCommandEntry && trimmedPrompt.startsWith('/') ? trimmedPrompt.slice(1).trim() : ''
    const [manualCommandName, ...manualCommandArgs] = manualCommand ? manualCommand.split(/\s+/) : []
    const commandName = selectedCommandEntry?.name || manualCommandName || ''
    const commandArgs = selectedCommandEntry ? trimmedPrompt : manualCommandArgs.join(' ')
    const hasCommand = Boolean(commandName)
    const promptParts = buildPromptParts(trimmedPrompt, images)

    if ((!hasCommand && !promptParts.length) || sessionState.isSending) {
      return false
    }

    if (hasCommand && images.length > 0) {
      sessionState.lastError = '命令模式暂不支持附加图片，请切换为普通消息。'
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
    const variant = sessionState.selectedVariant || undefined
    const directory = getSessionDirectory(sessionId)
    const currentClient = args.getClient(directory)

    sessionState.isSending = true
    sessionState.sessionStatus = 'busy'
    sessionState.lastError = ''

    try {
      if (hasCommand) {
        await currentClient.session.command({
          sessionID: sessionId,
          directory: directory || undefined,
          command: commandName,
          arguments: commandArgs || undefined,
          agent,
          model: model ? makeModelKey(model.providerID, model.modelID) : undefined,
          variant
        })
      } else {
        await currentClient.session.prompt({
          sessionID: sessionId,
          directory: directory || undefined,
          agent,
          model,
          variant,
          parts: promptParts
        })
      }

      args.armCompletionNotice(
        sessionId,
        hasCommand ? `/${commandName}${commandArgs ? ` ${commandArgs}` : ''}` : getPromptSummary(trimmedPrompt, images.length)
      )
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

  async function stopCurrentSession() {
    const sessionId = args.selectedSessionId.value
    if (!sessionId || !args.isSending.value) {
      return false
    }

    try {
      const directory = getSessionDirectory(sessionId)
      const currentClient = args.getClient(directory)
      await currentClient.session.abort({
        sessionID: sessionId,
        directory: directory || undefined
      })
      args.clearPendingCompletionNotice(sessionId)
      args.isSending.value = false
      args.sessionStatus.value = 'idle'
      return true
    } catch (error) {
      args.handleRequestError(error)
      return false
    }
  }

  async function stopDesktopSession(sessionId: string) {
    const sessionState = args.desktopSessions.value[sessionId] ?? args.ensureDesktopSessionState(sessionId)
    if (!sessionId || !sessionState.isSending) {
      return false
    }

    try {
      const directory = getSessionDirectory(sessionId)
      const currentClient = args.getClient(directory)
      await currentClient.session.abort({
        sessionID: sessionId,
        directory: directory || undefined
      })
      args.clearPendingCompletionNotice(sessionId)
      sessionState.isSending = false
      sessionState.sessionStatus = 'idle'
      return true
    } catch (error) {
      sessionState.lastError = parseError(error)
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

  async function replyPermission(sessionId: string, requestId: string, reply: 'once' | 'always' | 'reject') {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    args.lastError.value = ''

    try {
      const directory = getSessionDirectory(sessionId)
      const currentClient = args.getClient(directory)
      await currentClient.permission.reply({
        directory: directory || undefined,
        requestID: normalizedRequestId,
        reply
      })
    } catch (error) {
      args.handleRequestError(error)
    }
  }

  async function replyQuestion(sessionId: string, requestId: string, answers: QuestionAnswer[]) {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    args.lastError.value = ''

    try {
      const directory = getSessionDirectory(sessionId)
      const currentClient = args.getClient(directory)
      await currentClient.question.reply({
        directory: directory || undefined,
        requestID: normalizedRequestId,
        answers
      })
    } catch (error) {
      args.handleRequestError(error)
    }
  }

  async function rejectQuestion(sessionId: string, requestId: string) {
    const normalizedRequestId = requestId.trim()
    if (!normalizedRequestId) {
      return
    }

    args.lastError.value = ''

    try {
      const directory = getSessionDirectory(sessionId)
      const currentClient = args.getClient(directory)
      await currentClient.question.reject({
        directory: directory || undefined,
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
    stopCurrentSession,
    stopDesktopSession,
    sendCurrentMessage,
    sendDesktopMessage,
    sendPromptToSession
  }
}
