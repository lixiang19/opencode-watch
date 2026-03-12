export interface SessionTimeMeta {
  created?: number
  updated?: number
}

export interface SessionProjectMeta {
  id: string
  name?: string
  worktree: string
}

export interface SessionRecord {
  id: string
  title?: string
  directory?: string | null
  parentID?: string | null
  project?: SessionProjectMeta | null
  time: SessionTimeMeta
}

export interface ProjectRecord {
  directory: string
  name: string
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

export type ComposerMode = 'prompt' | 'command'
