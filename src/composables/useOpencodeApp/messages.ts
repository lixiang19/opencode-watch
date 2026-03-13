import type {
  AssistantMessage,
  Event as OpencodeEvent,
  Message,
  Part,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  ToolPart
} from '@opencode-ai/sdk/v2/client'

import type { ChatMessageRecord } from '@/types/opencode'

import type { ChatToolStatus, MessageHistoryItem } from './types'

type MessagePartDeltaPayload = {
  sessionID: string
  messageID: string
  partID: string
  field: string
  delta: string
}

function clonePart<T extends Part>(part: T): T {
  return structuredClone(part)
}

function cloneParts(parts: Part[]) {
  return parts.map((part) => clonePart(part))
}

function getAssistantErrorText(info: Partial<Message> & { role?: string }) {
  if (info.role !== 'assistant') {
    return undefined
  }

  const assistantInfo = info as Partial<AssistantMessage>
  const error = assistantInfo.error
  if (!error) {
    return undefined
  }

  if ('data' in error && error.data && typeof error.data === 'object' && 'message' in error.data) {
    const message = error.data.message
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }

  return error.name || JSON.stringify(error)
}

function ensurePendingDeltaBucket(message: ChatMessageRecord, partId: string) {
  const queue = message._pendingPartDeltas ?? {}
  const deltas = queue[partId] ?? []
  message._pendingPartDeltas = {
    ...queue,
    [partId]: deltas
  }
  return deltas
}

function consumePendingPartDeltas(message: ChatMessageRecord, partId: string) {
  const deltas = message._pendingPartDeltas?.[partId] ?? []
  if (!deltas.length) {
    return []
  }

  const nextQueue = { ...(message._pendingPartDeltas ?? {}) }
  delete nextQueue[partId]
  message._pendingPartDeltas = Object.keys(nextQueue).length ? nextQueue : undefined
  return deltas
}

function resolveContainerValue(target: unknown, segment: string) {
  if (Array.isArray(target)) {
    const index = Number(segment)
    if (!Number.isInteger(index) || index < 0 || index >= target.length) {
      throw new Error(`无法定位数组字段：${segment}`)
    }
    return {
      container: target as any,
      key: index
    }
  }

  if (!target || typeof target !== 'object') {
    throw new Error(`无法定位字段路径：${segment}`)
  }

  return {
    container: target as any,
    key: segment
  }
}

function appendDeltaToPartField(part: Part, field: string, delta: string) {
  const segments = field.split('.').filter(Boolean)
  if (!segments.length) {
    throw new Error('缺少 delta 字段路径。')
  }

  let current: unknown = part
  for (const segment of segments.slice(0, -1)) {
    const resolved = resolveContainerValue(current, segment)
    const nextValue = resolved.container[resolved.key]
    if (nextValue === undefined || nextValue === null) {
      throw new Error(`无法更新未初始化字段：${field}`)
    }
    current = nextValue
  }

  const lastSegment = segments[segments.length - 1]
  const resolved = resolveContainerValue(current, lastSegment)
  const currentValue = resolved.container[resolved.key]
  if (currentValue === undefined || currentValue === null) {
    resolved.container[resolved.key] = delta
    return
  }

  if (typeof currentValue !== 'string') {
    throw new Error(`字段 ${field} 不是字符串，无法拼接 delta。`)
  }

  resolved.container[resolved.key] = currentValue + delta
}

function getPartPreviewText(part: Part) {
  switch (part.type) {
    case 'text':
      return part.ignored ? '' : part.text.trim()
    case 'reasoning':
      return part.text.trim()
    case 'subtask':
      return part.description.trim() || part.prompt.trim()
    case 'file':
      return part.filename?.trim() || part.url.trim()
    case 'tool':
      return part.state.status === 'completed'
        ? part.state.title?.trim() || part.state.output.trim() || part.tool
        : part.state.status === 'error'
          ? part.state.error.trim() || part.tool
          : ('title' in part.state && typeof part.state.title === 'string' ? part.state.title.trim() : '') || part.tool
    case 'step-start':
      return '步骤开始'
    case 'step-finish':
      return part.reason.trim() || '步骤结束'
    case 'snapshot':
      return part.snapshot.trim()
    case 'patch':
      return part.files.join(', ')
    case 'agent':
      return part.name.trim()
    case 'retry':
      return part.error.data.message.trim()
    case 'compaction':
      return part.overflow ? '上下文已压缩（溢出）' : '上下文已压缩'
  }
}

export function ensureChatMessage(messages: ChatMessageRecord[], info: Partial<Message> & { id: string; role?: string }) {
  let current = messages.find((item) => item.id === info.id)
  if (!current) {
    current = {
      id: info.id,
      role: info.role === 'user' || info.role === 'assistant' ? info.role : undefined,
      parts: [],
      updatedAt: Date.now()
    }
    messages.push(current)
  }

  if (info.role === 'user' || info.role === 'assistant') {
    current.role = info.role
  }

  current.error = getAssistantErrorText(info)
  current.updatedAt = Date.now()
  return current
}

export function ensureAssistantMessage(messages: ChatMessageRecord[], messageId: string) {
  return ensureChatMessage(messages, {
    id: messageId,
    role: 'assistant'
  })
}

export function extractTextContent(parts: Part[]) {
  return parts
    .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text' && !part.ignored)
    .map((part) => part.text ?? '')
    .join('')
}

export function isRenderablePart(part: Part) {
  switch (part.type) {
    case 'text':
      return !part.ignored && Boolean(part.text.trim())
    case 'step-start':
    case 'step-finish':
    case 'snapshot':
    case 'patch':
    case 'reasoning':
    case 'tool':
      return false
    default:
      return true
  }
}

export function getMessagePreviewText(message: ChatMessageRecord) {
  for (const part of message.parts) {
    const preview = getPartPreviewText(part)
    if (preview) {
      return preview
    }
  }

  if (message.question) {
    return message.question.status === 'pending' ? '需要补充信息' : '已填写表单'
  }

  if (message.confirmation) {
    return `权限确认：${message.confirmation.type}`
  }

  return message.error || ''
}

export function isRenderableMessage(message: ChatMessageRecord) {
  if (message.role === 'user') {
    return true
  }

  if (message.role !== 'assistant') {
    return false
  }

  return Boolean(message.parts.some((part) => isRenderablePart(part)) || message.confirmation || message.question || message.error)
}

export function hasActiveToolCall(messages: ChatMessageRecord[]) {
  return messages.some((message) =>
    message.parts.some((part) => part.type === 'tool' && (part.state.status === 'pending' || part.state.status === 'running'))
  )
}

export function pruneEmptyAssistantMessages(messages: ChatMessageRecord[]) {
  return messages.filter(
    (message) =>
      isRenderableMessage(message) ||
      message.parts.some((p) => p.type === 'tool' || p.type === 'reasoning' || p.type === 'patch')
  )
}

export function getToolStatus(status: 'pending' | 'running' | 'completed' | 'error'): ChatToolStatus {
  return status === 'error' ? 'failed' : status
}

export function convertHistoryMessage(item: MessageHistoryItem): ChatMessageRecord {
  return {
    id: item.info.id,
    role: item.info.role,
    parts: cloneParts(item.parts),
    updatedAt: item.info.time?.created ?? Date.now(),
    error: getAssistantErrorText(item.info)
  }
}

export function applyPermissionAsked(messages: ChatMessageRecord[], permission: PermissionRequest) {
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

export function applyPermissionReplied(
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

export function applyQuestionAsked(messages: ChatMessageRecord[], request: QuestionRequest) {
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

export function applyQuestionAnswered(messages: ChatMessageRecord[], requestId: string, answers: QuestionAnswer[]) {
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

export function applyQuestionRejected(messages: ChatMessageRecord[], requestId: string) {
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

function applyQueuedDeltas(message: ChatMessageRecord, part: Part) {
  const queuedDeltas = consumePendingPartDeltas(message, part.id)
  for (const delta of queuedDeltas) {
    appendDeltaToPartField(part, delta.field, delta.delta)
  }
}

function upsertMessagePart(messages: ChatMessageRecord[], messageId: string, part: Part) {
  const current = ensureAssistantMessage(messages, messageId)
  const nextPart = clonePart(part)
  applyQueuedDeltas(current, nextPart)

  const existingIndex = current.parts.findIndex((item) => item.id === part.id)
  if (existingIndex >= 0) {
    current.parts = [
      ...current.parts.slice(0, existingIndex),
      nextPart,
      ...current.parts.slice(existingIndex + 1)
    ]
  } else {
    current.parts = [...current.parts, nextPart]
  }
  current.updatedAt = Date.now()
}

function enqueueMessagePartDelta(messages: ChatMessageRecord[], payload: MessagePartDeltaPayload) {
  const current = ensureAssistantMessage(messages, payload.messageID)
  ensurePendingDeltaBucket(current, payload.partID).push({
    field: payload.field,
    delta: payload.delta
  })
  current.updatedAt = Date.now()
}

function applyMessagePartDelta(messages: ChatMessageRecord[], payload: MessagePartDeltaPayload) {
  const current = messages.find((message) => message.id === payload.messageID)
  if (!current) {
    enqueueMessagePartDelta(messages, payload)
    return
  }

  const part = current.parts.find((item) => item.id === payload.partID)
  if (!part) {
    enqueueMessagePartDelta(messages, payload)
    return
  }

  appendDeltaToPartField(part, payload.field, payload.delta)
  current.updatedAt = Date.now()
}

function removeMessagePart(messages: ChatMessageRecord[], messageId: string, partId: string) {
  const current = messages.find((message) => message.id === messageId)
  if (!current) {
    return
  }

  current.parts = current.parts.filter((part) => part.id !== partId)
  if (current._pendingPartDeltas?.[partId]) {
    const nextQueue = { ...current._pendingPartDeltas }
    delete nextQueue[partId]
    current._pendingPartDeltas = Object.keys(nextQueue).length ? nextQueue : undefined
  }
  current.updatedAt = Date.now()
}

export function applyEventToMessageCollection(messages: ChatMessageRecord[], event: OpencodeEvent) {
  switch (event.type) {
    case 'message.updated': {
      const info = (event.properties as { info: Partial<Message> & { id: string; role?: string } }).info
      ensureChatMessage(messages, info)
      break
    }
    case 'message.removed': {
      const { messageID } = event.properties as { sessionID: string; messageID: string }
      return messages.filter((message) => message.id !== messageID)
    }
    case 'message.part.updated': {
      const { part } = event.properties as { part: Part }
      upsertMessagePart(messages, part.messageID, part)
      break
    }
    case 'message.part.delta': {
      applyMessagePartDelta(messages, event.properties as MessagePartDeltaPayload)
      break
    }
    case 'message.part.removed': {
      const { messageID, partID } = event.properties as { sessionID: string; messageID: string; partID: string }
      removeMessagePart(messages, messageID, partID)
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

export function getEventSessionId(event: OpencodeEvent) {
  const properties = event.properties as Record<string, any>
  if (typeof properties.sessionID === 'string' && properties.sessionID) {
    return properties.sessionID
  }

  if (typeof properties.part?.sessionID === 'string' && properties.part.sessionID) {
    return properties.part.sessionID
  }

  if (typeof properties.info?.sessionID === 'string' && properties.info.sessionID) {
    return properties.info.sessionID
  }

  if (
    (event.type === 'session.created' || event.type === 'session.updated' || event.type === 'session.deleted') &&
    typeof properties.info?.id === 'string' &&
    properties.info.id
  ) {
    return properties.info.id
  }

  return ''
}

export function shouldRefreshSessionList(event: OpencodeEvent) {
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

export function getToolParts(message: ChatMessageRecord) {
  return message.parts.filter((part): part is ToolPart => part.type === 'tool')
}
