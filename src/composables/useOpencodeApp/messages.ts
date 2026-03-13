import type { Event as OpencodeEvent, Message, Part, PermissionRequest, QuestionAnswer, QuestionRequest } from '@opencode-ai/sdk/v2/client'

import type { ChatMessageRecord } from '@/types/opencode'

import type { ChatToolStatus, MessageHistoryItem } from './types'

export function ensureChatMessage(messages: ChatMessageRecord[], info: Partial<Message> & { id: string; role?: string }) {
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

export function ensureAssistantMessage(messages: ChatMessageRecord[], messageId: string) {
  return ensureChatMessage(messages, {
    id: messageId,
    role: 'assistant'
  })
}

export function extractTextContent(parts: Part[]) {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as Part & { text?: string }).text ?? '')
    .join('')
}

export function isRenderableMessage(message: ChatMessageRecord) {
  return Boolean(message.role === 'user' || message.content.trim() || message.confirmation || message.question)
}

export function pruneEmptyAssistantMessages(messages: ChatMessageRecord[]) {
  return messages.filter((message) => isRenderableMessage(message))
}

export function getToolStatus(status: 'pending' | 'running' | 'completed' | 'error'): ChatToolStatus {
  return status === 'error' ? 'failed' : status
}

export function convertHistoryMessage(item: MessageHistoryItem): ChatMessageRecord {
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

export function applyEventToMessageCollection(messages: ChatMessageRecord[], event: OpencodeEvent) {
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

export function getEventSessionId(event: OpencodeEvent) {
  const properties = event.properties as Record<string, any>
  return properties.sessionID || properties.info?.sessionID || properties.info?.id || properties.part?.sessionID || ''
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
