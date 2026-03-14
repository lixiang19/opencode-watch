export interface GitDirectoryStatus {
  branch: string
  dirty: boolean
  changedCount: number
}

interface GitBridgeErrorPayload {
  error?: string
}

const DEFAULT_GIT_BRIDGE_PORT = '9001'

function getGitBridgeBaseUrl() {
  const url = new URL(window.location.origin)
  url.port = DEFAULT_GIT_BRIDGE_PORT
  return url.toString().replace(/\/$/, '')
}

async function requestGitBridge<T>(path: string, body: Record<string, unknown>) {
  let response: Response

  try {
    response = await fetch(`${getGitBridgeBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  } catch {
    throw new Error('本地 Git bridge 没有启动，请直接运行 `npm run dev`。')
  }

  const payload = (await response.json().catch(() => ({}))) as T & GitBridgeErrorPayload
  if (!response.ok) {
    throw new Error(payload.error || `Git 操作失败：${response.status}`)
  }

  return payload as T
}

export function getGitDirectoryStatus(directory: string) {
  return requestGitBridge<GitDirectoryStatus>('/status', { directory })
}

export function commitGitDirectory(directory: string, message: string) {
  return requestGitBridge<{ ok: true }>('/commit', { directory, message })
}

export function mergeGitBranch(rootDirectory: string, branch: string) {
  return requestGitBridge<{ ok: true }>('/merge', { directory: rootDirectory, branch })
}

export function removeGitWorktree(rootDirectory: string, worktreeDirectory: string, branch: string) {
  return requestGitBridge<{ ok: true }>('/worktree/remove', {
    rootDirectory,
    worktreeDirectory,
    branch
  })
}
