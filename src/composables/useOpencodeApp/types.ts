import type { Message, Part } from '@opencode-ai/sdk/v2/client'

import type {
  ChatAgentRecord,
  ChatCommandRecord,
  ChatMessageRecord,
  ChatModelRecord,
  ProjectIconRecord
} from '@/types/opencode'

export type PendingCompletionNotice = {
  sessionId: string
  prompt: string
}

export type ChatOptionsSnapshot = {
  agents: ChatAgentRecord[]
  commands: ChatCommandRecord[]
  models: ChatModelRecord[]
}

export type ChatSelectionOptions = {
  currentAgentId?: string
  currentModelKey?: string
  preferredAgentId?: string
  preferredModelKey?: string
}

export type SessionListFlag = 'isNew' | 'justCompleted'
export type SessionListUiState = Partial<Record<SessionListFlag, boolean>>

export type MessageHistoryItem = { info: Message; parts: Part[] }
export type ChatToolStatus = 'pending' | 'running' | 'completed' | 'failed'

export type ProviderModelInfo = {
  id: string
  name?: string
  status?: string
}

export type ProviderInfo = {
  id: string
  name?: string
  models?: Record<string, ProviderModelInfo>
}

export type ConfigProvidersResponse = {
  providers?: ProviderInfo[]
  default?: Record<string, string>
}

export type AgentInfo = {
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

export type SkillInfo = {
  name: string
  description: string
  location: string
  content: string
}

export type ProjectCatalogEntry = {
  projectId: string
  directory: string
  name: string
  lastUpdated: number
  icon?: ProjectIconRecord
}

export type MediaQueryWithLegacyListeners = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}
