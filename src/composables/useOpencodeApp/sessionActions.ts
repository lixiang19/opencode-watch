import type { ComputedRef, Ref } from 'vue'
import type { QuestionAnswer, QuestionRequest } from '@opencode-ai/sdk/v2/client'

import { getHistorySelection } from './catalog'
import { HISTORY_LIMIT_STEP, INITIAL_HISTORY_LIMIT, SESSION_PREVIEW_MESSAGE_LIMIT } from './constants'
import {
  buildWorktreeSessionName,
  isUnauthorizedError,
  makeModelKey,
  normalizeDirectory,
  normalizeModelKey,
  parseError
} from './helpers'
import { applyQuestionAsked, buildSessionPreviewMessages, convertHistoryMessage, pruneEmptyAssistantMessages } from './messages'
import type { CachedSessionState, MessageHistoryItem, SessionHistorySelection } from './types'
import type {
  ChatAgentRecord,
  ChatCommandRecord,
  ComposerImageAttachment,
  ChatMessageRecord,
  ChatModelRecord,
  ComposerMode,
  SessionRecord,
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
  mergeSessions: (nextSessions: SessionRecord[]) => SessionRecord[]
  selectedAgent: ComputedRef<ChatAgentRecord | null>
  selectedAgentId: Ref<string>
  selectedCommand: ComputedRef<ChatCommandRecord | null>
  selectedCommandName: Ref<string>
  selectedModel: ComputedRef<ChatModelRecord | null>
  selectedModelKey: Ref<string>
  selectedVariant: Ref<string>
  selectedSessionId: Ref<string>
  singleDraftSession: Ref<boolean>
  sessionPreviewMessages: Ref<Record<string, ChatMessageRecord[]>>
  sessionStatus: Ref<'idle' | 'busy'>
  clearPendingCompletionNotice: (sessionId?: string) => void
  armCompletionNotice: (sessionId: string, prompt: string) => void
  cacheWorktreeBranch: (directory: string, branch: string) => void
  ensureChatOptionsSnapshot: (directory?: string) => Promise<{ agents: ChatAgentRecord[]; commands: ChatCommandRecord[]; models: ChatModelRecord[]; defaultModelKey: string }>
  ensureDesktopSessionState: (sessionId: string) => DesktopSessionState
  getClient: ClientFactory
  handleRequestError: (error: unknown) => void
  invalidateAuth: () => void
  loadChatOptions: (options?: { directory?: string; preferredAgentId?: string; preferredModelKey?: string; preferredVariant?: string }) => Promise<void>
  refreshSessions: (options?: { reopen?: boolean }) => Promise<void>
  removeDesktopSessionState: (sessionId: string) => void
  getCachedSessionState: (sessionId: string) => CachedSessionState | null
  setCachedSessionState: (sessionId: string, state: CachedSessionState) => void
  setDesktopSessionChatOptions: (
    sessionState: DesktopSessionState,
    snapshot: { agents: ChatAgentRecord[]; commands: ChatCommandRecord[]; models: ChatModelRecord[]; defaultModelKey: string },
    options?: { preferredAgentId?: string; preferredModelKey?: string; preferredVariant?: string }
  ) => void
  suppressNextChatOptionLoad: (directory?: string) => void
  syncSessionPreviewFromMessages: (sessionId: string, nextMessages: ChatMessageRecord[]) => void
}) {
  function getSessionDirectory(sessionId?: string) {
    if (!sessionId) {
      return ''
    }

    return normalizeDirectory(args.sessions.value.find((item) => item.id === sessionId)?.directory)
  }

  async function prepareDraftSession(directoryOverride?: string) {
    const directory = normalizeDirectory(directoryOverride || args.draftDirectory.value)
    if (!directory) {
      args.lastError.value = '请先输入项目目录，或选择一个已有项目。'
      return false
    }

    args.draftDirectory.value = directory
    args.selectedSessionId.value = ''
    args.singleDraftSession.value = true
    args.isLoadingSession.value = false
    args.isLoadingOlderMessages.value = false
    args.isSending.value = false
    args.sessionStatus.value = 'idle'
    args.historyMessageLimit.value = INITIAL_HISTORY_LIMIT
    args.hasMoreHistory.value = false
    args.messages.value = []
    args.lastError.value = ''
    args.clearPendingCompletionNotice()
    try {
      await args.loadChatOptions({ directory })
      return true
    } catch (error) {
      args.handleRequestError(error)
      return false
    }
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

  function applyPendingQuestions(messages: ChatMessageRecord[], requests: QuestionRequest[]) {
    for (const request of requests) {
      applyQuestionAsked(messages, request)
    }
  }

  async function fetchPendingQuestions(sessionId: string, directory: string) {
    const currentClient = args.getClient(directory)
    const { data: questions } = await currentClient.question.list({ directory: directory || undefined })
    return ((questions ?? []) as QuestionRequest[]).filter((item) => item.sessionID === sessionId)
  }

  function cacheSelectedSession(
    sessionId: string,
    normalizedDirectory: string,
    nextMessages: ChatMessageRecord[],
    messageLimit: number,
    hasMoreHistory: boolean,
    historySelection: SessionHistorySelection
  ) {
    args.setCachedSessionState(sessionId, {
      sessionId,
      normalizedDirectory,
      messages: nextMessages,
      historyMessageLimit: messageLimit,
      hasMoreHistory,
      sessionStatus: args.selectedSessionId.value === sessionId ? args.sessionStatus.value : 'idle',
      historySelection
    })
  }

  function refreshSelectedSessionQuestions(sessionId: string, normalizedDirectory: string) {
    void fetchPendingQuestions(sessionId, normalizedDirectory)
      .then((pendingQuestions) => {
        if (!pendingQuestions.length) {
          return
        }

        const cached = args.getCachedSessionState(sessionId)
        if (!cached) {
          return
        }

        applyPendingQuestions(cached.messages, pendingQuestions)
        args.syncSessionPreviewFromMessages(sessionId, cached.messages)
        args.setCachedSessionState(sessionId, cached)

        if (args.selectedSessionId.value === sessionId) {
          args.messages.value = cached.messages
        }
      })
      .catch((error) => {
        if (args.selectedSessionId.value === sessionId) {
          args.handleRequestError(error)
        }
      })
  }

  async function fetchSessionRuntimeData(sessionId: string, messageLimit: number) {
    const directory = getSessionDirectory(sessionId)
    const currentClient = args.getClient(directory)
    const { data: history } = await currentClient.session.messages({
      sessionID: sessionId,
      directory: directory || undefined,
      limit: messageLimit
    })

    const historyItems = (history ?? []) as MessageHistoryItem[]
    const nextMessages = pruneEmptyAssistantMessages(historyItems.map(convertHistoryMessage))
    const historySelection = getHistorySelection(historyItems)

    return {
      normalizedDirectory: normalizeDirectory(directory),
      historyItems,
      messages: nextMessages,
      historySelection
    }
  }

  async function openSession(sessionId: string, options: { messageLimit?: number; force?: boolean } = {}) {
    if (!sessionId) {
      return
    }

    const requestedLimit = Math.max(
      options.messageLimit ?? (args.selectedSessionId.value === sessionId ? args.historyMessageLimit.value : INITIAL_HISTORY_LIMIT),
      INITIAL_HISTORY_LIMIT
    )
    const cached = !options.force ? args.getCachedSessionState(sessionId) : null
    const sessionDirectory = cached?.normalizedDirectory || getSessionDirectory(sessionId)

    args.suppressNextChatOptionLoad(sessionDirectory)
    args.selectedSessionId.value = sessionId
    args.singleDraftSession.value = false
    args.lastError.value = ''

    if (cached && requestedLimit <= cached.historyMessageLimit) {
      args.historyMessageLimit.value = cached.historyMessageLimit
      args.hasMoreHistory.value = cached.hasMoreHistory
      args.messages.value = cached.messages
      args.sessionStatus.value = cached.sessionStatus
      args.syncSessionPreviewFromMessages(sessionId, cached.messages)
      args.suppressNextChatOptionLoad(cached.normalizedDirectory)
      void args.loadChatOptions({
        directory: cached.normalizedDirectory,
        preferredAgentId: cached.historySelection.agentId,
        preferredModelKey: cached.historySelection.modelKey,
        preferredVariant: cached.historySelection.variant
      })
      return
    }

    const previewMessages = args.sessionPreviewMessages.value[sessionId]
    args.messages.value = previewMessages?.length ? buildSessionPreviewMessages(previewMessages) : []
    args.sessionStatus.value = cached?.sessionStatus ?? 'idle'

    args.isLoadingSession.value = true

    try {
      const sessionData = await fetchSessionRuntimeData(sessionId, requestedLimit)

      args.historyMessageLimit.value = requestedLimit
      args.hasMoreHistory.value = sessionData.historyItems.length >= requestedLimit

      args.messages.value = sessionData.messages
      args.syncSessionPreviewFromMessages(sessionId, args.messages.value)
      args.sessionStatus.value = 'idle'
      cacheSelectedSession(
        sessionId,
        sessionData.normalizedDirectory,
        args.messages.value,
        requestedLimit,
        args.hasMoreHistory.value,
        sessionData.historySelection
      )
      args.suppressNextChatOptionLoad(sessionData.normalizedDirectory)
      void args.loadChatOptions({
        directory: sessionData.normalizedDirectory,
        preferredAgentId: sessionData.historySelection.agentId,
        preferredModelKey: sessionData.historySelection.modelKey,
        preferredVariant: sessionData.historySelection.variant
      })
      refreshSelectedSessionQuestions(sessionId, sessionData.normalizedDirectory)
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

      sessionState.historyMessageLimit = requestedLimit
      sessionState.hasMoreHistory = sessionData.historyItems.length >= requestedLimit
      sessionState.messages = sessionData.messages
      sessionState.sessionStatus = 'idle'
      args.syncSessionPreviewFromMessages(sessionId, sessionState.messages)

      void args.ensureChatOptionsSnapshot(sessionData.normalizedDirectory)
        .then((snapshot) => {
          const nextSessionState = args.desktopSessions.value[sessionId]
          if (!nextSessionState) {
            return
          }

          args.setDesktopSessionChatOptions(nextSessionState, snapshot, {
            preferredAgentId: sessionData.historySelection.agentId,
            preferredModelKey: sessionData.historySelection.modelKey,
            preferredVariant: sessionData.historySelection.variant
          })
        })
        .catch((error) => {
          const nextSessionState = args.desktopSessions.value[sessionId]
          if (nextSessionState) {
            nextSessionState.lastError = parseError(error)
          }
        })

      void fetchPendingQuestions(sessionId, sessionData.normalizedDirectory)
        .then((pendingQuestions) => {
          if (!pendingQuestions.length) {
            return
          }

          const nextSessionState = args.desktopSessions.value[sessionId]
          if (!nextSessionState) {
            return
          }

          applyPendingQuestions(nextSessionState.messages, pendingQuestions)
          args.syncSessionPreviewFromMessages(sessionId, nextSessionState.messages)
        })
        .catch((error) => {
          const nextSessionState = args.desktopSessions.value[sessionId]
          if (nextSessionState) {
            nextSessionState.lastError = parseError(error)
          }
        })

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

      args.mergeSessions([
        {
          id: session.id,
          title: session.title,
          directory,
          parentID: session.parentID,
          time: {
            created: session.time?.created ?? Date.now(),
            updated: session.time?.updated ?? session.time?.created ?? Date.now()
          }
        }
      ])

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

  async function createWorktreeSession(
    rootDirectoryOverride?: string,
    options: { openInSingleChat?: boolean; worktreeName?: string } = {}
  ) {
    const rootDirectory = normalizeDirectory(rootDirectoryOverride || args.draftDirectory.value)
    if (!rootDirectory) {
      args.lastError.value = '请先输入项目目录，或选择一个已有项目。'
      return ''
    }

    args.lastError.value = ''
    args.draftDirectory.value = rootDirectory

    try {
      const currentClient = args.getClient(rootDirectory)
      const { data: project } = await currentClient.project.current({ directory: rootDirectory })
      if (!project) {
        throw new Error('未找到对应项目，无法创建 worktree 对话。')
      }

      if (project.vcs !== 'git') {
        throw new Error('当前项目还不是 Git 仓库，无法创建 worktree 对话。')
      }

      const { data: worktree } = await currentClient.worktree.create({
        directory: rootDirectory,
        worktreeCreateInput: {
          name: (options.worktreeName || '').trim() || buildWorktreeSessionName()
        }
      })

      if (!worktree?.directory || !worktree.branch) {
        throw new Error('创建 worktree 失败。')
      }

      const worktreeDirectory = normalizeDirectory(worktree.directory)
      args.cacheWorktreeBranch(worktreeDirectory, worktree.branch)

      try {
        const worktreeClient = args.getClient(worktreeDirectory)
        const { data: session } = await worktreeClient.session.create({ directory: worktreeDirectory })
        if (!session) {
          throw new Error('创建 worktree 对话失败。')
        }

        await args.refreshSessions({ reopen: false })

        if (options.openInSingleChat !== false) {
          await openSession(session.id)
        }

        return session.id
      } catch (sessionError) {
        try {
          await currentClient.worktree.remove({
            directory: rootDirectory,
            worktreeRemoveInput: {
              directory: worktreeDirectory
            }
          })
        } catch (cleanupError) {
          throw new Error(`创建 worktree 对话失败，且自动清理失败：${parseError(cleanupError)}`)
        }

        throw new Error(`创建 worktree 对话失败，已自动清理刚刚生成的 worktree：${parseError(sessionError)}`)
      }
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
        limit: Math.max(options.limit ?? SESSION_PREVIEW_MESSAGE_LIMIT, SESSION_PREVIEW_MESSAGE_LIMIT)
      })
      const preview = pruneEmptyAssistantMessages(((history ?? []) as MessageHistoryItem[]).map(convertHistoryMessage))
      args.syncSessionPreviewFromMessages(sessionId, preview)
      return buildSessionPreviewMessages(preview)
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

    const cachedSession = args.getCachedSessionState(args.selectedSessionId.value)
    if (cachedSession) {
      cachedSession.sessionStatus = 'busy'
      args.setCachedSessionState(args.selectedSessionId.value, cachedSession)
    }

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
      const nextCachedSession = args.getCachedSessionState(args.selectedSessionId.value)
      if (nextCachedSession) {
        nextCachedSession.sessionStatus = 'idle'
        args.setCachedSessionState(args.selectedSessionId.value, nextCachedSession)
      }
      return false
    }
  }

  async function sendDesktopMessage(sessionId: string, prompt: string, images: ComposerImageAttachment[] = []) {
    const initialSessionState = args.desktopSessions.value[sessionId] ?? args.ensureDesktopSessionState(sessionId)
    const trimmedPrompt = prompt.trim()
    const selectedCommandEntry = initialSessionState.availableCommands.find((command) => command.name === initialSessionState.selectedCommandName) ?? null
    const manualCommand = !selectedCommandEntry && trimmedPrompt.startsWith('/') ? trimmedPrompt.slice(1).trim() : ''
    const [manualCommandName, ...manualCommandArgs] = manualCommand ? manualCommand.split(/\s+/) : []
    const commandName = selectedCommandEntry?.name || manualCommandName || ''
    const commandArgs = selectedCommandEntry ? trimmedPrompt : manualCommandArgs.join(' ')
    const hasCommand = Boolean(commandName)
    const promptParts = buildPromptParts(trimmedPrompt, images)

    if ((!hasCommand && !promptParts.length) || initialSessionState.isSending) {
      return {
        sent: false,
        sessionId
      }
    }

    if (hasCommand && images.length > 0) {
      initialSessionState.lastError = '命令模式暂不支持附加图片，请切换为普通消息。'
      return {
        sent: false,
        sessionId
      }
    }

    const targetSessionId = sessionId
    const sessionState = initialSessionState

    if (!sessionState.messages.length) {
      await openDesktopSession(targetSessionId)
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
    const directory = getSessionDirectory(targetSessionId)
    const currentClient = args.getClient(directory)

    sessionState.isSending = true
    sessionState.sessionStatus = 'busy'
    sessionState.lastError = ''

    try {
      if (hasCommand) {
        await currentClient.session.command({
          sessionID: targetSessionId,
          directory: directory || undefined,
          command: commandName,
          arguments: commandArgs || undefined,
          agent,
          model: model ? makeModelKey(model.providerID, model.modelID) : undefined,
          variant
        })
      } else {
        await currentClient.session.prompt({
          sessionID: targetSessionId,
          directory: directory || undefined,
          agent,
          model,
          variant,
          parts: promptParts
        })
      }

      args.armCompletionNotice(
        targetSessionId,
        hasCommand ? `/${commandName}${commandArgs ? ` ${commandArgs}` : ''}` : getPromptSummary(trimmedPrompt, images.length)
      )
      sessionState.selectedCommandName = ''
      return {
        sent: true,
        sessionId: targetSessionId
      }
    } catch (error) {
      args.clearPendingCompletionNotice(targetSessionId)
      sessionState.lastError = parseError(error)
      sessionState.isSending = false
      sessionState.sessionStatus = 'idle'

      if (isUnauthorizedError(error)) {
        args.invalidateAuth()
      }

      return {
        sent: false,
        sessionId: targetSessionId
      }
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
      const cachedSession = args.getCachedSessionState(sessionId)
      if (cachedSession) {
        cachedSession.sessionStatus = 'idle'
        args.setCachedSessionState(sessionId, cachedSession)
      }
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

    try {
      const snapshot = await args.ensureChatOptionsSnapshot(getSessionDirectory(sessionId))
      const sessionState = args.ensureDesktopSessionState(sessionId)
      args.setDesktopSessionChatOptions(sessionState, snapshot, {
        preferredAgentId: args.selectedAgentId.value,
        preferredModelKey: args.selectedModelKey.value,
        preferredVariant: args.selectedVariant.value
      })
    } catch {
      // 会话已创建成功，选项拉取失败时保留 openDesktopSession 的结果。
    }

    return sessionId
  }

  async function createDesktopWorktreeSession(directoryOverride?: string, worktreeName?: string) {
    const sessionId = await createWorktreeSession(directoryOverride, { openInSingleChat: false, worktreeName })
    if (!sessionId) {
      return ''
    }

    await openDesktopSession(sessionId, { force: true })

    try {
      const snapshot = await args.ensureChatOptionsSnapshot(getSessionDirectory(sessionId))
      const sessionState = args.ensureDesktopSessionState(sessionId)
      args.setDesktopSessionChatOptions(sessionState, snapshot, {
        preferredAgentId: args.selectedAgentId.value,
        preferredModelKey: args.selectedModelKey.value,
        preferredVariant: args.selectedVariant.value
      })
    } catch {
      // 会话已创建成功，选项拉取失败时保留 openDesktopSession 的结果。
    }

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
    createDesktopWorktreeSession,
    createSession,
    createWorktreeSession,
    fetchSessionRuntimeData,
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
  }
}
