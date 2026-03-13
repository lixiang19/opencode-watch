export interface SessionTimeMeta {
  created?: number
  updated?: number
}

export interface ProjectIconRecord {
  url?: string
  override?: string
  color?: string
}

export interface SessionProjectMeta {
  id: string
  name?: string
  worktree: string
  icon?: ProjectIconRecord
}

export interface SessionRecord {
  id: string
  projectId?: string
  title?: string
  directory?: string | null
  parentID?: string | null
  project?: SessionProjectMeta | null
  time: SessionTimeMeta
}

export interface ProjectRecord {
  projectId?: string
  directory: string
  name: string
  icon?: ProjectIconRecord
  lastUpdated: number
  sessionCount: number
  source?: 'server' | 'session' | 'manual'
  manual?: boolean
}

export interface ChatMessageRecord {
  id: string
  role: 'user' | 'assistant'
  content: string
  updatedAt?: number
  tools?: Array<{
    id: string
    callId: string
    name: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    title?: string
    input?: Record<string, unknown>
  }>
  confirmation?: {
    id: string
    sessionId: string
    type: string
    patterns: string[]
    metadata: Record<string, unknown>
    callId?: string
    response?: 'once' | 'always' | 'reject'
  }
  question?: {
    id: string
    sessionId: string
    callId?: string
    status: 'pending' | 'answered' | 'rejected'
    questions: Array<{
      header: string
      question: string
      options: Array<{
        label: string
        description: string
      }>
      multiple?: boolean
      custom?: boolean
    }>
    answers?: string[][]
  }
}

export interface ChatModelRecord {
  key: string
  providerId: string
  providerName: string
  modelId: string
  label: string
  status?: string
}

export interface ChatAgentRecord {
  id: string
  description: string
  mode?: 'primary' | 'subagent' | 'all'
  hidden?: boolean
  model?: {
    providerId: string
    modelId: string
  }
  variant?: string
}

export interface ChatCommandRecord {
  name: string
  description: string
  template: string
  hints: string[]
  source?: 'command' | 'mcp' | 'skill'
  category: 'system' | 'custom' | 'skill'
}

export type ComposerMode = 'prompt' | 'command'

export interface DesktopSessionState {
  sessionId: string
  messages: ChatMessageRecord[]
  availableAgents: ChatAgentRecord[]
  availableCommands: ChatCommandRecord[]
  availableModels: ChatModelRecord[]
  selectedAgentId: string
  selectedModelKey: string
  selectedCommandName: string
  isLoadingSession: boolean
  isSending: boolean
  isLoadingOlderMessages: boolean
  sessionStatus: 'idle' | 'busy'
  lastError: string
  historyMessageLimit: number
  hasMoreHistory: boolean
}
