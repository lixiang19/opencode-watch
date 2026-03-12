export interface SessionTimeMeta {
  created?: number
  updated?: number
}

export interface SessionRecord {
  id: string
  title?: string
  directory?: string | null
  parentID?: string | null
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

export type ComposerMode = 'prompt' | 'command'
