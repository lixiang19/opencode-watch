export const STORAGE_KEYS = {
  serverUrl: 'opencode-mobile-web-chat.server-url',
  username: 'opencode-mobile-web-chat.username',
  password: 'opencode-mobile-web-chat.password',
  selectedSession: 'opencode-mobile-web-chat.selected-session',
  draftDirectory: 'opencode-mobile-web-chat.draft-directory',
  composerMode: 'opencode-mobile-web-chat.composer-mode',
  selectedAgent: 'opencode-mobile-web-chat.selected-agent',
  selectedModel: 'opencode-mobile-web-chat.selected-model',
  selectedVariant: 'opencode-mobile-web-chat.selected-variant'
} as const

export const RECENT_PROJECT_WINDOW = 14 * 24 * 60 * 60 * 1000
export const SESSION_LIST_LIMIT = 10
export const PROJECT_SESSION_PAGE_SIZE = 10
export const INITIAL_HISTORY_LIMIT = 30
export const HISTORY_LIMIT_STEP = 120
export const SESSION_LIST_REFRESH_DELAY = 240
export const GLOBAL_CHAT_OPTIONS_KEY = '__global__'
