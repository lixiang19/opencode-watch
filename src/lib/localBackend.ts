export interface GitDirectoryStatus {
  branch: string
  dirty: boolean
  changedCount: number
  worktreeRoot: string
  mainWorktreeRoot: string
  isWorktreeRoot: boolean
  isLinkedWorktree: boolean
}

export interface AdminSessionStatus {
  authenticated: boolean
  username?: string
  csrfToken?: string
  expiresAt?: string
}

interface BackendErrorPayload {
  error?: string
}

const ADMIN_BACKEND_BASE = '/api/admin'
const AUTH_BACKEND_BASE = '/api/auth'
const CSRF_HEADER_NAME = 'x-opchat-csrf'

let csrfToken = ''

export class LocalBackendError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LocalBackendError'
    this.status = status
  }
}

export function setLocalBackendCsrfToken(nextToken: string) {
  csrfToken = nextToken.trim()
}

async function requestLocalBackend<T>(basePath: string, path: string, init?: RequestInit) {
  let response: Response

  try {
    response = await fetch(`${basePath}${path}`, {
      credentials: 'same-origin',
      ...init
    })
  } catch {
    throw new Error('本地服务没有启动，请运行 `npm run dev` 或 `opchat web`。')
  }

  const payload = (await response.json().catch(() => ({}))) as T & BackendErrorPayload
  if (!response.ok) {
    throw new LocalBackendError(payload.error || `本地服务请求失败：${response.status}`, response.status)
  }

  return payload as T
}

function postJson<T>(basePath: string, path: string, body: Record<string, unknown>, useCsrf = false) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (useCsrf && csrfToken) {
    headers[CSRF_HEADER_NAME] = csrfToken
  }

  return requestLocalBackend<T>(basePath, path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
}

export async function getAdminSessionStatus() {
  const payload = await requestLocalBackend<AdminSessionStatus>(AUTH_BACKEND_BASE, '/session')
  setLocalBackendCsrfToken(payload.csrfToken || '')
  return payload
}

export async function loginAdminSession(password: string) {
  const payload = await postJson<Required<Pick<AdminSessionStatus, 'username' | 'csrfToken' | 'expiresAt'>> & { ok: true }>(
    AUTH_BACKEND_BASE,
    '/login',
    { password }
  )
  setLocalBackendCsrfToken(payload.csrfToken)
  return payload
}

export async function logoutAdminSession() {
  const payload = await postJson<{ ok: true }>(AUTH_BACKEND_BASE, '/logout', {}, true)
  setLocalBackendCsrfToken('')
  return payload
}

export function getGitDirectoryStatus(directory: string) {
  return postJson<GitDirectoryStatus>(ADMIN_BACKEND_BASE, '/git/status', { directory }, true)
}

export function commitGitDirectory(directory: string, message: string) {
  return postJson<{ ok: true }>(ADMIN_BACKEND_BASE, '/git/commit', { directory, message }, true)
}

export function mergeGitBranch(rootDirectory: string, branch: string) {
  return postJson<{ ok: true }>(ADMIN_BACKEND_BASE, '/git/merge', { directory: rootDirectory, branch }, true)
}

export function removeGitWorktree(rootDirectory: string, worktreeDirectory: string, branch: string) {
  return postJson<{ ok: true }>(ADMIN_BACKEND_BASE, '/git/worktree/remove', {
    rootDirectory,
    worktreeDirectory,
    branch
  }, true)
}
