export function normalizeDirectory(input?: string | null) {
  if (!input) {
    return ''
  }

  return input.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function getDirectoryName(directory: string) {
  const normalized = normalizeDirectory(directory)
  if (!normalized) {
    return '未命名项目'
  }

  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

export function formatPathTail(input?: string | null, depth = 4) {
  const normalized = normalizeDirectory(input)
  if (!normalized) {
    return ''
  }

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= depth) {
    return normalized.startsWith('/') ? `/${parts.join('/')}` : parts.join('/')
  }

  return `.../${parts.slice(-depth).join('/')}`
}

export function getProjectIdentityKey(projectId?: string | null, directory?: string | null) {
  const normalizedProjectId = projectId?.trim() || ''
  if (normalizedProjectId) {
    return `project:${normalizedProjectId}`
  }

  const normalizedDirectory = normalizeDirectory(directory)
  return normalizedDirectory ? `directory:${normalizedDirectory}` : ''
}

export function buildWorktreeSessionName(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
  const randomSuffix = Math.random().toString(36).slice(2, 6)
  return `chat-${stamp}-${randomSuffix}`
}

export function quoteShellPath(input: string) {
  return `"${input.replace(/"/g, '\\"')}"`
}

export function makeModelKey(providerId: string, modelId: string) {
  return `${providerId}/${modelId}`
}

export function normalizeModelKey(input?: string | null) {
  if (!input) {
    return ''
  }

  const trimmed = input.trim()
  if (!trimmed) {
    return ''
  }

  const splitIndex = trimmed.indexOf('/')
  if (splitIndex <= 0 || splitIndex === trimmed.length - 1) {
    return ''
  }

  return makeModelKey(trimmed.slice(0, splitIndex), trimmed.slice(splitIndex + 1))
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('401'))
}

export function parseError(error: unknown) {
  if (error instanceof Error && error.message) {
    if (isUnauthorizedError(error)) {
      return '连接被拒绝：这个 opencode server 开启了 Basic Auth，请填写用户名和密码。'
    }

    return error.message
  }

  return '连接 opencode 失败'
}

export function buildAuthHeader(username: string, password: string) {
  if (!password) {
    return undefined
  }

  return `Basic ${window.btoa(`${username}:${password}`)}`
}

export function getNotificationTargetUrl(sessionId: string) {
  return sessionId ? `/conversations/${encodeURIComponent(sessionId)}` : '/'
}
